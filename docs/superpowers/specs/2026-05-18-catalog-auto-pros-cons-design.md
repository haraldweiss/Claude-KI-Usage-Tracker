# Sub-Projekt B.3: Auto-Pros/Contras im Modell-Katalog

**Status:** Spec
**Datum:** 2026-05-18
**Vorgänger:** B.2 (Latest-Uploads-Sektion)

## Ziel

Modelle in der dynamischen "Frisch hochgeladen"-Sektion und in Suchergebnissen
zeigen heute keine Hinweise auf ihren Anwendungszweck. Nutzer können nicht
einschätzen, wofür sich ein Modell eignet, ohne den HF-Repo manuell zu öffnen.

B.3 generiert für diese Modelle automatisch je 3 Pro- und 3 Contra-Bullets in
Deutsch — qualitativ vergleichbar mit den handgeschriebenen Listen der
kuratierten Sektionen, aber ohne manuelle Pflege.

## Scope

In Scope:
- **Latest Uploads** (6 Repos, refreshed um 04:00 + Initial-Prime)
- **Suchergebnisse** (Top 10 pro Query, fire-and-forget im Hintergrund)
- **30-Tage-TTL** für regenerierte Pros/Contras
- **90-Tage-Eviction** für nicht-kuratierte / nicht-latest Such-Treffer im Cache

Nicht in Scope:
- Pros/Contras für kuratierte Sektionen (bleiben handgeschrieben)
- Frontend-Änderungen (Cards rendern `pros`/`cons` schon heute)
- Mehrsprachigkeit (nur DE; EN-Variante wäre eigenes Sub-Projekt)
- User-Feedback-Loop ("nicht hilfreich"-Button) — separater Spec falls gewünscht

## Architektur

### Komponenten-Überblick

```
┌─────────────────────────────────────────────────────────────────┐
│  04:00 Cron / Initial-Prime                                     │
│    ├── refreshCuratedHfCache()                                  │
│    ├── refreshLatestUploads()    ──┐                            │
│    │                               │                            │
│    │                               ▼                            │
│    │   for each repo without pros (or stale > 30d):             │
│    │       catalogProsConsService.generateAndCache(card)        │
│    │           ├── buildPrompt(card)                            │
│    │           ├── fetch CATALOG_LLM_URL/v1/chat/completions    │
│    │           ├── parseJsonResponse(content)                   │
│    │           └── upsertCardCache(repo, {...card, pros, cons}) │
│    │                                                            │
│    └── evictStaleSearchCacheRows()  // > 90d, nicht curated/latest │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  GET /api/catalog/search?q=...                                  │
│    ├── searchModels(q)                  → return immediately    │
│    └── (async, fire-and-forget)                                 │
│           for top-10 results without cached pros:               │
│               catalogProsConsService.generateAndCache(card)     │
└─────────────────────────────────────────────────────────────────┘
```

### Daten-Modell

`ModelCard` (existing interface in `catalogService.ts`) erweitert um:

```typescript
interface ModelCard {
  // existing fields...
  pros?: string[];
  cons?: string[];
  auto_pros_generated_at?: string;  // ISO-8601; nur gesetzt bei LLM-generiert
}
```

Speicherung: `catalog_hf_cache.data_json` enthält die komplette ModelCard als JSON.
Kein Schema-Change nötig. Frontend liest `pros`/`cons` schon heute aus dem
Catalog-Response.

### Service-Modul: `catalogProsConsService.ts`

Neuer Service in `backend/src/services/`. Öffentliche API:

```typescript
// Versucht Pros/Cons für ein Modell zu generieren und in den Cache zu schreiben.
// Probiert primär mistral-nemo via eigene Pool, fällt bei Failure auf
// Claude Haiku 4.5 zurück (falls Fallback konfiguriert).
// Returns true bei Erfolg, false bei Skip/Failure. Wirft NICHT (Failure-Modes
// werden via last_error stamping in catalog_hf_cache geloggt).
export async function generateAndCacheProsCons(card: ModelCard): Promise<boolean>;

// Batch-Variante: ruft generateAndCacheProsCons() für jedes Card auf,
// rate-limited (sequentiell, ~2s Pause zwischen Calls).
export async function generateBatchProsCons(cards: ModelCard[]): Promise<{
  generated: number;
  skipped: number;
  failed: number;
  fallback_used: number;  // # Repos, die via Anthropic generiert wurden
}>;

// Boolean: ist B.3 überhaupt aktiv? (Mindestens primärer LLM konfiguriert?)
export function isProsConsEnabled(): boolean;
```

### Provider-Strategie: Primary + Fallback

```
generateAndCacheProsCons(card):
    1. Falls Primary (mistral-nemo) konfiguriert:
         → try callPrimary(card)
         → bei Success: upsert mit pros/cons, return true
         → bei Failure: log warn, weiter zu Schritt 2
    2. Falls Fallback (Claude Haiku) konfiguriert:
         → try callFallback(card)
         → bei Success: upsert mit pros/cons, markiere fallback_used, return true
         → bei Failure: log error, weiter zu Schritt 3
    3. recordCacheError(repo, "primary + fallback both failed"), return false
```

