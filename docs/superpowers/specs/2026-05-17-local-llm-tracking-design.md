# Sub-Projekt A — Lokale LLM-Nutzung im Tracker sichtbar machen

**Datum:** 2026-05-17
**Status:** Design / Spec
**Folge-Projekte:** B (Spar-Empfehlungen), C (Routing-Steuerung) — beide Out-of-Scope hier

---

## 1. Hintergrund und Motivation

Der **Claude Usage Tracker** zeigt heute Kosten aus drei Anthropic-Quellen
(`claude.ai`, `console.anthropic.com`, Claude Code). Daneben betreibt der
Nutzer einen eigenen Multi-Provider-Gateway, den **`ai-provider-service`**
(Repo: <https://github.com/haraldweiss/ai-provider-service>), der Calls auf
Claude, **Ollama**, OpenAI, Mammouth und Custom verteilt. Lokale Calls über
Ollama / llama.cpp sind heute im Tracker unsichtbar.

Ziel: Lokale (und alle anderen über den Gateway laufenden) Calls als **vierte
Datenquelle** im Tracker sichtbar machen. Konkret eine Übersichts-Karte
"Lokale LLM-Nutzung" mit Tokens/Calls/Modellen — als Fundament, damit spätere
Sub-Projekte (Spar-Empfehlungen, Routing-Steuerung) darauf aufbauen können.

**Treiber:** Der Nutzer will seine Claude-Kosten reduzieren, sieht aber heute
nicht, welcher Anteil seiner LLM-Nutzung schon lokal läuft.

---

## 2. Scope

### In-Scope (dieses Spec)
1. Per-Call-Logging im `ai-provider-service` (neue Tabelle `usage_events`)
2. Logging-Hook im Dispatcher (`dispatcher._execute`)
3. Neue lesende API-Route `GET /usage/events` (inkrementell, Bearer-auth)
4. Neue Sync-Quelle im Tracker-Backend (Cron alle 15 min)
5. Neue Tabellen im Tracker:
   - `user_provider_service_config` (eine pro Tracker-User)
   - `provider_service_events` (Mirror der Events)
6. Settings-Sektion im Frontend (URL / Token / `user_id` / aktiv)
7. Neue Übersichts-Karte **"Lokale LLM-Nutzung"** mit Tokens als Hero-Zahl
8. Vierter Source-Badge `provider-service` im bestehenden Sync-Status-Footer

### Out-of-Scope (kommt später)
- Hero-Zahl-Änderung in der Übersicht (bleibt rein Claude)
- Integration in Modelle-Tabelle, Gesamtkosten-Tab, Trend-Charts
- Spar-Empfehlungen ("Was hätte lokal gehen können?") — Sub-Projekt B
- Routing-Regeln-UI — Sub-Projekt C
- Stromverbrauch-Schätzung für lokale Calls
- Per-User-Tokens im Provider-Service (globaler `SERVICE_TOKEN` reicht erstmal)
- Prompt-Hashes / Latenz / Streaming-Tokens
- Retention / Cleanup alter Events
- `origin_app` Header in den Konsumenten-Apps setzen (Feld wird vorbereitet, bleibt aber bis dahin `NULL`)

---

## 3. Architektur

### 3.1 Datenfluss

```
┌──────────────────────────────────────────────────────────────┐
│                     ai-provider-service                       │
│                                                               │
│  Client-App ──► POST /chat ──► dispatcher._execute()          │
│                                       │                       │
│                                       ├──► Provider call      │
│                                       │                       │
│                                       └──► usage_events INSERT │
│                                              (neu)             │
│                                                               │
│  Tracker ──► GET /usage/events?user_id=X&since=ts             │
│              [Bearer SERVICE_TOKEN]                            │
│                       │                                        │
│                       └──► SELECT FROM usage_events            │
└───────────────────────┼───────────────────────────────────────┘
                        │
                        ▼ Pull, alle 15 min
┌──────────────────────────────────────────────────────────────┐
│                     Claude Usage Tracker                      │
│                                                               │
│  Cron (15 min) ──► providerServiceSyncService.ts (neu)        │
│                          │                                     │
│                          └──► INSERT INTO provider_service_   │
│                                          events                │
│                                                                │
│  React Dashboard ──► GET /api/local-usage/summary             │
│                                                                │
│  Settings ──► saved per Tracker-User:                         │
│                provider_service_url                            │
│                provider_service_token (encrypted)              │
│                provider_service_user_id                        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Wichtige Architektur-Entscheidungen

- **Pull statt Push:** Tracker pollt den Provider-Service inkrementell.
  Vorteil: keine Live-Kopplung; bei Tracker-Ausfall bleiben Daten in der
  Provider-Service-DB und werden beim nächsten Poll nachgeholt; Provider-
  Service muss vom Tracker nichts wissen.
- **Mirror in Tracker-DB:** Events werden in der Tracker-SQLite gespiegelt
  (nicht bei jedem Dashboard-Aufruf live aus dem Provider-Service geladen).
  Damit funktioniert das Dashboard auch bei Provider-Service-Ausfall mit
  historischen Daten weiter.
- **Cost-Berechnung im Provider-Service:** Dort liegt das Wissen, welcher
  Provider lokal ist. Tracker speichert nur das fertige Resultat.
- **Event-orientiertes Schema** statt aggregierter Snapshots: Sub-Projekt B
  wird Detail-Analysen brauchen (welche Modelle, welche Apps, welche
  Tageszeiten), die mit Aggregaten nicht mehr rekonstruierbar wären.

---

## 4. Änderungen im `ai-provider-service`

### 4.1 Neue Tabelle `usage_events`

Datei: [`storage/models.py`](/Users/haraldweiss/projects/ai-provider-service/storage/models.py)

```python
class UsageEvent(db.Model):
    __tablename__ = 'usage_events'

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow,
                           nullable=False, index=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    provider_id = db.Column(db.String(32), nullable=False, index=True)
    model = db.Column(db.String(128), nullable=False)
    input_tokens = db.Column(db.Integer, nullable=True)   # NULL bei Fehler
    output_tokens = db.Column(db.Integer, nullable=True)
    cost_usd = db.Column(db.Numeric(10, 6), nullable=True)  # 0 bei lokal, NULL bei Fehler/Unbekannt
    origin_app = db.Column(db.String(64), nullable=True)
    status = db.Column(db.String(16), nullable=False)     # 'success' | 'error'
    error_message = db.Column(db.Text, nullable=True)     # nur bei status='error'
```

Migration: `db.create_all()` beim Server-Start legt die Tabelle additiv an —
keine Eingriffe in bestehende Tabellen.

### 4.2 Hook im Dispatcher

Datei: [`dispatcher.py`](/Users/haraldweiss/projects/ai-provider-service/dispatcher.py), Methode `_execute` (Zeile 57 ff.)

Erweiterung **nur in `_execute`** — minimal-invasiv:

```python
def _log_usage_event(user_id, provider_id, model, input_t, output_t,
                     status, error=None, origin_app=None):
    cost = _calc_cost_usd(provider_id, model, input_t, output_t)
    db.session.add(UsageEvent(
        user_id=user_id, provider_id=provider_id, model=model,
        input_tokens=input_t, output_tokens=output_t, cost_usd=cost,
        origin_app=origin_app, status=status, error_message=error,
    ))
    db.session.commit()


def _execute(user_id, provider_id, model, messages, max_tokens,
             config_override=None, origin_app=None):
    # … vorhandener Code unverändert bis client.create_message …
    try:
        result = client.create_message(model, messages, max_tokens)
        health_tracker.set_status(provider_id, True)
        usage = result.get('usage', {}) or {}
        _log_usage_event(user_id, provider_id, model,
                         usage.get('input_tokens'), usage.get('output_tokens'),
                         'success', origin_app=origin_app)
        return result
    except Exception as e:
        health_tracker.set_status(provider_id, False, reason=f"{type(e).__name__}: {e}")
        _log_usage_event(user_id, provider_id, model, None, None,
                         'error', error=f"{type(e).__name__}: {e}",
                         origin_app=origin_app)
        raise
```

`origin_app` wird durch `dispatch` und über `/chat`-Route durchgereicht (Header
`X-Origin-App`); heute nicht gesetzt von den Konsumenten-Apps → Feld bleibt
`NULL`.

**Edge:** Beim Fallback-Pfad (Primary down → Fallback) wird *für jeden
ausgeführten Provider* ein eigenes Event geschrieben (zwei Events: einer mit
status='error' für Primary, einer mit status='success' für Fallback). Das
zeigt im Tracker die Realität sauber ab.

### 4.3 Cost-Berechnung (`_calc_cost_usd`)

Neue Datei `pricing.py` (oder direkt im Dispatcher, falls keine zweite
Verwendung absehbar):

```python
# USD pro 1M Tokens. Quelle: manuell gepflegt, Snapshot Mai 2026.
_PRICING_USD_PER_MTOK = {
    ('claude', 'claude-opus-4-7'):       {'in': 15.0, 'out': 75.0},
    ('claude', 'claude-sonnet-4-6'):     {'in':  3.0, 'out': 15.0},
    ('claude', 'claude-haiku-4-5'):      {'in':  0.8, 'out':  4.0},
    ('openai', 'gpt-4o'):                {'in':  2.5, 'out': 10.0},
    ('openai', 'gpt-4o-mini'):           {'in':  0.15, 'out': 0.6},
    # 'ollama' und 'custom' (mit lokalem Endpoint) → 0
}

_LOCAL_PROVIDERS = {'ollama'}

def _calc_cost_usd(provider_id, model, input_t, output_t):
    if input_t is None or output_t is None:
        return None
    if provider_id in _LOCAL_PROVIDERS:
        return 0.0
    # 'custom' Provider: per Spec für Sub-Projekt A immer als kostenpflichtig
    # behandeln (NULL, falls Modell nicht in Preistabelle). Sonst würden lokal
    # über LM Studio betriebene Endpoints mit Cloud-Endpoints kollidieren.
    # Sub-Projekt B kann das verfeinern (z.B. Endpoint-Pattern '127.0.0.1' → 0).
    rates = _PRICING_USD_PER_MTOK.get((provider_id, model)) \
        or _PRICING_USD_PER_MTOK.get((provider_id, _strip_version(model)))
    if not rates:
        return None  # unbekannt → Tracker rechnet damit als "0 € (unbekannt)"
    return (input_t * rates['in'] + output_t * rates['out']) / 1_000_000
```

`_strip_version` macht aus `"claude-haiku-4-5-20251001"` → `"claude-haiku-4-5"`
für robustes Matching.

### 4.4 Neue API-Route `GET /usage/events`

Neue Datei: `api/usage_api.py`

```python
@bp.route('/usage/events', methods=['GET'])
@require_service_token  # bestehender Decorator aus api/auth.py
def list_events():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    since = request.args.get('since')  # ISO-Timestamp, optional
    limit = min(int(request.args.get('limit', 500)), 2000)

    q = UsageEvent.query.filter_by(user_id=user_id)
    if since:
        try:
            q = q.filter(UsageEvent.created_at > datetime.fromisoformat(since))
        except ValueError:
            return jsonify({'error': 'invalid since timestamp'}), 400

    rows = q.order_by(UsageEvent.created_at.asc()).limit(limit).all()

    return jsonify({
        'events': [_event_to_dict(r) for r in rows],
        'count': len(rows),
        'next_since': rows[-1].created_at.isoformat() if rows else since,
        'has_more': len(rows) == limit,
    })
```

Route-Registrierung in `app.py`, gleicher Stil wie die anderen Blueprints.

### 4.5 Was unverändert bleibt
- `health_tracker`, `RequestQueue`, Fallback-Logik
- Provider-Clients (Token-Counts kommen schon aus dem bestehenden Return-Format)
- Bestehende Konsumenten-App-Auth, CORS-Konfiguration

---

## 5. Änderungen im Tracker-Backend

### 5.1 Neue Tabellen

Additive Erweiterung in [`backend/src/database/sqlite.ts`](/Library/WebServer/Documents/KI%20Usage%20tracker/backend/src/database/sqlite.ts):

```sql
CREATE TABLE IF NOT EXISTS user_provider_service_config (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  service_url        TEXT NOT NULL,
  service_token_enc  TEXT NOT NULL,
  provider_user_id   TEXT NOT NULL,
  last_sync_at       TEXT,
  last_sync_cursor   TEXT,
  last_sync_error    TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_service_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_event_id   INTEGER NOT NULL,
  remote_created_at TEXT NOT NULL,
  provider_id       TEXT NOT NULL,
  model             TEXT NOT NULL,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_usd          REAL,
  origin_app        TEXT,
  status            TEXT NOT NULL,
  error_message     TEXT,
  ingested_at       TEXT NOT NULL,
  UNIQUE (user_id, remote_event_id)
);
CREATE INDEX IF NOT EXISTS idx_pse_user_created
  ON provider_service_events(user_id, remote_created_at);
CREATE INDEX IF NOT EXISTS idx_pse_provider
  ON provider_service_events(user_id, provider_id);
```

Die `UNIQUE`-Constraint macht Polls über `INSERT OR IGNORE` idempotent — der
Cursor reicht zwar normalerweise, aber Gürtel-und-Hosenträger schadet nicht.

### 5.2 Token-Verschlüsselung

Neue Helper-Datei `backend/src/utils/secretCrypto.ts`:
- AES-256-GCM
- Neuer Env-Var `SECRETS_KEY` (Base64-32-Byte, beim Setup einmalig erzeugt)
- API: `encryptSecret(plain: string): string` / `decryptSecret(enc: string): string`
- Storage-Format: `<iv-base64>:<authtag-base64>:<ciphertext-base64>`

Falls `SECRETS_KEY` verloren geht → User muss seinen Service-Token in den
Settings erneut eintragen. In `ENV_SETUP.md` dokumentieren.

### 5.3 Neuer Sync-Service

Neue Datei: `backend/src/services/providerServiceSyncService.ts`

```typescript
export interface SyncResult {
  ok: boolean;
  newEvents: number;
  error?: string;
}

export async function syncProviderServiceEvents(userId: number): Promise<SyncResult> {
  const config = await getProviderServiceConfig(userId);
  if (!config || !config.enabled) return { ok: true, newEvents: 0 };

  const token = decryptSecret(config.service_token_enc);
  let cursor = config.last_sync_cursor ?? null;
  let totalNew = 0;

  try {
    while (true) {
      const url = new URL('/usage/events', config.service_url);
      url.searchParams.set('user_id', config.provider_user_id);
      if (cursor) url.searchParams.set('since', cursor);
      url.searchParams.set('limit', '500');

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      for (const ev of data.events) {
        const inserted = insertEventIfNew(userId, ev); // INSERT OR IGNORE
        if (inserted) totalNew++;
      }

      cursor = data.next_since;
      if (!data.has_more) break;
    }

    await updateSyncStatus(userId, {
      last_sync_at: new Date().toISOString(),
      last_sync_cursor: cursor,
      last_sync_error: null,
    });
    return { ok: true, newEvents: totalNew };
  } catch (e: any) {
    await updateSyncStatus(userId, { last_sync_error: e.message });
    return { ok: false, newEvents: totalNew, error: e.message };
  }
}
```

### 5.4 Cron / Scheduler

In [`backend/src/server.ts`](/Library/WebServer/Documents/KI%20Usage%20tracker/backend/src/server.ts) eingehängt, analog zu den bestehenden Scheduled-Tasks:

```typescript
setInterval(async () => {
  const users = await listUsersWithProviderServiceConfig();
  for (const u of users) {
    await syncProviderServiceEvents(u.id).catch(err =>
      console.error('[provider-service-sync] user', u.id, err));
  }
}, 15 * 60 * 1000);
```

### 5.5 Neue Routen

Neue Datei `backend/src/routes/localUsage.ts` mit Controller `localUsageController.ts`:

| Route | Methode | Zweck |
|---|---|---|
| `/api/local-usage/summary?period=day\|week\|month` | GET | Aggregates für die neue Karte: total tokens (in/out), calls, top-models, ratio lokal vs. nicht-lokal |
| `/api/local-usage/sync-status` | GET | `last_sync_at`, `last_sync_error` für den Footer |
| `/api/local-usage/sync` | POST | Manueller Sync-Trigger |
| `/api/local-usage/config` | GET | Settings-Anzeige (Token wird als `"***"` zurückgegeben, falls gesetzt) |
| `/api/local-usage/config` | PUT | Settings speichern (Token wird verschlüsselt) |

Alle Routen via bestehender Session-Middleware authentifiziert.

---

## 6. Änderungen im Tracker-Frontend

### 6.1 Neue Komponente `LocalUsageCard.tsx`

Eingehängt in [`components/OverviewTab.tsx`](/Library/WebServer/Documents/KI%20Usage%20tracker/frontend/src/components/OverviewTab.tsx) als zusätzliche Karte.

**Inhalt:**
- Titel: **"Lokale LLM-Nutzung"** + Source-Badge `provider-service`
- Hero-Zahl: **Gesamt-Tokens dieses Monats**, formatiert mit Tausenderpunkten
  - z.B. *"847 523 Tokens"*
- Unter der Hero-Zahl, kleinere Schrift:
  - Input/Output getrennt: *"In: 612 312 · Out: 235 211"*
  - Calls + Durchschnitt: *"142 Calls · ⌀ 5 969 Tok/Call"*
- Ratio-Zeile (wenn vorhanden): *"42% deiner LLM-Calls liefen lokal → 0 €"*
- Top-3 Modelle als kleine Liste: `llama3.1:8b · 124 Calls`, …
- Fehler-Hinweis (rotes Banner) falls letzter Sync fehlgeschlagen, mit Link
  "manuell synchronisieren"
- Empty-State: "Noch keine Daten — konfiguriere den AI-Provider-Service in
  den Einstellungen" mit Settings-Link

### 6.2 Neue Settings-Sektion

Neue Komponente unter [`components/settings/`](/Library/WebServer/Documents/KI%20Usage%20tracker/frontend/src/components/settings/), eingehängt in [`pages/Settings.tsx`](/Library/WebServer/Documents/KI%20Usage%20tracker/frontend/src/pages/Settings.tsx).

Felder:
- **Service-URL** (text)
- **Service-Token** (password, write-only — GET liefert `"***"` falls gesetzt)
- **Meine user_id im Provider-Service** (text)
- **Aktiv** (toggle)

Buttons:
- **Speichern**
- **Verbindung testen** — ruft `POST /api/local-usage/sync` und zeigt Ergebnis
  ("X neue Events erhalten" bzw. Fehler)

Status-Anzeige:
- Zeitstempel des letzten erfolgreichen Syncs
- Letzte Fehlermeldung (falls vorhanden)

### 6.3 Sync-Status-Footer-Erweiterung

Vierter Badge `provider-service` im bestehenden Footer (gleiches UI-Pattern):
"vor X min synchronisiert" oder "Fehler" mit Tooltip.

### 6.4 API-Service-Erweiterung

In [`services/`](/Library/WebServer/Documents/KI%20Usage%20tracker/frontend/src/services/) neue typed Funktionen:
- `getLocalUsageSummary(period)`
- `getLocalUsageSyncStatus()`
- `triggerLocalUsageSync()`
- `getProviderServiceConfig()` / `updateProviderServiceConfig(config)`

### 6.5 Was nicht angefasst wird
- `ModelsTab`, `CombinedCostTab`, `InsightsBlock`, Hero-Zahl der Übersicht,
  Trend-Charts
- `RecommendationsPage` (kommt in Sub-Projekt B)
- Login / Auth-Flows

---

## 7. Edge Cases & Fehlerbehandlung

| Szenario | Verhalten |
|---|---|
| Provider-Service down beim Sync | `last_sync_error` setzen, beim nächsten Cron erneut versuchen, Karte zeigt rotes Banner mit Fehlertext |
| Mehr Events als `limit` pro Poll | Tracker pollt in Schleife mit Cursor, bis `has_more=false` |
| Erster Sync (kein Cursor) | `since` weggelassen → Provider-Service liefert *alle* Events; Tracker spiegelt sie |
| 401 (Token falsch/abgelaufen) | `last_sync_error = "auth failed"`, Settings-Banner |
| `user_id` falsch / unbekannt | Provider-Service liefert leere Liste — kein Fehler. Test-Button zeigt "0 Events erhalten" als Indiz |
| Unbekanntes Modell | `cost_usd = NULL` im Event. Tracker zeigt es als 0 € im Aggregat, Token-Zahlen bleiben korrekt |
| Cron-Run > 15 min | Egal — `UNIQUE(user_id, remote_event_id)` macht Re-Polls idempotent |
| Provider-Service-DB-Wipe | Bekannte Einschränkung: Tracker würde neue Events mit `remote_event_id=1` als Duplikat alter Events sehen. Mitigation: Provider-Service-DB nicht wipen. Falls doch: Tracker-Tabelle für diesen User leeren (manueller SQL-Eingriff) |
| Zeitsync zwischen Servern | Irrelevant — Cursor und Timestamps basieren beide auf Provider-Service-Zeit |
| Events-Tabelle wächst | Erwartet ≈ 365 k Rows/Jahr bei 1 000 Calls/Tag — SQLite mit Index unproblematisch. Retention-Job ist Out-of-Scope |
| Fallback-Pfad im Provider-Service | Zwei Events werden geschrieben (Primary error + Fallback success); Tracker zeigt beide |

---

## 8. Testing

### 8.1 Unit-Tests

**`ai-provider-service`** (pytest):
- `_calc_cost_usd`: lokale Provider → 0; bekanntes Claude-Modell → korrekt berechnet; unbekanntes Modell → `None`; `_strip_version` → matched versionierte Modellnamen
- `_execute`: Success-Pfad schreibt Event mit `status='success'` und Token-Counts; Error-Pfad schreibt Event mit `status='error'` und Fehlertext; Fallback-Pfad schreibt zwei Events

**Tracker** (vitest):
- `secretCrypto`: Encrypt + Decrypt Roundtrip; manipulierte Ciphertexts werfen
- `providerServiceSyncService`: Mock-fetch mit pagination (zwei Seiten), prüft Cursor-Update und `INSERT OR IGNORE` bei doppelten IDs; Fehler-Pfad setzt `last_sync_error`
- `localUsageController.summary`: aggregiert Tokens, Calls und Ratio korrekt; leere DB → Empty-Response

### 8.2 Integration

- Lokaler Stack: Tracker-Backend + lokaler `ai-provider-service` (Ollama-Provider). Echter Call → Event in Provider-Service-DB → Tracker pollt → Event in Tracker-DB → Karte zeigt Daten.

### 8.3 Manual Smoke-Test nach Deploy

1. Test-Call gegen Provider-Service (via existierende App oder direktes `curl`)
2. Manueller Sync-Button im Tracker → Karte aktualisiert sich
3. Settings-Token absichtlich falsch setzen → roter Banner im Frontend
4. Provider-Service stoppen → nächster Cron-Run zeigt Fehler im Footer

---

## 9. Rollout-Reihenfolge

1. **Provider-Service zuerst:** Tabelle, Hook, Route. Fail-safe — bestehende
   Funktionalität ist unberührt.
2. **Tracker-Backend:** Tabellen, Sync-Service, Routen. Fail-safe — Cron läuft
   nur für User mit Config; keine Config = nichts passiert.
3. **Tracker-Frontend:** Settings-Sektion + Karte. Fail-safe — Empty-State,
   wenn noch keine Daten vorhanden.
4. **Konfiguration & Verifikation:** Eigene Settings ausfüllen, Test-Sync,
   Provider-Service mit echtem Call füttern, prüfen ob Daten ankommen.
5. **Cron beobachten:** Einige Tage laufen lassen, auf `last_sync_error` schauen.

---

## 10. Bekannte Risiken

- **Token-Sicherheit:** Globaler `SERVICE_TOKEN` gibt theoretisch jedem
  Tracker-User Zugriff auf die Events aller anderen `user_id`s im
  Provider-Service. Im aktuellen Single-User-Setup nicht relevant. Für späteren
  Multi-User-Betrieb in eigenem Sub-Projekt zu adressieren.
- **`SECRETS_KEY`-Verlust:** Verschlüsselte Tokens werden unbrauchbar. User
  müssen ihren Token in den Settings neu eintragen. Dokumentation in
  `ENV_SETUP.md`.
- **Snapshot-Pricing in `_calc_cost_usd`:** Statische Tabelle, veraltet
  potenziell. Update via PR, oder später Anbindung an LiteLLM-Snapshot
  analog zum bestehenden `litellmPricingSource.ts` im Tracker.
- **`origin_app`-Header noch nicht von Apps gesetzt:** Feld bleibt `NULL` bis
  Konsumenten-Apps angepasst sind. Auswertungen "welche App frisst mein
  Budget?" sind erst danach sinnvoll.

---

## 11. Folge-Sub-Projekte (zur Orientierung, nicht Teil dieser Spec)

- **B — Spar-Empfehlungen:** Vergleicht Claude-Calls (aus Console + claude.ai)
  mit der jetzt sichtbaren Provider-Service-Nutzung; identifiziert Muster
  ("simple Code-Erklärungen", "kurze Q&A") und schlägt Ersparnisse vor.
- **C — Routing-Steuerung:** UI im Tracker, die Routing-Regeln in den
  `ai-provider-service` schreibt ("alle Calls < 2k Tokens → Ollama").
