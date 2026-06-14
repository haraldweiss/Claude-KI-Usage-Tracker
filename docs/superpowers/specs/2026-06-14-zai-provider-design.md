# z.ai (GLM Coding Plan) als 5. Kostenquelle — Design

**Datum:** 2026-06-14
**Status:** Approved
**Blueprint:** OpenCode Go Integration (`feat(opencode-go)`, Commit `f9459f1` ff.)

## Ziel

z.ai / Zhipu **GLM Coding Plan** als fünfte Kostenquelle in den Tracker aufnehmen.
Strukturell eine Subscription mit Nutzungs-Quotas — analog zu OpenCode Go und claude.ai.

Hard-Rule 3.3: Die fünfte Quelle **muss** in das Grand-Total (`OverviewTab`) und das
All-Time-Spending (`CombinedCostTab`) einfließen.

## Live ausgelesene Datenlage (Quelle der Wahrheit für die Scraper-Regex)

Eingeloggte Seiten am 2026-06-14 via Chrome ausgelesen.

### `/manage-apikey/coding-plan/personal/my-plan`

```
GLM Coding Lite-Monthly Plan
Valid
Auto-renew on 2026.07.14
$16.2
$16.2
from 2nd month
```

- Plan-Name: `GLM Coding Lite-Monthly Plan`
- Status: `Valid`
- Preis: `$16.2` (USD) / Monat
- Auto-Renew-Datum: `2026.07.14`

### `/manage-apikey/coding-plan/personal/usage`

```
5 Hours Quota
0 % Used
Weekly Quota
0 % Used
Reset Time: 2026-06-21 08:58
Total Monthly Web Search / Reader / Zread Quota
0 % Used
Reset Time: 2026-07-14 08:58
Last Updated: 2026-06-14 09:04:20
```

- **5 Hours Quota**: `N% Used` — rollend, **kein** Reset-Text.
- **Weekly Quota**: `N% Used` + `Reset Time: <ISO-ähnlicher Timestamp>`.
- **Total Monthly Web Search / Reader / Zread Quota**: `N% Used` + `Reset Time: …`.
- `Last Updated: <timestamp>`.

