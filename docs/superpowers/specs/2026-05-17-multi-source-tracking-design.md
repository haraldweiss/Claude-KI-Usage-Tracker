# Sub-Projekt A.1 — Multi-Source Tracking

**Datum:** 2026-05-17
**Status:** Design / Spec
**Aufbauend auf:** [Sub-Projekt A — Local LLM Tracking](2026-05-17-local-llm-tracking-design.md)
**Folge-Projekte:** B (Spar-Empfehlungen), C (Routing-Steuerung) — unverändert Out-of-Scope

---

## 1. Hintergrund und Motivation

Sub-Projekt A unterstützt **eine** `provider_user_id` pro Tracker-User. In der Praxis hat der Nutzer aber mehrere Apps, die auf den `ai-provider-service` zugreifen — jede mit eigener `user_id`:

- Bewerbungstracker (`/var/www/bewerbungen`): schickt die UUID des Bewerbungstracker-Users (= `03bd2c3d-...` für `harald.weiss@wolfinisoftware.de`)
- WordPress-Integration: schickt `wolfini_de_web`
- Künftig weitere Apps (Notiz-Tool, IDE-Plugin, lokale Skripte) — alle mit ihren eigenen IDs

Mit nur einer konfigurierbaren ID sieht man immer nur eine Quelle. Sub-Projekt A.1 macht das Tracking multi-source-fähig.

**Triggering Decision (während des Sub-A-Deploys):** Bewerbungstracker schickt `user.id` (UUID pro Account) statt einer App-globalen ID. Damit der Tracker beide Welten gleichzeitig sehen kann, braucht es 1:N.

---

## 2. Scope

### In-Scope
1. Schema-Änderung: `provider_user_id` wird von einer Spalte in `user_provider_service_config` auf eine eigene 1:N-Tabelle `provider_service_user_ids` ausgelagert
2. Migration: bestehender Eintrag wird automatisch in die neue Tabelle kopiert
3. Settings-UI: Liste von `provider_user_id`s mit Add/Remove, Per-Eintrag-Label und Per-Eintrag-Enabled-Toggle
4. Cron iteriert über alle aktiven IDs eines Tracker-Users, pro ID eigener Cursor
5. Übersichts-Card: mehrere Mini-Karten — pro `origin_app` aggregiert (Fallback auf `provider_user_id` wenn `origin_app` NULL)
6. API erweitert: GET/POST/DELETE/PATCH auf `/api/local-usage/user-ids`

### Out-of-Scope (kommt später)
- Spar-Empfehlungen (Sub-Projekt B)
- Routing-UI (Sub-Projekt C)
- Per-User-Tokens im Provider-Service
- Bulk-Edit-UI für viele IDs
- Per-Source-Trends/Charts (gehört in Sub-Projekt B)
- Drag-Reorder der Karten
- Migration der übrigen Konsumenten-Apps zum Setzen des `X-Origin-App`-Headers (Bewerbungstracker wurde manuell migriert; andere Apps kommen wenn sie wirklich relevant werden)

---

## 3. Architektur

### 3.1 Schema-Änderungen

**Bestehend (vereinfacht):**

```
user_provider_service_config  (1:1 mit users)
  user_id (PK, FK users.id)
  service_url
  service_token_enc
  provider_user_id          <- entfällt aus dieser Tabelle
  last_sync_at              <- entfällt
  last_sync_cursor          <- entfällt
  last_sync_error           <- entfällt
  enabled                   <- bleibt: master-Toggle für gesamte Verbindung
  created_at, updated_at
```

**Neu:**

```
provider_service_user_ids  (N pro Tracker-User)
  id                INTEGER PRIMARY KEY AUTOINCREMENT
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  provider_user_id  TEXT NOT NULL
  label             TEXT                       -- frei wählbar; UI fällt auf provider_user_id zurück wenn NULL
  enabled           INTEGER NOT NULL DEFAULT 1
  last_sync_at      TEXT
  last_sync_cursor  TEXT
  last_sync_error   TEXT
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
  UNIQUE (user_id, provider_user_id)
```

