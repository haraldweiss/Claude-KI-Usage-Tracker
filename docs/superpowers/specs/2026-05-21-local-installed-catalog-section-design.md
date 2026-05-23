# Lokal installierte Ollama-Modelle im Catalog

**Status:** Spec
**Datum:** 2026-05-21
**Verwandt:** B.3 (Auto-Pros/Contras), Model-Catalog (B.1)

## Ziel

Die Catalog-Seite (`/claudetracker/catalog`) zeigt heute HF-GGUF-Modelle zum
Pull, markiert aber nur per Badge, welche davon lokal installiert sind. Lokal
installierte Modelle, die NICHT aus dem HF-Pfad kommen (Custom-Builds wie
`mistral-nemo-cc`, `dev-coder`, oder direkte Ollama-Library-Pulls wie
`deepseek-r1:8b`), tauchen damit gar nicht auf.

Dieses Sub-Projekt fügt eine neue Section "Lokal installiert" hinzu, die ALLE
in der lokalen Ollama-Installation vorhandenen Modelle mit 3 Pros + 3 Cons
auflistet. Quelle der Pros/Cons: statische curated Map (sofort), persistenter
Cache, oder LLM-Fallback (lokales Ollama via bestehender Pros/Cons-Pipeline).

## Scope

In Scope:
- Neue Section auf `/catalog`, oberhalb der bestehenden HF-Sektionen
- Statische curated Map für gängige Familien (deepseek-r1, qwen3-coder,
  qwen2.5-coder, mistral-nemo, llama3.1, llama3, nomic-embed-text, gemma/supergemma,
  dev-coder, soc-analyst, soc-detect)
- SQLite-Cache für LLM-generierte Pros/Cons (custom builds, neue Modelle)
- LLM-Fallback via bestehender `catalogProsConsService` Pipeline
- Family-Kategorisierung (Chat / Code / Embedding / Custom) als Badge + Sort-Key

Nicht in Scope:
- Auto-Refresh wenn `ollama pull` läuft (User klickt Page-Reload)
- Delete/Manage-Buttons (Catalog bleibt read-only)
- Sort-Toggle / User-Sort-Präferenzen (festes Sort: Chat → Code → Embedding → Custom)
- Eviction der Local-Cache-Einträge (TTL kommt später falls nötig)
- Mehrsprachigkeit (nur DE)

## Architektur

```
CatalogPage mount
  ├── getCurated()       → HF-Sections (unverändert)
  ├── getInstalled()     → flacher Name-Array für "installiert"-Badge (unverändert)
  └── getLocalInstalled() → NEU: { models: LocalModelCard[] }
                              ├── 1. /models/status holen
                              ├── 2. pro Modell: normalize → base_name
                              ├── 3. Lookup-Reihenfolge:
                              │    a. CURATED_LOCAL_MODELS[base_name]
                              │    b. catalog_local_pros_cons WHERE model_name=?
                              │    c. card ohne pros/cons + fire-and-forget LLM
                              └── Response (sortiert by family, name)
```

## Komponenten

### Backend

**`backend/src/data/curatedLocalModels.ts`** (neu)

Statische Map mit Einträgen für gängige Familien:

