# Sub-Projekt B — Modell-Katalog (HF Discovery)

**Datum:** 2026-05-18
**Status:** Design / Spec
**Aufbauend auf:** [Sub-Projekt A — Local LLM Tracking](2026-05-17-local-llm-tracking-design.md) und [Sub-Projekt A.1 — Multi-Source Tracking](2026-05-17-multi-source-tracking-design.md)
**Folge-Projekte:** Spar-Empfehlungen (separates Sub-Projekt nach 1-2 Wochen Daten), Routing-Steuerung

---

## 1. Hintergrund und Motivation

Mit Sub-Projekt A und A.1 ist die lokale LLM-Nutzung sichtbar. Was fehlt: **eine Möglichkeit, neue lokale Modelle auszuprobieren ohne SSH + ollama pull**. Heute läuft `qwen3-coder:latest` für die Bewerbungstracker-Calls — andere Modelle (Llama, DeepSeek-Coder, Mistral) könnten besser oder schlanker sein, aber es gibt keinen niedrigschwelligen Weg, das zu erkunden.

Hugging Face Hub hostet **45.000+ GGUF-Modelle**, alle direkt mit Ollama nutzbar via `ollama run hf.co/{user}/{repo}` — kein eigenes Modelfile, optional mit Quant-Tag. (Quelle: <https://huggingface.co/docs/hub/ollama>.) Eine Discovery-UI im Tracker macht diesen Pool zugänglich, ohne dass man manuell HF-Browsing + SSH-Reibung in Kauf nehmen muss.

**Bonus:** Mehr probierte Modelle = mehr lokale Calls = mehr Daten für Sub-Projekt "Spar-Empfehlungen" später. Dieses Sub-Projekt füllt den Daten-Pool, den die nächste Stufe braucht.

---

## 2. Scope

### In-Scope
1. Neue Seite `/catalog` mit Top-Level-Nav-Eintrag "Modell-Katalog"
2. Default-View: 3 kuratierte Sektionen — **Code**, **Chat/General**, **Reasoning** — mit je 3-5 vorgewählten Modellen aus Bartowski/MaziyarPanahi
3. Suchleiste oben: Volltext-Suche im gesamten HF-GGUF-Pool
4. Pro Modell-Karte: Repo-Name, Größe, Anzahl Quants, Source-Badge, Downloads, **Status-Badge** ("installiert" / "nicht installiert"), Copy-Button für `ollama run hf.co/{repo}:Q4_K_M`
5. Backend-Endpoints unter `/api/catalog/`:
   - `GET /curated` — kuratierte Sektionen + HF-Metadaten
   - `GET /search?q=...&limit=50` — HF-Volltext-Suche (Proxy)
   - `GET /installed` — Liste der installierten Ollama-Modelle (Proxy zu Provider-Service `/models/status`)
6. Caching im Backend: HF-Responses in-memory 30 min TTL; bei HF-Fehler stale-cache mit `stale: true` Flag
7. Status-Match: heuristischer String-Vergleich Repo-Tail (ohne `-GGUF`) vs Ollama-Modell-Name; akzeptiert False-Negatives, vermeidet False-Positives
8. Curated-Liste hardcoded in `backend/src/data/curated-models.json`; Pflege per Commit

### Out-of-Scope (für spätere Iterationen)
- Echte Installation via Klick (= Stufe C: Tracker triggert `ollama pull` auf VPS). Separates Sub-Projekt
- Modell-Vergleich Side-by-Side
- "Recommended for your usage" basierend auf Tracker-Daten — gehört in Spar-Empfehlungen-Sub-Projekt
- Private HF-Repos (SSH-Key-Setup)
- UI-Editor für die Curated-Liste
- Quant-Tag-Dropdown pro Modell (jetzt Default `Q4_K_M`, User kann Command manuell anpassen)
- "Add to favorites" / persistierte User-Lieblingsliste
- Trending oder Most-Downloaded als Default-View

---

## 3. Architektur

### 3.1 Datenfluss

```
Browser  /catalog page
    │
    │  GET /api/catalog/curated   ────►  Tracker Backend  ──►  HF Hub API
    │  GET /api/catalog/search?q                              (cache 30 min)
    │  GET /api/catalog/installed ────►  Tracker Backend  ──►  Provider-Service
    │                                                          /models/status
    ▼
React renders 3 curated sections OR
search results, each with installed-badge
```

### 3.2 Wichtige Architektur-Entscheidungen

- **Backend-Proxy für HF-API**, nicht Frontend-direkt: löst CORS, erlaubt Caching, isoliert Frontend von HF-Response-Shape-Änderungen, gibt Rate-Limit-Schutz
- **Curated-Liste als JSON in Git**, kein Admin-UI: Aufwand vs Nutzen-Verhältnis ist klar (Liste wird selten geändert)
- **Status-Awareness wiederverwendet die bestehende Provider-Service-Verbindung** aus Sub-Projekt A (URL + Token aus `user_provider_service_config`): kein neuer Setup-Schritt für den User
- **30-min Cache** für HF-Calls: konservativ. Bei 3 Sektionen × 4 Modelle = ~12 calls beim Cold-Start, danach 0 für 30 min. Page-Reload trifft den Cache, kein Network-Roundtrip
- **Heuristisches Status-Matching**: pragmatischer Kompromiss. Perfektes Mapping zwischen HF-Repos und Ollama-Modellnamen ist nicht ohne ein Lookup-Mapping möglich; das wäre eigenes Pflege-Datenbankding. Heuristik mit False-Negative-Bias ist ehrlicher

---

## 4. UI-Layout

### 4.1 Page-Struktur

```
Modell-Katalog

[🔍 Suche in HF GGUF Modellen…              ]

Code                                                 ▼
┌───────────────────────────────────────────────────┐
│ qwen3-coder:latest                ✓ installiert    │
│ 7B · 12 quants · 23k DL              Bartowski     │
│ State-of-the-art coding LLM optimized for…         │
│ 📋 ollama run hf.co/bartowski/Qwen2.5-Coder-…:Q4_K_M│
└───────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────┐
│ DeepSeek-Coder-V2-Lite-Instruct  – nicht inst.     │
│ 16B · 8 quants · 12k DL              Bartowski     │
│ …                                                  │
└───────────────────────────────────────────────────┘
…

Chat / General                                       ▼
…

Reasoning                                            ▼
…
```

### 4.2 Modell-Karte

| Element | Quelle |
|---|---|
| Repo-Name (klickbar → HF-Modell-Page) | HF API `modelId` |
| Status-Badge | Match gegen `/installed` Response |
| Größe (B parameters) | HF API `params`, fallback "?B" wenn unbekannt |
| Anzahl Quants | HF API `siblings` mit `.gguf`-Endung gezählt |
| Downloads | HF API `downloads` |
| Source-Badge ("Bartowski"/"MaziyarPanahi"/"community") | hartcodiert anhand des User-Präfixes im Repo-Pfad |
| Kurz-Beschreibung | HF API `description` (max 1 Zeile, `line-clamp-1`, voll im Tooltip) |
| Copy-Command Button | generiert: `ollama run hf.co/{repo}:Q4_K_M` |

### 4.3 Suche-Verhalten

- Suchleiste bleibt immer oben sichtbar
- **Bei leerem Suchfeld**: 3 kuratierte Sektionen
- **Bei Eingabe (debounced 300ms)**: 1 große Trefferliste statt Sektionen, sortiert nach Downloads DESC, max 50 Ergebnisse
- **AbortController** cancelt verzögerte vorherige Requests, falls User schneller tippt als HF antwortet
- Status-Badges auch in Such-Treffern
- "0 Ergebnisse" zeigt Empty-State-Hinweis "Keine Modelle gefunden für „…"."

### 4.4 Was unverändert bleibt

- Settings, Dashboard, Recommendations bleiben unangetastet
- Authentication: gleiche `requireUser`-Middleware
- Provider-Service: keine Code-Änderung (nur Nutzung bestehender `/models/status`-Route)

---

## 5. Backend

### 5.1 Endpoints unter `/api/catalog/`

Alle authentifiziert via `requireUser`-Middleware.

| Route | Methode | Body / Query | Response |
|---|---|---|---|
| `/curated` | GET | — | `{ sections: [{ key, label, default_quant, models: ModelCard[] }] }` |
| `/search` | GET | `?q=<query>&limit=<n>` (n max 50) | `{ results: ModelCard[], stale?: true }` |
| `/installed` | GET | — | `{ models: string[] }` (z.B. `["qwen3-coder:latest"]`) |

### 5.2 `ModelCard` Shape

```typescript
interface ModelCard {
  repo: string;                  // "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF"
  size_b: number | null;         // 7 (B parameters), null if unknown
  quant_count: number;           // 12
  downloads: number;             // 23000
  source_label: string;          // "Bartowski" | "MaziyarPanahi" | "community"
  description: string;           // first paragraph from HF
  default_quant: string;         // "Q4_K_M"
  ollama_command: string;        // "ollama run hf.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"
}
```

### 5.3 Curated-Liste

Datei: `backend/src/data/curated-models.json` (in Git versioniert, kein UI-Editor):

```json
{
  "sections": [
    {
      "key": "code",
      "label": "Code",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
        "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF",
        "bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF"
      ]
    },
    {
      "key": "chat",
      "label": "Chat / General",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF"
      ]
    },
    {
      "key": "reasoning",
      "label": "Reasoning",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF"
      ]
    }
  ]
}
```

### 5.4 HF Hub API Endpoints

| Zweck | URL |
|---|---|
| Per-Modell-Lookup | `https://huggingface.co/api/models/{repo}` |
| Volltextsuche | `https://huggingface.co/api/models?library=gguf&search={q}&limit=50&sort=downloads&direction=-1` |

**Auth**: optional ein Env-Var `HF_TOKEN` für höhere Rate-Limits (`Authorization: Bearer ${HF_TOKEN}`). Bei aktuellem Volumen (~12 calls Cold-Start, dann 0 für 30 min) nicht zwingend nötig.

### 5.5 Backend-Caching

In-memory `Map<string, CacheEntry>` pro Node-Prozess:

```typescript
interface CacheEntry { data: unknown; fetched_at: number; }
const TTL_MS = 30 * 60 * 1000;
```

Logik:
- Hit (jünger als TTL): direkt return
- Miss oder expired: HF-Roundtrip, in Cache schreiben
- HF-Fehler (5xx, 429, network) + alter Cache-Eintrag vorhanden: stale-cache returnen mit `stale: true` flag im Response
- HF-Fehler + kein Cache: 502 mit `{ error: 'hf_unreachable' }`

Cache-Restart = Cache-Loss, ok.

### 5.6 Status-Awareness Implementation

`/api/catalog/installed`-Handler:

```typescript
async function fetchInstalledModels(userId: number): Promise<string[]> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) return [];
  const token = decryptSecret(cfg.service_token_enc);
  try {
    const res = await fetch(new URL('/models/status', cfg.service_url).toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as { loaded?: string[] };
    return data.loaded ?? [];
  } catch {
    return [];
  }
}
```

Wiederverwendet die in Sub-A etablierte Provider-Service-Verbindung.

### 5.7 Heuristik `isInstalled`

```typescript
function isInstalled(installedNames: string[], repo: string): boolean {
  const repoTail = repo.split('/').pop() ?? '';
  const needle = repoTail.replace(/-GGUF$/i, '').toLowerCase();
  return installedNames.some((n) => {
    const ln = n.toLowerCase();
    return ln.startsWith(needle) || ln.includes(`hf.co/${repo.toLowerCase()}`);
  });
}
```

Bias auf False-Negatives akzeptiert (UI sagt manchmal "nicht installiert" obwohl es ist) — vermeidet das schlimmere Szenario False-Positives (UI sagt "installiert" obwohl nicht).

---

## 6. Frontend

### 6.1 Neue Komponente `CatalogPage.tsx`

Datei: `frontend/src/pages/CatalogPage.tsx`. Eingehängt in das App-Routing.

Verantwortlich für:
- Lade-State (3 Promises parallel: curated, installed, search-on-demand)
- Such-State (Input + AbortController + debounce 300ms)
- Rendering: Suchleiste + entweder Curated-Sektionen oder Such-Trefferliste
- Stale-Banner falls Response mit `stale: true`

### 6.2 Neue Komponente `ModelCard.tsx`

Datei: `frontend/src/components/ModelCard.tsx`. Verantwortlich für eine einzelne Modell-Karte (siehe Section 4.2).

Props: `card: ModelCard`, `isInstalled: boolean`, `onCopy?: (cmd: string) => void`.

Verwendet `navigator.clipboard.writeText()`. Fallback bei fehlgeschlagenem Clipboard-Zugriff: Inline-Input mit `select()`.

### 6.3 Neue Komponente `CatalogSection.tsx`

Datei: `frontend/src/components/CatalogSection.tsx`. Verantwortlich für eine kuratierte Sektion (Header + Liste von ModelCards). Collapsible (Default offen).

### 6.4 API-Client erweitert

Datei: `frontend/src/services/catalogApi.ts`:

```typescript
export function getCurated(): Promise<CuratedResponse> { ... }
export function searchCatalog(q: string, limit?: number): Promise<SearchResponse> { ... }
export function getInstalled(): Promise<InstalledResponse> { ... }
```

### 6.5 Nav-Eintrag

Datei: `frontend/src/App.tsx` (oder wo immer die Navigation liegt). Neuer Eintrag "Modell-Katalog" mit Route `/catalog`.

---

## 7. Edge Cases & Fehlerbehandlung

| Szenario | Verhalten |
|---|---|
| HF-API down / 5xx / 429 | Stale-cache return mit `stale: true`. UI zeigt grauen Banner "Daten älter als 30 min — HF gerade nicht erreichbar." |
| Curated-Modell existiert nicht mehr auf HF (404) | Backend logt `console.warn`, lässt das Modell aus der Sektion fallen; Liste hat n-1 Einträge, kein Crash |
| Provider-Service nicht konfiguriert / down | `/installed` returnt `{ models: [] }`; alle Modelle zeigen "– nicht installiert"; kein Crash |
| Provider-Service liefert leere Modell-Liste | Gleiche Behandlung |
| Suche mit leerem String | Keine Search-Request — Curated wird gerendert |
| Suche mit Sonderzeichen / Unicode | `encodeURIComponent` |
| Schnelles Tippen → race conditions | Debounce 300ms + `AbortController.abort()` für vorherige Requests |
| Clipboard API blockiert vom Browser | Fallback: Inline-Input mit `select()`, User markiert/kopiert selbst. Toast: "Bitte manuell kopieren." |
| Lange Beschreibung sprengt Karte | `line-clamp-1` + voller Text im `title`-Tooltip |
| Status-Match liefert mehrere Treffer für ein installed-Item | `isInstalled` returnt `true` bei 1+ Match, alle relevanten Karten zeigen das Badge |

---

## 8. Testing

### 8.1 Unit-Tests (Backend)

- `isInstalled()`: matched mit/ohne Quant-Suffix, mit/ohne `hf.co/`-Präfix; matched nicht falsch (z.B. "llama3" matched nicht "qwen2.5-coder")
- `ollamaCommandFor(repo, quant)`: korrekter String
- Cache: Eintrag älter als TTL → frischer Fetch; jünger → cached return
- Stale-Fallback: HF-Mock returnt Error → cached data + `stale: true`
- Cold-stale: kein Cache + HF-Error → 502 mit error code
- Curated-Loader: Modell mit 404 wird übersprungen, andere bleiben

### 8.2 Unit-Tests (Frontend, soweit testbar)

- Debounced search: bei 3 schnellen Eingaben nur 1 fetch
- ModelCard rendert installed-Badge wenn matched
- Copy-Button schreibt korrekten String in `navigator.clipboard.writeText`-Mock

### 8.3 Manual Smoke nach Deploy

1. `/catalog` lädt: 3 Sektionen sichtbar mit jeweils 3-5 Modellen
2. Mindestens 1 Modell mit grünem "installiert"-Badge (Match auf dein `qwen3-coder`)
3. Suche `"deepseek"`: Trefferliste, sortiert nach Downloads, mind. 5 Modelle
4. Copy-Button: Command landet in Clipboard, beim Einfügen sichtbar mit `:Q4_K_M`-Tag
5. SSH zum VPS: `ollama run hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M` (kleinstes Modell, ~1 GB)
6. Page reload → das frisch gepullte Modell zeigt jetzt grünes Badge

---

## 9. Rollout

1. **Backend deploy**: neue Routes, Curated-JSON-Datei, Caching-Helper. Kein Schema-Change, keine DB-Migration. Risiko: gering — die Routes sind additiv.
2. **Frontend deploy**: neue Page + Nav-Eintrag. Bestehende Pages unbeeinflusst.
3. **Manual smoke** (s.o.)
4. **Curated-Liste anpassen** falls nach erstem Blick passende Modelle fehlen oder unpassende drin sind. Per Commit.

### Rollback
- Frontend: alter Bundle aus `dist.backup/` zurück → Nav-Eintrag verschwindet
- Backend: `git reset --hard <prev>` → Routes weg
- Kein DB-Cleanup nötig

---

## 10. Bekannte Risiken / Out-of-Scope

- **HF-API-Shape-Änderungen** könnten Backend brechen — wir mappen explizit auf unser `ModelCard`-Shape, hoffentlich überschaubares Wartungsfenster
- **Heuristisches Status-Matching** ist nicht perfekt — explizit als Trade-off entschieden (siehe Section 5.7)
- **Curated-Liste-Pflege** ist Commit-getrieben — falls eines der genannten Modelle verschwindet, fällt es stumm raus. Wenn das zu oft passiert: Switch auf "Trending-Most-Downloaded" als Default
- **Rate-Limit** ohne `HF_TOKEN`: ~1000 req/h ist hoch genug, aber bei plötzlichem Heavy-Use könnte es eng werden. `HF_TOKEN` als optionale Env-Var ist vorbereitet
- **Lokaler Disk-Space** auf VPS: jeder `ollama pull` kostet 2-30 GB. Tracker zeigt das nicht — User muss selbst aufpassen. Nicht in Scope

---

## 11. Folge-Sub-Projekte (zur Orientierung)

- **Spar-Empfehlungen**: Nutzt die in diesem Sub-Projekt erleichterten Modell-Tests, um nach 1-2 Wochen sinnvolle "Modell X spart dir Y €"-Vorschläge zu machen
- **Echte Installation via Klick (Stufe C)**: Tracker triggert `ollama pull` via Provider-Service (Async-Status, Disk-Space-Check, Progress)
- **Quant-Tag-Dropdown**: Wenn häufig zwischen Quants gewechselt wird, pro Karte einen Dropdown
- **Modell-Vergleich Side-by-Side**: Nebeneinander zwei Modelle, ihre Specs/Quants/Downloads