Indizes: `(user_id)` für ID-Listen pro Tracker-User; `(enabled)` für Cron-Scan.

### 3.2 Migration

Beim ersten Boot der neuen Version, im bestehenden `initDatabase()`:

1. `CREATE TABLE IF NOT EXISTS provider_service_user_ids` (idempotent)
2. Datenmigration in einer Single-Transaction:
   - `INSERT INTO provider_service_user_ids (user_id, provider_user_id, last_sync_at, last_sync_cursor, last_sync_error, enabled, created_at, updated_at)
     SELECT user_id, provider_user_id, last_sync_at, last_sync_cursor, last_sync_error, enabled, created_at, updated_at
     FROM user_provider_service_config
     WHERE provider_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM provider_service_user_ids WHERE provider_service_user_ids.user_id = user_provider_service_config.user_id);`
   - Der `WHERE NOT EXISTS` macht die Migration re-runnable (idempotent bei Cold-Start nach Rollback).
3. Spalten `provider_user_id`, `last_sync_at`, `last_sync_cursor`, `last_sync_error` in `user_provider_service_config` bleiben **vorerst stehen** (defensiv für Rollback). Cleanup-Commit in einem späteren Release.

### 3.3 Datenfluss (unverändert in der Pipeline)

```
ai-provider-service                      Tracker
─────────────────                        ──────────
usage_events  ──── Pull (per ID) ──►     provider_service_events
                                              (gleicher Schema)

Aggregation by COALESCE(origin_app,        Card: 1 Mini-Card pro Source
'user:' || provider_user_id)
```

Was sich ändert: Die **Cron-Schleife** iteriert pro Tracker-User über *alle* `enabled=1`-Einträge in `provider_service_user_ids`. Jede ID hat ihren eigenen `last_sync_cursor` und kann unabhängig fehlschlagen.

---

## 4. Backend-Änderungen

### 4.1 `localUsageRepo.ts` — Erweiterungen

**Beibehalten / leicht angepasst:**
- `upsertProviderServiceConfig(userId, input)` — `input` verliert das `provider_user_id`-Feld
- `getProviderServiceConfig(userId)` — Return-Shape verliert `provider_user_id`, behält `service_url`, `service_token_enc`, `enabled`
- `insertEventIfNew(userId, ev)` — **unverändert**

**Neu:**
```typescript
addProviderUserId(userId: number, providerUserId: string, label?: string): Promise<ProviderUserIdRow>
listProviderUserIds(userId: number): Promise<ProviderUserIdRow[]>
getProviderUserId(rowId: number): Promise<ProviderUserIdRow | null>
removeProviderUserId(rowId: number, userId: number): Promise<boolean>   // userId für Scope-Check
setProviderUserIdEnabled(rowId: number, userId: number, enabled: boolean): Promise<boolean>
updateProviderUserIdLabel(rowId: number, userId: number, label: string | null): Promise<boolean>
listAllActiveProviderUserIds(): Promise<Array<{ user_id: number; row: ProviderUserIdRow }>>
updateProviderUserIdSyncStatus(rowId: number, update: SyncStatusUpdate): Promise<void>
```

**Refaktor:**
- `listUsersWithProviderServiceConfig()` (Sub-A) wird durch `listAllActiveProviderUserIds()` ersetzt (gleicher Cron-Konsument, aber per-ID granular).
- `getLocalUsageSummary(userId, period)` wird umgebaut auf neuen Return-Shape (siehe 4.2).

### 4.2 Neue Summary-Struktur

```typescript
interface SourceSummary {
  source: string;          // origin_app OR `user:${provider_user_id}` fallback
  label?: string;          // wenn Source als provider_user_id → label aus provider_service_user_ids
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModel: { model: string; calls: number } | null;
}

interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  total: Omit<SourceSummary, 'source' | 'label' | 'topModel'> & {
    topModels: Array<{ model: string; calls: number }>;
  };
  perSource: SourceSummary[];
}
```