Failure beim Primary = jeder der Failure-Modes aus der Tabelle weiter unten
(Timeout, HTTP 5xx, ungültiges JSON nach 1 Retry, Network-Error).

Konkrete Implementierung: zwei Adapter-Funktionen mit derselben Signatur
`(card: ModelCard) => Promise<{pros: string[]; cons: string[]}>`:
- `callPrimaryLLM(card)` → POST `CATALOG_LLM_URL/v1/chat/completions` (OpenAI-compat)
- `callFallbackLLM(card)` → POST `https://api.anthropic.com/v1/messages` (Anthropic-native)

Beide returnen das gleiche normalisierte `{pros, cons}` Format. Der äußere
generateAndCacheProsCons-Wrapper ruft beide nacheinander wenn nötig.

### Prompt-Template

Erzwingt JSON-Output via System-Prompt + User-Prompt. Beispiel:

```
SYSTEM:
Du bist ein Experte für lokale Open-Source-LLMs. Du bewertest Modelle für
deutschsprachige Entwickler:innen und gibst kompakte Pro/Contra-Listen aus.
Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach.

USER:
Modell: {repo}
Größe: {size_b}B Parameter, {quant_count} Quantisierungen verfügbar
Veröffentlicht von: {source_label}
Beschreibung (HuggingFace): {description ?? "—"}

Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),
konkret und praxisnah:
- Pros: Anwendungsfälle, Stärken, was das Modell gut macht
- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist

Antworte als JSON:
{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}
```

### JSON-Parsing

LLM-Output ist nicht garantiert reines JSON. Parser muss tolerant sein:
1. Versuche direktes `JSON.parse(content)`.
2. Falls Fehler: extrahiere ersten `{...}`-Block per RegEx, parse ihn.
3. Validiere Struktur: `pros` und `cons` müssen Arrays mit jeweils 3 Strings sein.
4. Trimme/normalisiere die Strings (max. 80 Zeichen, kein leerer String).
5. Bei Validierungsfehler: throw, der Caller stempelt `last_error`.

### Konfiguration

Drei (bzw. vier) neue Environment-Variablen, gesetzt im systemd-Unit:

```
# Primary: eigene Pool (mistral-nemo via ai-provider-service)
CATALOG_LLM_URL=https://ai.wolfinisoftware.de
CATALOG_LLM_TOKEN=<Bearer-Token>

# Fallback: Anthropic Claude Haiku 4.5 (nur genutzt wenn Primary versagt)
CATALOG_LLM_FALLBACK_ANTHROPIC_KEY=sk-ant-...
CATALOG_LLM_FALLBACK_MODEL=claude-haiku-4-5     # optional, Default = "claude-haiku-4-5"
```

Verhalten je nach Konfiguration:
- **Beide gesetzt:** Primary first, Fallback bei Primary-Failure. Empfohlen.
- **Nur Primary gesetzt:** Wie B.3 ohne Fallback — bei Primary-Failure wird
  `last_error` gestempelt, nächster Cron probiert erneut.
- **Nur Fallback gesetzt:** Sollte selten vorkommen. Anthropic wird Default-LLM,
  jeder Call kostet. Geht aber wenn man bewusst keine eigene Pool hat.
- **Beide leer:** `isProsConsEnabled()` returnt `false`, B.3 deaktiviert.

Gesetzt in `/etc/systemd/system/claudetracker-backend.service.d/override.conf`
via `Environment=` Direktiven. Lokale Dev-Umgebung: `backend/.env` (gitignored).
Anthropic-Key wird in derselben Datei wie `SECRETS_KEY` gepflegt.

### Failure-Modes & Retry-Policy

Failure-Klassen pro Provider — beide Provider durchlaufen unabhängig dieselbe Tabelle:

| Fall                              | Verhalten innerhalb eines Provider-Calls           |
|-----------------------------------|----------------------------------------------------|
| HTTP 5xx                          | Fehler werfen → äußerer Wrapper probiert Fallback  |
| HTTP 4xx (z.B. 401, 429)          | Fehler werfen → äußerer Wrapper probiert Fallback  |
| Timeout (30s)                     | Fehler werfen → Fallback                           |
| Response ist kein gültiges JSON   | 1× retry mit verschärftem System-Prompt, dann werfen |
| Response-JSON ohne `pros`/`cons`  | Fehler werfen → Fallback                           |
| `pros`/`cons` falsche Länge (≠3)  | trimmen / mit leerem String füllen wenn 1-2 Bullets — nur bei 0 werfen |
| Network-Error                     | Fehler werfen → Fallback                           |

Auf der Wrapper-Ebene:
- Primary wirft → Fallback wird probiert (falls konfiguriert)
- Beide werfen → `recordCacheError(repo, "primary: <msg> / fallback: <msg>")`
- Kein Provider konfiguriert → skip, kein Error

