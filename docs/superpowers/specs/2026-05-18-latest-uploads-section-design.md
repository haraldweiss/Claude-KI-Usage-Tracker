# Sub-Projekt B.2 — Latest Uploads Sektion im Modell-Katalog

**Datum:** 2026-05-18
**Status:** Design / Spec
**Aufbauend auf:** [Sub-B Modell-Katalog](2026-05-18-model-catalog-design.md) und [Sub-B.1 HF Background-Cache](2026-05-18-hf-background-cache-design.md)
**Folge-Projekt:** B.3 (LLM-generierte Pros/Cons) — wird auch die hier eingeführten dynamischen Modelle bedienen

---

## 1. Hintergrund und Motivation

Der Modell-Katalog (Sub-B) zeigt 3 kuratierte Sektionen (Code / Chat / Reasoning) mit hand-gepflegten Modellen. Was fehlt: **automatische Sichtbarkeit neuer Modelle**. Wenn Bartowski oder MaziyarPanahi heute ein neues Modell hochlädt, taucht es im Katalog erst auf, wenn der Spec-Eintrag in `CURATED_MODELS` manuell ergänzt wird.

B.2 adressiert das mit einer **4. dynamischen Sektion "Frisch hochgeladen"**, die per HF API die jeweils neuesten 6 Bartowski + MaziyarPanahi-Uploads zeigt. Refresh täglich, gemeinsam mit B.1.

**Bonus:** Die hier eingeführte Infrastruktur (Liste dynamischer Repos im DB-Cache) ist auch die Basis für B.3, das auf der Latest-Liste Pros/Cons-Generierung anbieten würde.

---

## 2. Scope

### In-Scope
1. Neue Tabelle `catalog_latest_uploads` mit (position 1-6, repo, fetched_at)
2. Erweiterung von `refreshCuratedHfCache` (oder neue Funktion `refreshLatestUploads`) im selben 04:00-Cron
3. HF-Queries: `?author=bartowski&library=gguf&sort=lastModified&limit=15` und dasselbe für MaziyarPanahi
4. Merge → dedup → top 6 nach `lastModified` DESC
5. Für jedes ausgewählte Repo: `fetchModelMetadata()` aufrufen, in `catalog_hf_cache` schreiben (mit existierender 30-min-Cache-Logik)
6. Atomare DB-Aktion: `DELETE FROM catalog_latest_uploads; INSERT INTO ... VALUES (...)` in Transaction
7. Controller `/api/catalog/curated` returnt jetzt **4 Sektionen** (3 statisch + 1 dynamisch `latest`)
8. Frontend braucht **keine Code-Änderung** — `CatalogSection`-Komponente rendert die neue Sektion automatisch

### Out-of-Scope
- **Pros/Cons für Latest** (kommt in B.3)
- Manuelles "Pin/Unpin" für Models in der Latest-Liste
- Vorab-Filter (z.B. "nur instruct", "nur > 7B")
- Mehr Quanters als Bartowski + MaziyarPanahi (YAGNI; bei Bedarf später erweitern)
- Real-time Updates oder kürzere Refresh-Intervalle
- Anpassbare Anzahl Modelle pro Sektion (hardcoded 6)

---

## 3. Architektur

### 3.1 Datenfluss

```
Cron (04:00 UTC, gemeinsam mit B.1):
  1. HF query 1: GET /api/models?author=bartowski&library=gguf&sort=lastModified&limit=15
  2. HF query 2: GET /api/models?author=MaziyarPanahi&library=gguf&sort=lastModified&limit=15
  3. Merge → dedup by `id` (= repo) → sort by `lastModified` DESC → top 6
  4. For each top-6 repo: fetchModelMetadata(repo, 'Q4_K_M') → catalog_hf_cache UPSERT
  5. Transaction: DELETE FROM catalog_latest_uploads; INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES (1, ...), ..., (6, ...)

Page-Load (/api/catalog/curated):
  1. Static sections from CURATED_MODELS (unchanged from Sub-B/B.1)
  2. Dynamic section 'latest':
     a. SELECT repo FROM catalog_latest_uploads ORDER BY position
     b. For each repo: read catalog_hf_cache.data_json
     c. If cache row missing for a repo: live-HF-fallback (same path as Sub-B.1)
     d. Filter out null results (deleted/404 repos)
     e. Section: { key: 'latest', label: 'Frisch hochgeladen', default_quant: 'Q4_K_M', models: [...] }
  3. Response: { sections: [...4 sections...], fetched_at: oldest of catalog_hf_cache }
```

### 3.2 Wichtige Architektur-Entscheidungen