SQL: Gruppierung via `COALESCE(origin_app, 'user:' || provider_user_id) AS source_key`, sortiert nach totalTokens DESC.

### 4.3 `providerServiceSyncService.ts`

```typescript
interface PerIdResult {
  providerUserId: string;
  ok: boolean;
  newEvents: number;
  error?: string;
}

interface SyncResult {
  ok: boolean;           // true wenn alle IDs ok
  newEvents: number;     // summiert
  perId: PerIdResult[];
}

async function syncProviderServiceEvents(userId: number): Promise<SyncResult>
```

Implementierung: lade Master-Config (URL/Token/master-enabled). Wenn deaktiviert → `ok:true, newEvents:0, perId:[]`. Sonst: iteriere `listProviderUserIds(userId)` filtered nach `enabled=1`. Pro ID:
- Pull-Loop wie in Sub-A, aber Cursor und Error werden per ID in `provider_service_user_ids` gespeichert
- Bei Fehler: in DB schreiben, in PerIdResult markieren, mit nächster ID weitermachen
- Cron-Hook in `server.ts`: Bei jeder fehlgeschlagenen `perId` ein `console.warn('[provider-service-sync] user=... providerUserId=... error=...')` schreiben

### 4.4 Neue + Geänderte Routes

| Route | Methode | Body | Response |
|---|---|---|---|
| `/api/local-usage/summary?period=` | GET | — | `LocalUsageSummary` (neuer Shape) |
| `/api/local-usage/sync-status` | GET | — | Aggregat `{ configured, enabled, last_sync_at, last_sync_error, perId: [...] }` |
| `/api/local-usage/sync` | POST | — | `SyncResult` |
| `/api/local-usage/config` | GET | — | Connection + `user_ids` Array (Per-ID State) |
| `/api/local-usage/config` | PUT | `{ service_url, service_token?, enabled }` | `{ ok: true }` |
| `/api/local-usage/user-ids` | POST | `{ provider_user_id, label? }` | `ProviderUserIdRow` |
| `/api/local-usage/user-ids/:id` | DELETE | — | `{ ok: true }` |
| `/api/local-usage/user-ids/:id` | PATCH | `{ label?, enabled? }` | `ProviderUserIdRow` |

Konflikt-Verhalten: POST mit duplicate `(user_id, provider_user_id)` → 409 Conflict.

---

## 5. Frontend-Änderungen

### 5.1 `ProviderServiceSettings.tsx` — Zweiteilig

**Teil 1 — Connection-Config** (existiert, leicht refactored):
- Service-URL, Service-Token, Aktiv-Toggle, Speichern, Verbindung-testen

**Teil 2 — Liste der `provider_user_id`s** (neu):
- Headline "Verbundene user_ids" + "+ user_id hinzufügen" Button
- Add-Form: `provider_user_id` (text input, required) + `label` (text input, optional, **leer als Default**) — Submit → POST `/user-ids` (handles 409 als Inline-Fehler "Bereits konfiguriert")
- Liste: pro Eintrag eine Card mit:
  - Editierbares Label (text input mit debounced PATCH)
  - Sichtbare `provider_user_id` (read-only, klein)
  - Aktiv-Toggle (sofortiges PATCH)
  - Letzter Sync (relative time)
  - Rotes Banner mit Error wenn `last_sync_error`
  - Delete-Button (mit Bestätigungs-Dialog) → DELETE `/user-ids/:id`

### 5.2 `LocalUsageCard.tsx` — Multi-Card-Rendering

