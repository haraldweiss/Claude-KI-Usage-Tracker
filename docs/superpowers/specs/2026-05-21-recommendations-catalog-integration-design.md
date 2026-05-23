# Catalog-Integration in Recommendations

**Status:** Spec
**Datum:** 2026-05-21
**Verwandt:** Local-Installed Catalog Section (2026-05-21), Catalog Auto-Pros/Cons (B.3)

## Ziel

Der Model-Suggester auf `/claudetracker/recommendations` empfiehlt aktuell nur
Anthropic-Claude-Modelle (Haiku / Sonnet / Opus). Er nutzt weder die im Catalog
gesammelten Pros/Cons noch berücksichtigt er lokal installierte Ollama-Modelle
als kostenlose Alternativen.

Dieses Sub-Projekt erweitert den Recommender um:
1. Pros/Cons-Anzeige für die empfohlenen Claude-Modelle (auto-generiert via lokales Ollama, gecached)
2. Eine neue Sektion "Lokale Alternativen (kostenlos)" mit allen installierten Ollama-Modellen der passenden Familie (chat / code / custom)

## Scope

In Scope:
- Keyword-Familie-Mapping (`debug → code`, `summarize → chat`, etc.) — Default `['chat']` bei keiner Übereinstimmung
- Auto-Generierung von Pros/Cons für ALLE aktiven Claude-Modelle aus der `pricing`-Tabelle (status='active') beim ersten Recommendations-Aufruf, asynchron + gecached
- Lokale Alternativen werden direkt unter den Claude-Alternativen gerendert, mit Pros/Cons (aus Catalog) und `ollama run`-Copy-Button
- Wenn Provider-Service nicht konfiguriert ist oder kein passendes lokales Modell installiert: Sektion blendet sich aus