- **Top 6** hardcoded (kein Setting). Anpassen per Commit, kein UI-Editor — YAGNI für Single-User-Setup
- **`position` als PRIMARY KEY** statt AUTOINCREMENT: ermöglicht `INSERT OR REPLACE` oder reines DELETE+INSERT-Pattern ohne Race-Conditions
- **Gemeinsamer Cron mit B.1**: einfacher Operations, keine zweite Schedule-Logik
- **Liste der Latest-Repos als reine Index-Tabelle** über `catalog_hf_cache`: DRY, ein Metadaten-Cache für alle Discovery-Pfade
- **Source-Filter Bartowski + MaziyarPanahi only**: beide schon in Curated-Liste, beide aktive Quanters, beide produzieren zuverlässig GGUF-Files. Andere Quanters bleiben out-of-scope bis konkreter Bedarf
- **Default-Quant für Latest = `Q4_K_M`**: gleiche Konvention wie alle 3 statischen Sektionen

---

## 4. Schema-Änderung

Additiv in `backend/src/database/sqlite.ts`, im bestehenden `initDatabase()`-Block nach `catalog_hf_cache`:

```sql
CREATE TABLE IF NOT EXISTS catalog_latest_uploads (
  position    INTEGER PRIMARY KEY,
  repo        TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);
```

Keine Indizes nötig — Lookup geht über PK, nur 6 Rows.

---

## 5. Backend-Änderungen

### 5.1 HF Latest-Uploads Query

Neue Funktion in `backend/src/services/catalogService.ts`:

```typescript
export async function fetchLatestUploads(author: string, limit: number = 15): Promise<HfModelDto[]> {
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('author', author);
  url.searchParams.set('library', 'gguf');
  url.searchParams.set('sort', 'lastModified');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`HF ${res.status}`);
  return (await res.json()) as HfModelDto[];
}
```

`HfModelDto` enthält mindestens `id` (= repo) und `lastModified` für die Sortierung. Andere Felder werden ignoriert (`fetchModelMetadata` macht den eigentlichen Detail-Fetch).

### 5.2 Repo

Neue Datei `backend/src/data/latestUploadsRepo.ts`:

```typescript
export interface LatestUploadRow {
  position: number;
  repo: string;
  fetched_at: string;
}

export async function replaceLatestUploads(repos: string[]): Promise<void> {
  // Atomic via SQLite transaction (runQuery+sequence handled by sqlite3 serialize)
  const now = new Date().toISOString();
  await runQuery('DELETE FROM catalog_latest_uploads');
  for (let i = 0; i < repos.length; i++) {
    await runQuery(
      'INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES (?, ?, ?)',
      [i + 1, repos[i], now],
    );
  }
}

export async function listLatestUploads(): Promise<LatestUploadRow[]> {
  return allQuery<LatestUploadRow>(
    'SELECT position, repo, fetched_at FROM catalog_latest_uploads ORDER BY position ASC',
  );
}
```

### 5.3 Refresh-Service erweitern

Datei `backend/src/services/catalogCacheRefresh.ts` bekommt neue Exportfunktion:

```typescript
const LATEST_QUANTERS = ['bartowski', 'MaziyarPanahi'];
const LATEST_TOP_N = 6;

export async function refreshLatestUploads(): Promise<RefreshSummary> {
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };

  // Fetch latest from each quanter (skip failures, keep others going)
  const merged: Array<{ repo: string; lastModified: string }> = [];
  for (const author of LATEST_QUANTERS) {
    try {
      const list = await fetchLatestUploads(author, 15);
      for (const m of list) {
        if (m.id && m.lastModified) merged.push({ repo: m.id, lastModified: m.lastModified });
      }
    } catch (e) {
      summary.errors.push({ repo: `author:${author}`, error: (e as Error).message });
      summary.failed++;
    }
  }

  // Dedup by repo, sort by lastModified DESC, top N
  const seen = new Set<string>();
  const top = merged
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .filter((m) => {
      if (seen.has(m.repo)) return false;
      seen.add(m.repo);
      return true;
    })
    .slice(0, LATEST_TOP_N);

  // Ensure each repo's metadata is in catalog_hf_cache
  for (const m of top) {
    try {
      const card = await fetchModelMetadata(m.repo, 'Q4_K_M');
      if (card) {
        const clean = { ...card };
        delete clean.stale;
        await upsertCardCache(m.repo, clean, null);
        summary.refreshed++;
      } else {
        summary.failed++;
        summary.errors.push({ repo: m.repo, error: 'HF 404' });
      }
    } catch (e) {
      summary.failed++;
      summary.errors.push({ repo: m.repo, error: (e as Error).message });
    }
  }

  // Replace the index list atomically
  await replaceLatestUploads(top.map((m) => m.repo));

  return summary;
}
```