**Wichtiger Unterschied zu OpenCode Go:** z.ai liefert **absolute Reset-Timestamps**
(`2026-06-21 08:58`) statt relativer Strings („Resets in 4d"). Daher direkt als String
speichern; Frontend formatiert über die bestehende `formatResetHint`-Logik (die bereits
Datums-Strings versteht, siehe Commit `9191375`).

## Designentscheidungen (vom User bestätigt)

1. **Preis-Quelle:** Live von `/my-plan` scrapen (Ansatz A). Der Scraper liefert den
   USD-Preis mit; das Backend upserted ihn (USD→EUR) in die `plan_pricing`-Tabelle.
   Begründung: GLM-Tiers variieren stark im Preis (Lite/Pro/Max); Auto-Anpassung
   verhindert stille Falsch-Kosten (Hard-Rule 3.3).
2. **Quotas:** Alle drei anzeigen (5h, Weekly, Monthly Web/Reader/Zread) — analog
   OpenCode Gos drei Quota-Karten.

## Architektur / Datenfluss

```
Extension Scraper (zaiSync)
  → GET /my-plan : plan_name, price_usd, auto_renew_date, status
  → GET /usage   : five_hour_pct, weekly_pct + weekly_reset,
                   monthly_pct + monthly_reset, last_updated
  → POST /usage/track { source: 'zai_sync', response_metadata: {…} }

Backend usageController (source === 'zai_sync')
  → upsert usage_record (idempotent, wie opencode_go_sync)
  → updatePlanPricing(plan_name, price_usd → EUR via exchangeRateService)
  → /usage/combined liefert `zai`-Block (analog `opencode_go`)

Frontend
  → OverviewTab : z.ai-Karte (3 Quota-Balken + Reset-Hints);
                  grandTotalEur += subscriptionEur(plans, zaiPlanName)
  → CombinedCostTab : all-time + Grand-Total inkl. z.ai
  → popup.{js,html} : z.ai-Zeile
```

## Komponenten / Touch-Points

| # | Datei | Änderung |
|---|---|---|
| 1 | `extension/background-scraper-zai.js` *(neu)* | `zaiSync()`: navigiert zu `/my-plan` + `/usage`, scrapt; `isFinite()`-Guards; DE+EN-Labels. ~150 Z. |
| 2 | `extension/background.js` | `zaiSync` registrieren, Alarm `ZAI_SYNC_ALARM` (24h-Cadence). |
| 3 | `extension/manifest.json` | `host_permissions += "https://z.ai/*"`. ⚠️ Chrome flaggt neue host_permissions beim Update. |
| 4 | `backend/src/controllers/usageController.ts` | `source === 'zai_sync'`-Block (Upsert + `updatePlanPricing`); `ZaiMeta`-Interface; `zai`-Block im `/combined`-Response. |
| 5 | `backend/src/types/models.ts` | `SyncSource.ZaiSync = 'zai_sync'`. |
| 6 | `backend/src/services/planPricingService.ts` | Seed-Row `{ plan_name: 'GLM Coding Lite-Monthly Plan', monthly_eur: <Fallback>, source: 'tier_default' }`. Scraper überschreibt live. |
| 7 | `frontend/src/components/OverviewTab.tsx`, `CombinedCostTab.tsx`, `types/api.ts`, `extension/popup.{js,html}` | `ZaiSpend`-Typ, Grand-Total-Summand, z.ai-Karte, Popup-Zeile. |

## Scraper-Detail (`zaiSync`)

- **Reuse-Tab:** `chrome.tabs.query({ url: 'https://z.ai/manage-apikey/coding-plan/*' })`,
  sonst neuen inaktiven Tab öffnen, `waitForTabComplete`.
- **React-Render-Delay:** `/my-plan` und `/usage` rendern verzögert (~3–4 s beobachtet) →
  `sleep`/Poll vor `executeScript`.
- **Plan-Scrape (`/my-plan`):**
  - `plan_name`: Zeile vor `Valid`/`Invalid` bzw. Match auf `GLM Coding .*Plan`.
  - `price_usd`: `/\$\s*([\d.]+)/` (erstes Vorkommen).
  - `auto_renew_date`: `/Auto-renew on\s+([\d.]+)/`.
- **Usage-Scrape (`/usage`):**
  - Helper `extractPctAfterLabel(label)`: `new RegExp(label + '[\\s\\S]{0,40}?(\\d+)\\s*%','i')`.
  - Labels: `5 Hours Quota` / `5-Stunden`, `Weekly Quota` / `Wöchentlich`,
    `Total Monthly Web Search` / `Monatlich`.
  - Reset: `Reset Time:\s*([\d\-: ]+)` jeweils nach dem Quota-Block.
- **POST-Skip:** Wenn alle drei `pct == null` → kein POST (`skipped: true`).
- **Login-Expiry:** Wenn die Seite auf eine Login-/Auth-URL umleitet oder die erwarteten
  Labels fehlen → sauberer `skipped`-Return + `last_zai_sync_status`, kein Crash
  (Hard-Rule 3.2, wie OpenCode Gos Auth-Bounce).
- **Storage:** `last_zai_sync`, `last_zai_sync_data`, `last_zai_sync_status`.

## Backend-Detail

- `SYNC_SOURCES` um `'zai_sync'` erweitern.
- Neuer Block analog `opencode_go_sync`: jüngste `response_metadata` für `source='zai_sync'`
  lesen, als `ZaiMeta` parsen, in den `/combined`-Response als `zai` legen.
- **Preis-Upsert:** `response_metadata.price_usd` → EUR via `exchangeRateService`
  (gecacht, frankfurter.app, Hard-Rule 3.3) → `updatePlanPricing(plan_name, eur, 'scraped')`.
  Guard: nur upserten wenn `price_usd` endlich & > 0.

```ts
interface ZaiMeta {
  plan_name: string | null;
  price_usd: number | null;
  auto_renew_date: string | null;
  five_hour_pct: number | null;
  weekly_pct: number | null;
  weekly_reset: string | null;
  monthly_pct: number | null;
  monthly_reset: string | null;
  scraped_at: string;
}
```

## Frontend-Detail

- `types/api.ts`: `ZaiSpend` (Felder wie `ZaiMeta` + abgeleitete EUR), `CombinedSpendBreakdown.zai`.
- `OverviewTab.tsx`:
  - `const zai = combined?.zai ?? null;`
  - `const zaiEur = subscriptionEur(plans, zai?.plan_name);`
  - `grandTotalEur += zaiEur;` (Hard-Rule 3.3) + Forecast-Summand.
  - z.ai-Karte: drei Quota-Balken (Farbe wie OpenCode: <50 grün, <80 amber, sonst rot)
    + `formatResetHint(reset)`. Grid-Spalten-Count anpassen (md:grid-cols-5 wenn vorhanden).
- `CombinedCostTab.tsx`: analog `opencodeGoEur` einen `zaiEur`-Summand + Zeile.
- `popup.{js,html}`: z.ai-Zeile mit Plan + Quota-%; `isFinite()`-Guard vor Format.

## Fehlerbehandlung

- Login-Expiry → `skipped`, kein Crash, Status persistiert.
- Scrape ohne Quota-Werte → kein POST.
- `price_usd` undefined/0 → kein `plan_pricing`-Upsert (verhindert `NaN€`, Hard-Rule 3.3).
- USD→EUR-Rate nicht verfügbar → Seed-Fallback aus `plan_pricing` greift.

## Tests

1. **Backend-Unit:** `zai_sync`-Record-Upsert; `ZaiMeta`-Parse; USD→EUR-`updatePlanPricing`
   (mit gemocktem Exchange-Rate); `/combined` enthält `zai`-Block.
2. **Scraper-Regex:** Gegen die oben dokumentierten echten Strings (Plan + Usage),
   inkl. DE-Varianten.
3. **Frontend:** Grand-Total summiert z.ai mit (Snapshot/Unit auf `OverviewTab`-Logik).
4. **Manueller Round-Trip:** Popup → „Jetzt synchronisieren" → Dashboard zeigt z.ai-Karte,
   Grand-Total enthält ~15 € z.ai-Abo.

## Bewusst weggelassen (YAGNI)

- Token-/Model-Usage-Charts der `/usage`-Seite — nur Quota-% + Plan-Kosten,
  konsistent mit OpenCode Go.
- Per-Model-Pricing für GLM-Modelle in `pricing-fallback.ts` — kann später folgen,
  wenn Model-Empfehlungen GLM einbeziehen sollen (separater Scope).

## Offene Punkte für Implementierung

- Exakter EUR-Seed-Wert: `$16.2` × aktuelle USD→EUR-Rate (zur Build-Zeit nachschlagen,
  ~15 € bei Rate ~0.92).
- `host_permissions`-Update im Handoff (§7 AGENTS.md) dokumentieren — Chrome verlangt
  beim Extension-Update eine erneute Berechtigungs-Bestätigung.