```ts
export type LocalModelFamily = 'chat' | 'code' | 'embedding' | 'custom';

export interface CuratedLocalEntry {
  family: LocalModelFamily;
  pros: string[];      // exakt 3, jeweils ≤ 80 Zeichen
  cons: string[];      // exakt 3
  setup_note?: string; // optional
}

export const CURATED_LOCAL_MODELS: Record<string, CuratedLocalEntry> = {
  'deepseek-r1': { family: 'chat', pros: [...], cons: [...] },
  'qwen3-coder': { family: 'code', pros: [...], cons: [...] },
  'qwen2.5-coder': { family: 'code', pros: [...], cons: [...] },
  'mistral-nemo': { family: 'chat', pros: [...], cons: [...] },
  'llama3.1': { family: 'chat', pros: [...], cons: [...] },
  'llama3': { family: 'chat', pros: [...], cons: [...] },
  'nomic-embed-text': { family: 'embedding', pros: [...], cons: [...] },
  'gemma': { family: 'chat', pros: [...], cons: [...] },
  'supergemma': { family: 'chat', pros: [...], cons: [...] },
  'dev-coder': { family: 'code', pros: [...], cons: [...] },
  'soc-analyst': { family: 'custom', pros: [...], cons: [...] },
  'soc-detect': { family: 'custom', pros: [...], cons: [...] },
};

export function normalizeOllamaName(name: string): string {
  // 1. strip "hf.co/<user>/" prefix
  // 2. strip ":<tag>" (e.g. ":latest", ":8b", ":12b-instruct-2407-q5_K_M", ":Q4_K_M")
  // 3. strip "-cc", "-gguf", "-uncensored" suffixes
  // 4. lowercase
  // returns the base family key for lookup
}
```

**Migration** `backend/src/database/migrations/<next-number>_catalog_local_pros_cons.sql`

```sql
CREATE TABLE IF NOT EXISTS catalog_local_pros_cons (
  model_name   TEXT PRIMARY KEY,   -- exakter Ollama-Name, z.B. "mistral-nemo-cc:latest"
  pros         TEXT NOT NULL,      -- JSON array (3 strings)
  cons         TEXT NOT NULL,      -- JSON array (3 strings)
  family       TEXT NOT NULL,      -- 'chat'|'code'|'embedding'|'custom'
  generated_at TEXT NOT NULL       -- ISO timestamp
);
```

**`backend/src/data/localProsConsRepo.ts`** (neu)
- `getLocalProsCons(modelName)` → row | null
- `upsertLocalProsCons(modelName, pros, cons, family)` → void

**`backend/src/services/catalogProsConsService.ts`** (erweitern)
- `buildLocalPrompt(modelName, family)` — Prompt-Template für LLM-Fallback, kennt nur den Modellnamen + family-Hint
- `generateLocalProsCons(modelName, family)` — Wrapper: ruft Primary/Fallback-LLM, parsed, schreibt in `catalog_local_pros_cons`

**`backend/src/controllers/catalogController.ts`** (erweitern)
- Neue Handler-Funktion `getLocalInstalled(req, res)`:
  1. `/models/status` holen (wie bestehender `getInstalled`)
  2. Pro Modell-Name: normalize → base_name → 3-stage lookup (curated → cache → null)
  3. Cards ohne Pros/Cons: fire-and-forget `generateLocalProsCons(name, family)` (rate-limited via existing pause-Logik)
  4. Response sortiert: family-rank (chat=0, code=1, embedding=2, custom=3) dann name

**`backend/src/routes/catalog.ts`** (erweitern)
- `router.get('/local-installed', getLocalInstalled);`

### Frontend

**`frontend/src/services/catalogApi.ts`** (erweitern)
```ts
export interface LocalModelCard {
  name: string;          // "mistral-nemo:12b-instruct-2407-q5_K_M"
  base_name: string;     // "mistral-nemo"
  family: 'chat' | 'code' | 'embedding' | 'custom';
  size_label?: string;   // "8.7 GB" — optional, wenn /models/status liefert
  pros?: string[];
  cons?: string[];
  setup_note?: string;
}
export interface LocalInstalledResponse { models: LocalModelCard[]; }
export function getLocalInstalled(): Promise<LocalInstalledResponse>;
```

**`frontend/src/components/LocalModelCard.tsx`** (neu)
- Analog `ModelCard.tsx`, aber:
  - Kein HF-Link (Title ist `name`, kein `<a>`)
  - Kein "Kopieren"-Button für `ollama run` (statt dessen `ollama run <name>` als Code, mit Copy-Icon)
  - Family-Badge (z.B. blau="Chat", grün="Code", grau="Embedding", lila="Custom")
  - Keine "installiert"-Badge (alle in dieser Section sind installiert)
  - Pros/Cons-Rendering wie bisher; wenn `pros`/`cons` leer → kleiner Hinweis "Pros/Cons werden generiert…"