### 5.4 Cron-Hook erweitern

In `backend/src/server.ts`, die bestehende 04:00-Cron-Funktion erweitern. Die `refreshCuratedHfCache()` läuft erst (8 Modelle), dann `refreshLatestUploads()` (6 Modelle + 2 author-list-queries):

```typescript
cron.schedule('0 4 * * *', async () => {
  try {
    console.log('[catalog-cache] starting daily refresh');
    const r = await refreshCuratedHfCache();
    console.log(`[catalog-cache] curated refreshed=${r.refreshed} failed=${r.failed}`);
    const l = await refreshLatestUploads();
    console.log(`[catalog-cache] latest refreshed=${l.refreshed} failed=${l.failed}`);
    for (const e of [...r.errors, ...l.errors]) {
      console.warn(`[catalog-cache] ${e.repo}: ${e.error}`);
    }
  } catch (err) {
    console.error('[catalog-cache] cron error', err);
  }
});
```

Initial-Prime (auf Server-Start wenn Cache leer) wird ebenfalls erweitert:

```typescript
isCacheEmpty().then((empty) => {
  if (empty) {
    console.log('[catalog-cache] cache empty on startup — priming');
    Promise.all([refreshCuratedHfCache(), refreshLatestUploads()])
      .then(([rc, rl]) => console.log(
        `[catalog-cache] primed: curated=${rc.refreshed}/${rc.failed} latest=${rl.refreshed}/${rl.failed}`,
      ))
      .catch((err) => console.error('[catalog-cache] prime error', err));
  }
});
```

### 5.5 Controller-Update

In `backend/src/controllers/catalogController.ts`, `getCurated()` wird erweitert:

```typescript
export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = CURATED_MODELS;

  // 3 static sections (unchanged)
  const staticSections = await Promise.all(spec.sections.map(async (s) => {
    const cards = await Promise.all(s.models.map(async (m) => { /* … unchanged … */ }));
    return { key: s.key, label: s.label, default_quant: s.default_quant,
             models: cards.filter((c): c is ModelCard => c !== null) };
  }));

  // 4th dynamic section: latest uploads
  const latestRows = await listLatestUploads();
  const latestCards = await Promise.all(latestRows.map(async (r): Promise<ModelCard | null> => {
    const cached = await getCachedCard(r.repo);
    if (cached) return cached.card;
    // Cold-start fallback (unlikely since cron primes both)
    return fetchModelMetadata(r.repo, 'Q4_K_M').catch(() => null);
  }));
  const latestSection = {
    key: 'latest',
    label: 'Frisch hochgeladen',
    default_quant: 'Q4_K_M',
    models: latestCards.filter((c): c is ModelCard => c !== null),
  };

  const oldest = await getOldestFetchedAt();
  res.json({ sections: [...staticSections, latestSection], fetched_at: oldest });
}
```

---

## 6. Frontend-Änderungen

**Keine Code-Änderung notwendig.**

Die bestehende `CatalogSection`-Komponente rendert jede Sektion identisch (Header + Grid aus ModelCards). Da die 4. Sektion im Backend einfach im `sections`-Array auftaucht, übernimmt das Frontend sie automatisch.

Cards der Latest-Sektion haben `pros = undefined`, `cons = undefined`, `setup_note = undefined` — die ModelCard-Komponente rendert dann den `pros/cons/setup_note`-Block einfach nicht (bestehende `{(card.pros?.length || …) && (…)}`-Logik).

---

## 7. Edge Cases & Fehlerbehandlung

| Szenario | Verhalten |
|---|---|
| HF API down beim Refresh | Refresh-Loop loggt error, `catalog_latest_uploads` bleibt unverändert (alte Liste). UI-Footer zeigt "letzte Aktualisierung vor X" — gleicher Mechanismus wie B.1 |
| Bartowski oder MaziyarPanahi liefert 0 Modelle | Andere Quanter liefert weiterhin. Falls beide leer: top wird leer, `replaceLatestUploads([])` löscht Tabelle, Sektion bleibt im UI leer. Unwahrscheinlicher Fall — beide laden täglich |
| Repo verschwindet zwischen Refresh und Page-Load (404) | `getCachedCard` returns row; bei Cold-Start-Fallback returns null. Card wird aus Sektion gefiltert; Sektion zeigt 5 statt 6 Cards. Beim nächsten Cron-Refresh wird die Liste neu — Repo fällt natürlich raus |
| `fetchModelMetadata` failt für ein Latest-Repo | `replaceLatestUploads` schreibt es trotzdem in `catalog_latest_uploads`. Beim Page-Load fehlt es im `catalog_hf_cache` → Cold-Start-Fallback (live HF) → ggf. zweite Chance |
| Race: Cron läuft während Page-Load | DB-Transaction atomic. Schlimmstenfalls leere Liste für 50-100ms (zwischen DELETE und INSERT) — Page sieht 0 Latest-Modelle, beim nächsten Reload wieder 6 |
| Repo in Latest ist auch in CURATED_MODELS | Wird in beiden Sektionen angezeigt — bewusst, das hebt das Modell hervor (Discovery-Bonus) |
| Latest-Modell hat keinen `Q4_K_M`-Quant verfügbar (selten) | Copy-Command zeigt `Q4_K_M` trotzdem; beim `ollama run` schlägt's fehl. User-Fix: in HF-Repo schauen, anderen Tag manuell wählen. Out-of-Scope für jetzt |