Generation läuft **sequentiell** mit ~2s Pause zwischen Repos um den Pool nicht
zu hämmern. Bei 6 Latest Uploads = ~15s Dauer, bei 10 Such-Treffern = ~25s — beides
unkritisch im Hintergrund. Im Fallback-Fall entfällt der 2s-Pause-Schutz (Anthropic
hat eigenes Rate-Limiting).

### Eviction-Logik

Such-Treffer landen ab B.3 im `catalog_hf_cache`. Damit das nicht unbegrenzt
wächst:

- Im 04:00-Cron, nach den Refresh-Schritten, läuft:
  ```sql
  DELETE FROM catalog_hf_cache
   WHERE fetched_at < datetime('now', '-90 days')
     AND repo NOT IN (<8 curated repos>)
     AND repo NOT IN (SELECT repo FROM catalog_latest_uploads);
  ```
- Curated und Latest sind damit immun. Such-Treffer leben ~90 Tage, dann werden
  sie weggeräumt. Falls sie wieder gesucht werden: neue Generation.

### TTL für Regeneration

Eine Karte gilt als "frisch" wenn `auto_pros_generated_at` jünger als 30 Tage ist.
Der 04:00-Cron prüft pro Latest-Upload und regeneriert, falls stale. Such-Treffer
werden nur einmal generiert (bis sie evicted werden) — kein Refresh-Loop.

## Testbarkeit

### Unit-Tests

- `catalogProsConsService.buildPrompt(card)` — String-Output enthält repo, size_b, description.
- `catalogProsConsService.parseProsCons(content)`:
  - Sauberes JSON → korrektes Objekt
  - JSON in Text eingebettet → korrekt extrahiert
  - Pros/Cons-Arrays falscher Länge → wirft
  - Strings länger 80 Zeichen → trimmt
- `catalogProsConsService.callPrimaryLLM(card)`:
  - Happy-Path: fetch returns gültiges OpenAI-compat JSON → korrektes Objekt
  - HTTP 500 → wirft
  - Kein JSON → retry mit strikterem Prompt → bei zweitem Fehler wirft
  - URL/Token leer → wirft (caller behandelt)
- `catalogProsConsService.callFallbackLLM(card)`:
  - Happy-Path: fetch returns Anthropic-Messages-Response → korrektes Objekt
  - HTTP 4xx (Auth) → wirft
  - Key leer → wirft
- `catalogProsConsService.generateAndCacheProsCons(card)`:
  - Primary success → upsert ohne Fallback-Aufruf
  - Primary fails, Fallback success → upsert mit `fallback_used` markiert
  - Primary fails, Fallback fails → `recordCacheError` mit beiden Messages
  - Beide leer konfiguriert → returnt false, kein Upsert
  - Nur Primary konfiguriert + Primary fails → `recordCacheError` mit nur Primary-Msg
- `catalogProsConsService.generateBatchProsCons(cards)` — Counters stimmen, sequenziell, `fallback_used` zählt.
- `catalogCacheRefresh.refreshLatestUploads` — nach B.3-Integration: ruft Generation für jedes neue Repo auf.
- `catalogCacheRefresh.evictStaleSearchCacheRows` — DELETE-Query, curated/latest bleiben.

### Integration-Test

- `POST /api/catalog/search?q=test` mit gemocktem HF + gemocktem LLM:
  - Endpoint kehrt sofort zurück (kein Wait auf Generation)
  - Nach kurzer Verzögerung: zweiter Call zeigt pros/cons im Cache

## Migration / Rollout

1. Spec + Plan committed
2. systemd override mit Env-Vars vor dem Deploy konfigurieren — sonst läuft B.3
   einfach im "deaktiviert"-Modus durch
3. Deploy: server.ts ist erweitert um Generation nach Latest-Refresh
4. Beim ersten Boot: Initial-Prime triggert Generation für die 6 vorhandenen
   Latest-Uploads → nach ~15s sind Pros/Cons sichtbar
5. Such-Generation wird beim ersten echten User-Search aktiv

Kein Rollback nötig: `pros`/`cons` sind optional im ModelCard, leerer Zustand
ist OK. Bei Bedarf: Env-Vars entfernen + Service-Restart → B.3 deaktiviert,
alles andere unbetroffen.

## Offene Punkte / Folge-Arbeit

- **Token-Tracking:** der Tracker ruft seine eigene ai-provider-service auf.
  Diese Calls erscheinen ja sowieso in den Usage-Events — User wird "self-traffic"
  sehen, was korrekt aber ggf. verwirrend ist. Notiz dazu in der UI? Out-of-scope.
- **Feedback-Loop:** "Pros/Cons nicht hilfreich"-Button → späterer Spec.
- **EN-Variante:** Lokale-Tag basierend auf Browser-Locale → späterer Spec.
- **Bessere Prompt-Qualität:** könnte mit größerem Modell experimentieren (z.B.
  Qwen3-Coder-30B falls verfügbar). Aktuell mistral-nemo, weil dort schon
  produktiv im Einsatz.