Nicht in Scope:
- Lokale Modelle im Haupt-Score-Vergleich (separate Achse — kein „qwen3-coder schlägt Sonnet")
- User-Toggle für „nur Claude" / „nur lokal" (später)
- TTL/Refresh für `model_pros_cons` (manuelles `DELETE` bei Pricing-Tier-Wechsel reicht)
- Embedding-Family-Vorschläge (passt nicht zu „Task ausführen"-Use-Case)
- Pros/Cons-Edit-UI (read-only)

## Architektur

```
Frontend POST /api/recommend { task }
  ↓
recommendModel(task):
  1. analyzeTaskComplexity(task) → { complexity, category, matchedKeywords }
  2. resolveTargetFamilies(matchedKeywords) → ['code'] z.B. für "debug"
  3. Claude-Scoring wie bisher → recommended + alternatives
  4. Pros/Cons enrichment für recommended + alternatives:
       - getModelProsCons(name) → in Card mergen, ODER
       - Card ohne Pros/Cons + fire-and-forget generateClaudeProsCons()
  5. Lokale Alternativen ermitteln:
       - getInstalled-Logik wiederverwenden (Provider-Service /models/status)
       - filter by family ∈ targetFamilies
       - pro Modell: curated/cache-Lookup wie in getLocalInstalled
  6. Response enriched um pros/cons + localAlternatives
```

## Komponenten

### Backend

**`backend/src/data/keywordFamilyMap.ts`** (neu)

```ts
import type { LocalModelFamily } from './curatedLocalModels.js';

export const KEYWORD_TO_FAMILIES: Record<string, LocalModelFamily[]> = {
  // simple
  summarize: ['chat'],
  list: ['chat'],
  format: ['chat'],
  extract: ['chat'],
  simple: ['chat'],
  search: ['chat'],
  translate: ['chat'],
  rewrite: ['chat'],
  capitalize: ['chat'],
  // medium
  debug: ['code'],
  review: ['chat', 'code'],
  explain: ['chat'],
  refactor: ['code'],
  analyze: ['chat', 'code'],
  'code review': ['code'],
  fix: ['code'],
  improve: ['chat', 'code'],
  optimize: ['code'],
  // complex
  architecture: ['code'],
  design: ['code'],
  reasoning: ['chat'],
  'system design': ['code'],
  ctf: ['custom', 'code'],
  exploit: ['custom', 'code'],
  research: ['chat'],
  'multi-step': ['chat', 'code'],
  novel: ['chat'],
  challenging: ['chat'],
};

// Maps matched keywords to a deduplicated set of LocalModelFamily values.
// Empty input or no mapping found → ['chat'] as safe default.
export function resolveTargetFamilies(
  matchedKeywords: string[],
): LocalModelFamily[];
```

**Migration** (in `backend/src/database/sqlite.ts` analog zu Task 2 der Local-Installed-Section)

```sql
CREATE TABLE IF NOT EXISTS model_pros_cons (
  model_name   TEXT PRIMARY KEY,   -- exakt wie in pricing.model, z.B. "Claude Sonnet 4.6"
  pros         TEXT NOT NULL,      -- JSON array (3 strings)
  cons         TEXT NOT NULL,      -- JSON array (3 strings)
  generated_at TEXT NOT NULL
);
```

**`backend/src/data/modelProsConsRepo.ts`** (neu)
- `getModelProsCons(modelName): Promise<{ pros: string[]; cons: string[]; generated_at: string } | null>`
- `upsertModelProsCons(modelName, pros, cons): Promise<void>`

**`backend/src/services/catalogProsConsService.ts`** (erweitern)
- `buildClaudePrompt(modelName: string, tier: string | null, pricing: { input: number; output: number }): string` — Prompt-Template, das Tier und Preise als Kontext nutzt
- `generateClaudeProsCons(modelName, tier, pricing): Promise<boolean>` — analog `generateLocalProsCons`, schreibt nach `model_pros_cons`

**`backend/src/services/modelRecommendationService.ts`** (erweitern)
- Response-Typ erweitert:
  ```ts
  interface RecommendationResponse {
    // …existing fields…
    pros?: string[];        // für recommended
    cons?: string[];        // für recommended
    alternatives?: Array<{ /* existing */ pros?: string[]; cons?: string[] }>;
    localAlternatives?: LocalAlternative[];
  }
  interface LocalAlternative {
    name: string;            // exakter Ollama-Name
    base_name: string;
    family: LocalModelFamily;
    pros?: string[];
    cons?: string[];
    ollama_command: string;  // "ollama run <name>"
  }
  ```
- `recommendModel(taskDescription, constraints, userId)` muss `userId` akzeptieren (für Provider-Service-Lookup)
- Nach dem Scoring-Loop:
  1. Pro Claude-Modell (recommended + alternatives): `getModelProsCons(name)` → mergen; bei Miss: fire-and-forget `generateClaudeProsCons()`
  2. `resolveTargetFamilies(matchedKeywords)` → Familien
  3. Provider-Service `/models/status` aufrufen (gleiche Logik wie `getLocalInstalled`); für jedes Modell normalize → curated lookup → ggf. local cache → assemblieren mit `ollama_command`
  4. Filter auf passende Familien
  5. Sortierung der `localAlternatives`: nach `family` (chat=0, code=1, custom=2) dann nach `name`

**`backend/src/controllers/modelRecommendationController.ts`** (minimal anpassen)
- `req.user!.id` an `recommendModel()` durchreichen
- (Falls der Controller schon `userId` kennt: trivial)

### Frontend

**`frontend/src/services/api.ts`** (Response-Typ erweitern; existierender `recommendModel` Wrapper)
- Recommendation-Interface bekommt optional `pros?`, `cons?` (top-level + in `alternatives[]`)
- Neues Feld `localAlternatives?: LocalAlternative[]`

**`frontend/src/components/ModelSuggester.tsx`** (erweitern)
- Recommendation-Interface gespiegelt zum Backend
- Unter „Recommended Model"-Card: kompakte Pros/Cons-Liste (✅/⚠️ Icons, gleicher Stil wie auf Catalog-Seite)
- Pro Eintrag in „Alternative Models"-Grid: Pros/Cons unterhalb des bestehenden Inhalts (collapsible: aufgeklappt by default)
- Neue Sektion `🦙 Lokale Alternativen (kostenlos) ({count})` unter „Alternative Models":
  - Pro Eintrag: Card mit Family-Badge, Pros/Cons, Code-Block `ollama run <name>` + Copy-Button (Logik aus `LocalModelCard.tsx` wiederverwenden)
  - Falls `localAlternatives.length === 0`: Sektion blendet sich aus
  - Hint-Text falls keine: „Keine passenden lokalen Modelle installiert. Auf der Catalog-Seite kannst du welche pullen."

### Wiederverwendung

- `LocalModelCard.tsx` (Task 7 der vorigen Spec) kann fast 1:1 wiederverwendet werden — eventuell mit zusätzlichem optionalen Prop `compact?: boolean` falls die Darstellung im Recommender-Kontext kompakter sein soll
- `catalogProsConsService` Primary/Fallback-LLM-Logik: 100% wiederverwenden via neue Wrapper-Funktion `generateClaudeProsCons`
- `curatedLocalModels.normalizeOllamaName` + `lookupCuratedLocal`: wiederverwenden für die Family-Resolution der installierten Modelle

## Datenfluss / Lookup-Reihenfolge

**Für Claude-Modelle (recommended + alternatives):**
1. `model_pros_cons` lookup
2. Treffer → in Response mergen
3. Miss → Response ohne pros/cons; fire-and-forget `generateClaudeProsCons()` schreibt in Cache; nächster Request liefert die Daten

**Für lokale Alternativen:**
1. `/models/status` vom Provider-Service holen
2. Pro Modell: `normalizeOllamaName(name)` → family-Resolution
   - Wenn curated → curated.family
   - Sonst: `getLocalProsCons(name)` → cached.family
   - Sonst: family='custom'
3. Filter auf `family ∈ resolveTargetFamilies(matchedKeywords)`
4. Cards mit pros/cons assemblieren (curated → cached → ohne pros/cons + fire-and-forget local generation)
5. Sortieren by family rank, name

## Error Handling

- Provider-Service nicht konfiguriert / unerreichbar → `localAlternatives: []` (Section ausgeblendet)
- `/models/status` HTTP-Fehler → `localAlternatives: []`
- Claude-Pros/Cons-Generation fail → Card ohne pros/cons; nächster Request retried
- Wenn `recommendModel` Hauptlogik fehlschlägt → bestehender fallback, neue Felder bleiben `undefined`
- Frontend: bei fehlenden pros/cons → nichts rendern (kein „wird generiert…" — Recommender-Kontext braucht nicht so viel Status-UI)

## Tests

**Backend (Jest):**
- `keywordFamilyMap`: `resolveTargetFamilies(['debug'])` → `['code']`; `resolveTargetFamilies(['debug', 'explain'])` → `['code', 'chat']`; `resolveTargetFamilies([])` → `['chat']`
- `modelProsConsRepo`: round-trip insert/select (analog `localProsConsRepo.test.ts`)
- `catalogProsConsService.buildClaudePrompt`: enthält Modellname, Tier, Pricing, JSON-Format-Hinweis
- `catalogProsConsService.generateClaudeProsCons`: mocked fetch → cached in model_pros_cons
- `modelRecommendationService`: Integration mit pros/cons-Enrichment und localAlternatives (mocked provider-service fetch + DB-seeded curated/cache)

**Frontend (Vitest):**
- ModelSuggester rendert Pros/Cons wenn Backend sie liefert
- ModelSuggester rendert localAlternatives-Sektion nur wenn `localAlternatives.length > 0`
- Copy-Button kopiert `ollama run …`

## Migration / Rollout

1. SQL-Migration für `model_pros_cons` Tabelle anwenden (additiv, kein Risiko)
2. Backend deployen — Endpoint-Shape ist additiv (`pros?`, `cons?`, `localAlternatives?`)
3. Frontend deployen — fällt graceful zurück wenn neue Felder fehlen
4. Beim ersten Recommendations-Call auf Prod: Pros/Cons für alle aktiven Claude-Modelle werden im Hintergrund generiert (rate-limited durch 2s-Pause analog `getLocalInstalled`)

## Was bewusst NICHT gemacht wird (YAGNI)

- Keine Mehrsprachigkeit (nur DE)
- Kein Streaming der Pros/Cons-Generation (User refresht halt)
- Keine Side-by-Side-Vergleichstabelle Claude vs. lokal (visueller Aufwand vs. Nutzen schlecht)
- Kein "warum diese Familie?"-Tooltip für die Keyword-Family-Resolution
- Kein Manuelles Override "Show ALL local models" (Search auf der Catalog-Seite reicht)
