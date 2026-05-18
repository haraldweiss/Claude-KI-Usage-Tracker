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
// Returns true bei Erfolg, false bei Skip/Failure. Wirft NICHT (Failure-Modes
// werden via last_error stamping in catalog_hf_cache geloggt).
export async function generateAndCacheProsCons(card: ModelCard): Promise<boolean>;

// Batch-Variante: ruft generateAndCacheProsCons() für jedes Card auf,
// rate-limited (sequentiell, ~2s Pause zwischen Calls).
export async function generateBatchProsCons(cards: ModelCard[]): Promise<{
  generated: number;
  skipped: number;
  failed: number;
}>;

// Boolean: ist B.3 überhaupt aktiv? (Env-Vars gesetzt?)
export function isProsConsEnabled(): boolean;
```

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

Zwei neue Environment-Variablen, gesetzt im systemd-Unit:

```
CATALOG_LLM_URL=https://ai.wolfinisoftware.de
CATALOG_LLM_TOKEN=<Bearer-Token>
```

- Beide fehlen / leer → `isProsConsEnabled()` returnt `false` → Generation skippt.
  Existierende Pros/Cons im Cache bleiben unangetastet.
- Wird in `/etc/systemd/system/claudetracker-backend.service.d/override.conf`
  via `Environment=` Direktiven gesetzt. Bei der lokalen Dev-Umgebung in
  `backend/.env` (gitignored).
- Token wird in derselben Datei wie `SECRETS_KEY` & andere Secrets gepflegt.

### Failure-Modes & Retry-Policy

| Fall                              | Verhalten                                          |
|-----------------------------------|----------------------------------------------------|
| `CATALOG_LLM_*` Env-Vars fehlen   | Generation komplett skippen, kein Error            |
| HTTP 5xx vom Provider             | `last_error` stempeln, nächster Cron probiert erneut |
| Timeout (30s)                     | wie 5xx                                            |
| Response ist kein gültiges JSON   | 1× retry mit verschärftem System-Prompt, dann skip |
| Response-JSON ohne `pros`/`cons`  | `last_error` stempeln, skip                        |
| `pros`/`cons` falsche Länge (≠3)  | trimmen oder skip wenn 0                           |
| Pool ist down                     | wie 5xx                                            |
| Network-Error                     | wie 5xx                                            |

Generation läuft **sequentiell** mit ~2s Pause zwischen Repos um den Pool nicht
zu hämmern. Bei 6 Latest Uploads = ~15s Dauer, bei 10 Such-Treffern = ~25s — beides
unkritisch im Hintergrund.

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
- `catalogProsConsService.generateAndCacheProsCons(card)`:
  - Happy-Path: fetch returns gültiges JSON → upsert mit pros/cons
  - HTTP 500 → `recordCacheError` aufgerufen, kein Upsert
  - Kein JSON → retry mit strikterem Prompt → bei zweitem Fehler skip
  - Env-Vars fehlen → returnt false, kein fetch
- `catalogProsConsService.generateBatchProsCons(cards)` — Counters stimmen, sequenziell.
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