Strukturell:
```
Header:
  "Lokale LLM-Nutzung" + provider-service Badge
  (kein eigener Hero-Wert mehr — die Summe ist nicht der Fokus, der Mix ist)
Grid (responsive 1/2/3 Spalten):
  Mini-Card pro perSource[i]:
    - Label (falls Source-Type 'user:...': aus user_ids.label, fallback: provider_user_id)
      Sonst (Source-Type 'origin_app'): direkt der origin_app-Wert
    - Hero: totalTokens (formatNumber)
    - Sub: In: X · Out: Y
    - Sub: N Calls · ⌀ Tokens/Call
    - Sub: top-Modell · N Calls
    - Rotes Banner *innerhalb der Karte* falls die ihr zuzuordnende user_id einen Sync-Error hat
      (Mapping: Sources mit `user:UUID` → match auf provider_user_id; Sources mit `origin_app` → Karte zeigt keinen Error, weil origin_app-Errors quer über IDs auftreten könnten)
```

Empty-States:
- Keine `provider_user_id` konfiguriert → bestehender Empty-State-Banner mit Link auf Settings
- Konfigurationen vorhanden, aber `perSource` leer → "Noch keine Calls in diesem Monat."

### 5.3 `localUsageApi.ts` — Erweitert

```typescript
addProviderUserId(input: { provider_user_id: string; label?: string }): Promise<ProviderUserIdRow>
removeProviderUserId(id: number): Promise<{ ok: boolean }>
updateProviderUserId(id: number, patch: { label?: string; enabled?: boolean }): Promise<ProviderUserIdRow>
```

`getProviderServiceConfig()` Response-Shape ändert sich (s.o.). `getLocalUsageSummary()` Response-Shape ändert sich (s.o.).

### 5.4 Was unverändert bleibt
- `OverviewTab.tsx` integration: `<LocalUsageCard />` bleibt self-contained
- `Settings.tsx`: ein einzelnes `<ProviderServiceSettings />` Element
- Routing/Auth

---

## 6. Edge Cases & Fehlerbehandlung

| Szenario | Verhalten |
|---|---|
| User entfernt die letzte ID | Card → Empty-State; Cron tut nichts; Connection-Config bleibt |
| ID existiert im Provider-Service nicht | Sync returns 0 Events, kein Error — Tracker kann das nicht unterscheiden von "noch keine Events" |
| Duplikat-Add | `UNIQUE`-Constraint → DB error → Controller 409 → UI "Bereits konfiguriert" |
| ID deaktiviert/aktiviert | Cursor bleibt erhalten — Re-Aktivierung resumed am letzten Punkt |
| Migration mit existing Sub-A-Config | Initial-Row wird in neue Tabelle kopiert; UI zeigt sofort eine Source |
| Verschiedene Token-Counts pro ID | Per-ID-Aggregation funktioniert über separate `last_sync_*`-Felder |
| Master-`enabled=0` mit aktiven IDs | Master gewinnt — kein Sync. UI greyt alle ID-Karten aus |
| Zwei Tracker-User mit gleicher `provider_user_id` | Funktioniert — jede Row ist user-scoped, Events doppelt gespiegelt (kostet Storage, korrekt) |
| `origin_app` ändert sich (Header später nachgerüstet) | Card splittet automatisch nach origin_app-Wert; alte Events ohne Header → Fallback-Source |
| Cron-Tick läuft > 15 min | Egal — `UNIQUE`-Constraint macht Re-Polls idempotent |

### Cron-Logging-Verhalten
- Erfolg (mind. 1 Event): `console.log('[provider-service-sync] user=X providerUserId=Y new=N')`
- Fehler: `console.warn('[provider-service-sync] user=X providerUserId=Y error=...')`
- Fehler werden zusätzlich in DB-Feld `last_sync_error` geschrieben → UI Banner

---

## 7. Testing

### 7.1 Unit-Tests (Backend)

**`localUsageRepo`:**
- `add/list/remove/setEnabled/updateLabel` per ID
- `UNIQUE`-Constraint: 2. Add mit gleicher `(user_id, provider_user_id)` → throws (Controller fängt es als 409)
- `listAllActiveProviderUserIds`: liefert über mehrere Tracker-User korrekt
- `getLocalUsageSummary` mit `perSource`-Aggregation:
  - Events mit `origin_app` → eigener Bucket
  - Events ohne `origin_app` → Fallback-Bucket nach `provider_user_id` (mit Label aus Tabelle)
  - Leere DB → leeres `perSource` + `total.calls=0`
  - Mixed: 2 origin_apps + 1 nullable Source → 3 Buckets