**`frontend/src/components/LocalInstalledSection.tsx`** (neu)
- Section-Wrapper mit Header "Lokal installiert ({models.length})"
- Renderered grid analog `CatalogSection`

**`frontend/src/pages/CatalogPage.tsx`** (erweitern)
- `useEffect` startet drittes Promise `getLocalInstalled()`
- Zwischen Search-Bar/Hinweis und `curated.sections.map(...)` rendern: `<LocalInstalledSection models={localModels} />` falls `localModels.length > 0`
- Bei Search aktiv (`searchResults !== null`) → Section ausblenden (Such-Modus dominiert)

## Datenfluss / Lookup-Reihenfolge

Für jeden Modell-Namen aus `/models/status`:

1. **Normalize:** `mistral-nemo:12b-instruct-2407-q5_K_M` → `mistral-nemo`
2. **Curated:** `CURATED_LOCAL_MODELS['mistral-nemo']` → ✓ liefert family + pros + cons sofort
3. **Cache miss → Cache lookup:** `SELECT * FROM catalog_local_pros_cons WHERE model_name = 'mistral-nemo-cc:latest'` → ggf. Treffer
4. **Cache miss → LLM-Fallback:** Card wird OHNE pros/cons zurückgegeben; im Hintergrund `generateLocalProsCons()` startet, schreibt in Cache. Nächster Aufruf liefert die Daten.

Special case: `nomic-embed-text:latest` → normalize → `nomic-embed-text` → curated; family='embedding'.
Special case: `mistral-nemo-cc:latest` → normalize → `mistral-nemo` (curated trifft); family von curated.
Special case: `anubclaw/dev-coder:q5` → normalize → `dev-coder` (curated trifft).
Special case: `hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M` → normalize → `qwen2.5-coder`.

## Error Handling

- Provider-Service nicht konfiguriert / unerreichbar → leeres Array (Section blendet sich aus)
- `/models/status` HTTP-Fehler → leeres Array (analog `getInstalled`)
- LLM-Fallback fail (Primary + Fallback) → Card bleibt ohne Pros/Cons; nächster Page-Load triggert Retry
- DB-Lese-Fehler → Card ohne Cache-Hit, LLM-Fallback wird angestoßen
- Frontend-API-Fehler → Section blendet sich aus, Rest funktioniert

## Tests

**Backend (Vitest):**
- `normalizeOllamaName()` — Unit-Tests für alle Suffix-Varianten (`:latest`, `:Q4_K_M`, `-cc`, `hf.co/...`, `anubclaw/...`)
- `getLocalInstalled` — Integration: mocked `/models/status`, curated trifft, cache trifft, cache+curated miss → fire-and-forget angestoßen
- `localProsConsRepo` — Round-trip insert/select
- Family-Sort-Reihenfolge

**Frontend:**
- `LocalModelCard` — rendert mit/ohne Pros/Cons, Family-Badge richtig
- `CatalogPage` — Local Section erscheint zwischen Hinweis und HF-Sections, wird im Such-Modus ausgeblendet

## Migration / Rollout

1. SQL-Migration anwenden
2. Backend deployen — Endpoint ist additiv, alte Catalog-Calls unverändert
3. Frontend deployen — fällt graceful zurück wenn Endpoint fehlt (404 → leeres Array)
4. Bei lokalem Test: vor Production-Deploy einmal Page laden, prüfen ob LLM-Fallback für Custom-Builds triggert

## Was bewusst NICHT gemacht wird (YAGNI)

- Kein TTL/Eviction für `catalog_local_pros_cons` — User-Cache wächst langsam, kann später hinzugefügt werden
- Kein Background-Job zum Pre-Generieren (LLM-Calls laufen lazy on-demand)
- Keine UI für manuelles Pros/Cons-Override
- Keine Statistik "wie oft genutzt" (bleibt im local-usage-tracking)