---

## 8. Testing

### 8.1 Unit-Tests

**`latestUploadsRepo.test.ts`:**
- `replaceLatestUploads(['a', 'b', 'c'])` → 3 rows mit position 1, 2, 3
- `replaceLatestUploads([])` → 0 rows
- Sequentieller Aufruf: 1. mit ['a', 'b', 'c'], dann mit ['x', 'y'] → 2 rows, nicht 5
- `listLatestUploads()` sortiert by position ASC

**`catalogCacheRefresh.test.ts` (erweitern):**
- `refreshLatestUploads` mit beiden Quanters erfolgreich → top 6 in `catalog_latest_uploads`
- 1 Quanter failt (HF 500) → andere wird trotzdem genutzt, errors-array hat Eintrag, failed++
- Dedup-Test: beide Quanters liefern Modell `x/m-GGUF` → erscheint nur einmal
- Sort-Test: 8 Modelle mit verschiedenen `lastModified`-Timestamps → nur top 6 nach DESC

### 8.2 Integration

- Manual: nach Server-Start prüfen dass `catalog_latest_uploads` 6 Rows hat
- `/api/catalog/curated` returnt 4 sections; `latest` hat 0-6 Modelle

### 8.3 Manual Smoke nach Deploy

1. Backend deploy → Logs zeigen `[catalog-cache] primed: curated=8/0 latest=6/0`
2. `/catalog` lädt — neue 4. Sektion "Frisch hochgeladen" sichtbar
3. Sektion enthält die jeweils neuesten Bartowski + MaziyarPanahi-Repos vom Tag
4. Cards haben kein Pros/Cons-Block (kommt mit B.3)

---

## 9. Rollout

1. Backend deploy: neue Tabelle (additiv), erweiterte Refresh-Funktion, erweiterte Controller-Response
2. Beim Server-Start läuft Initial-Prime für Curated **und** Latest (parallel)
3. Smoke prod (s.o.)
4. Frontend braucht keinen Build/Deploy — Component-Code ist unverändert, die neue Sektion taucht durch erweiterte Backend-Response auf

### Rollback
- Code-Rollback (`git reset --hard <prev>`)
- Schema-Cleanup nicht nötig (additive Tabelle)
- Bei Code-Rollback kommt der alte Controller, der nur 3 Sektionen returnt. `catalog_latest_uploads`-Rows bleiben in DB liegen — egal

---

## 10. Bekannte Risiken / Out-of-Scope

- **HF API-Stabilität**: Bei mehreren aufeinander folgenden Refresh-Failures bleibt die Liste static. Stale-Banner im Frontend signalisiert das. Kein automatischer Retry, der Cron probiert's morgen wieder
- **MaziyarPanahi-Aufgabe**: Falls dieser Account inaktiv wird, dominiert Bartowski. Akzeptabel — die Sektion bleibt nützlich
- **Spam-Modelle**: Falls Bartowski mal ein Test-Modell hochlädt, taucht es ggf. einen Tag im Catalog auf. Akzeptabel — sehr selten

---

## 11. Folge-Sub-Projekte

- **B.3 — LLM-generierte Pros/Cons**: nutzt die hier eingeführte `catalog_latest_uploads`-Tabelle (und `CURATED_MODELS`), läuft lokales LLM über die Metadaten, schreibt Pros/Cons in einen weiteren DB-Cache. Latest-Sektion bekommt damit auch Pros/Cons
- **Quanter-Erweiterung**: Falls Bedarf, weitere Authors hinzufügen (`LATEST_QUANTERS`-Konstante anpassen)
- **Pro-Modell-Pin-Button**: Manueller "Add to Curated"-Action im UI — würde Repo in `CURATED_MODELS` schreiben (was aktuell ein Git-Commit erfordert)