**`providerServiceSyncService`:**
- Zwei aktive IDs: eine erfolgreich, eine 401 → `perId` enthält beide, `ok=false`, `newEvents` ≥ 1
- Master-Toggle `enabled=0` → returnt sofort `ok:true, newEvents:0`, fetch nie aufgerufen

### 7.2 Integration

- DB-Migration: lege eine alte Sub-A-Config mit `provider_user_id='X'` an, boote initDatabase neu → `provider_service_user_ids` enthält genau einen Eintrag mit `provider_user_id='X'`

### 7.3 Manual Smoke nach Deploy

1. Bestehende `03bd2c3d-...`-Config ist nach Migration als ein Eintrag in der neuen Tabelle sichtbar
2. Hinzufügen einer zweiten ID (`wolfini_de_web`) via UI mit Label "WordPress"
3. "Verbindung testen" → SyncResult zeigt 2 IDs in `perId`
4. Card zeigt zwei Mini-Karten (`bewerbungstracker` + `WordPress` oder `wolfini_de_web` wenn origin_app NULL)
5. Master-Toggle deaktivieren → Cron-Tick passiert nichts → UI Status entsprechend
6. Label-Edit auf einer ID → PATCH-Request → UI updated
7. Delete einer ID → Bestätigung → DELETE → Card-Anzeige reduziert sich

---

## 8. Rollout-Reihenfolge

1. **Backend deployen** — Migration läuft beim Server-Start, kopiert bestehenden Eintrag in neue Tabelle. Spalte in `user_provider_service_config` bleibt für Rollback-Sicherheit.
2. **Frontend deployen** — Multi-Card-Rendering + neue Settings-UI.
3. **Smoke-Tests live** (s.o. Section 7.3).
4. **Zweite ID hinzufügen** (`wolfini_de_web` mit Label "WordPress"), als realer Multi-Source-Test.

### Rollback
- Code-Rollback via `git reset --hard <prev>` (wie bei Sub-A).
- Schema-Rollback: nicht nötig. Alte Spalte ist noch da, alte Code-Pfade lesen sie. In neuer Tabelle hinzugefügte IDs wären für altes UI "unsichtbar" — was OK ist (altes UI konnte eh nur eine).

---

## 9. Bekannte Risiken / Out-of-Scope

- **Storage-Verdopplung** bei zwei Tracker-Usern mit gleicher `provider_user_id`: Events werden zweimal gespiegelt. Aktuell kein Real-Case (du bist alleiniger Nutzer), aber bei Multi-Tenancy ein Optimierungs-Kandidat.
- **Card-Höhe bei vielen Sources**: Bei >9 Sources wird das Grid sehr hoch. Pagination/Limit auf Top-N erst dann, wenn realer Use-Case auftaucht.
- **Label-Sortierung**: Aktuell sortiert nach `totalTokens DESC` (= "Mein größter Verbraucher zuerst"). Falls falsch, anpassbar mit Sort-Toggle — Out-of-Scope.
- **Cleanup der alten Spalten**: Ein Folge-Commit räumt `user_provider_service_config.provider_user_id` / `last_sync_*` weg, sobald die neue Tabelle stable produziert. Nicht Teil dieses Specs.

---

## 10. Folge-Sub-Projekte (zur Orientierung)

- **B — Spar-Empfehlungen**: Vergleicht Claude-Kosten mit Provider-Service-Nutzung pro `origin_app`. *"Bewerbungstracker macht 80% deiner LLM-Calls lokal. WordPress nicht — wäre `qwen3-coder` hier auch eine Option?"*
- **C — Routing-Steuerung**: UI schreibt Routing-Regeln in den `ai-provider-service`.
