# Sub-Projekt B.1 — HF Background-Cache für Modell-Katalog

**Datum:** 2026-05-18
**Status:** Design / Spec
**Aufbauend auf:** [Sub-Projekt B — Modell-Katalog](2026-05-18-model-catalog-design.md)
**Folge-Projekte:** B.2 (Neueste Uploads Sektion), B.3 (LLM-generierte Pros/Cons)

---

## 1. Hintergrund und Motivation

Sub-Projekt B führt den Modell-Katalog ein. Bei jedem Page-Load von `/catalog` wird derzeit `getCurated` aufgerufen, das für jedes der 8 kuratierten Modelle entweder den 30-min-In-Memory-Cache trifft oder live HF anfragt. Probleme dieses Ansatzes:

- **Kalt-Start nach Server-Restart oder Cache-Expiry:** 8 sequenzielle HF-Roundtrips beim ersten Page-Load (auch wenn parallel: spürbar)
- **HF-Ausfälle treffen die UX direkt** statt im Hintergrund aufgefangen zu werden
- **Keine historische Sicht** auf Download-Trends — falls künftige Sub-Projekte (B.3 LLM-Pros/Cons) HF-Daten brauchen, müsste jeder das eigene Caching machen

B.1 verschiebt das HF-Fetching in einen täglichen Cron-Job. Pages lesen aus der DB. Live-HF-Fallback bleibt im Code für den allerersten Start.

---

## 2. Scope

### In-Scope
1. Neue Tabelle `catalog_hf_cache` (1 Row pro Curated-Repo)
2. Cron-Job um **4 AM täglich** in `server.ts` (zwischen den existierenden 2-AM-Pricing-Cron und den anderen Cron-Jobs versetzt)
3. Cron-Funktion `refreshCuratedHfCache()` iteriert alle Modelle aus `CURATED_MODELS`, ruft `fetchModelMetadata()` auf, UPSERT in DB
4. Controller `getCurated` liest **primär aus DB**, fällt nur bei leerer Row auf die alte Live-HF-Logik zurück
5. Beim Server-Start: Wenn die `catalog_hf_cache`-Tabelle leer ist (oder ein Repo darin fehlt), wird einmalig der Cron-Tick getriggert
6. Frontend zeigt am Seitenfuß von `/catalog` "Letzte Aktualisierung: vor X Std/Min" — ältester `fetched_at` aus den DB-Rows
7. Per-Row `last_error` für teilweise fehlgeschlagene Refreshes — beeinflusst die UI nicht, aber im Backend-Log sichtbar

### Out-of-Scope (für spätere Sub-Projekte)
- **Search-Endpoint bleibt unangetastet** — Suche ist explorativ, Live-HF + 30-min-Cache passt dort
- Cleanup-Step im Cron für gelöschte Curated-Modelle (Rows bleiben liegen, sind aber nicht sichtbar)
- Notifications bei Cron-Failures
- "Refresh jetzt"-Button im UI (manueller Trigger)
- Persistent caching für Search-Results
- Stale-Warning-Banner mit Schwellwert — entschieden für dezente Footer-Anzeige ohne harten Warn-Threshold
- Migration alter In-Memory-Cache-Daten (irrelevant, neu beim ersten Boot)

---

## 3. Architektur

### 3.1 Schema

```sql
CREATE TABLE IF NOT EXISTS catalog_hf_cache (
  repo            TEXT PRIMARY KEY,
  data_json       TEXT NOT NULL,      -- serialized ModelCard (without curated meta)
  fetched_at      TEXT NOT NULL,      -- ISO timestamp
  last_error      TEXT                -- last error message if a refresh failed
);
```

JSON-Spalte statt normalisierter Spalten: die `ModelCard`-Shape darf sich künftig ändern, ohne dass es ein Schema-Migration braucht.

Curated Meta (`pros`/`cons`/`setup_note`) wird **nicht** mit gespeichert — die kommt direkt aus `CURATED_MODELS` (im Code, in Git versioniert) und wird im Controller mit den DB-Daten gemerged.

### 3.2 Datenfluss (alt vs. neu)

```
ALT (Sub-B):
  Page → /api/catalog/curated
    → for each curated repo:
        in-memory cache hit?  return.
        miss → HF API call → in-memory cache + return.

NEU (Sub-B.1):
  Cron (täglich 4 AM, sowie 1× beim Server-Start wenn DB leer):
    for each curated repo: HF API call → DB UPSERT.

  Page → /api/catalog/curated
    → for each curated repo:
        SELECT data_json FROM catalog_hf_cache → merge with CURATED_MODELS meta → return.
        DB miss (cold-start before first cron tick) → fallback to legacy live-HF path.
```

### 3.3 Wichtige Architektur-Entscheidungen

- **In-Memory-Cache bleibt drin** als zweite Schicht. Cron-Refresh kann den In-Memory-Cache neu primen, oder wir lassen ihn passiv altern — DB-Read ist sowieso billig
- **Fallback bei DB-Miss** ist die bestehende live-HF-Logik — verhindert "leere Seite" beim allerersten Boot, bevor der Initial-Cron-Tick durch ist
- **`last_error` pro Row** statt globalem Cron-Status: wenn 7 von 8 Modellen erfolgreich pullen und eines 404, sehen wir das per-row
- **Search-Endpoint bleibt komplett unangetastet** — kein Risiko für die Suchleiste

---

## 4. Backend-Änderungen

### 4.1 Schema-Migration

In `backend/src/database/sqlite.ts`, additiv im bestehenden `initDatabase()`-Block nach den Sub-A.1-Tabellen:

```typescript
await new Promise<void>((res, rej) => {
  database.run(
    `CREATE TABLE IF NOT EXISTS catalog_hf_cache (
      repo        TEXT PRIMARY KEY,
      data_json   TEXT NOT NULL,
      fetched_at  TEXT NOT NULL,
      last_error  TEXT
    )`,
    (tErr: Error | null) => (tErr ? rej(tErr) : res())
  );
});
```

Idempotent via `IF NOT EXISTS`.

### 4.2 Cache-Repo

Neue Datei `backend/src/data/catalogCacheRepo.ts`:

```typescript
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { ModelCard } from '../services/catalogService.js';

export async function upsertCardCache(
  repo: string, card: ModelCard, lastError: string | null,
): Promise<void> {
  await runQuery(
    `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       data_json = excluded.data_json,
       fetched_at = excluded.fetched_at,
       last_error = excluded.last_error`,
    [repo, JSON.stringify(card), new Date().toISOString(), lastError],
  );
}

export async function recordCacheError(repo: string, error: string): Promise<void> {
  // Only updates last_error without touching data_json — preserves stale data.
  await runQuery(
    `UPDATE catalog_hf_cache SET last_error = ? WHERE repo = ?`,
    [error, repo],
  );
}

export interface CacheRow {
  repo: string;
  card: ModelCard;
  fetched_at: string;
  last_error: string | null;
}

export async function getCachedCard(repo: string): Promise<CacheRow | null> {
  const row = await getQuery<{
    repo: string;
    data_json: string;
    fetched_at: string;
    last_error: string | null;
  }>('SELECT * FROM catalog_hf_cache WHERE repo = ?', [repo]);
  if (!row) return null;
  return {
    repo: row.repo,
    card: JSON.parse(row.data_json) as ModelCard,
    fetched_at: row.fetched_at,
    last_error: row.last_error,
  };
}

export async function getOldestFetchedAt(): Promise<string | null> {
  const row = await getQuery<{ fetched_at: string }>(
    'SELECT MIN(fetched_at) AS fetched_at FROM catalog_hf_cache',
  );
  return row?.fetched_at ?? null;
}
```

### 4.3 Cron-Funktion

Neue Datei `backend/src/services/catalogCacheRefresh.ts`:

```typescript
import { fetchModelMetadata } from './catalogService.js';
import { CURATED_MODELS } from '../data/curatedModels.js';
import { upsertCardCache, recordCacheError, getCachedCard } from '../data/catalogCacheRepo.js';

export interface RefreshSummary {
  refreshed: number;
  failed: number;
  errors: Array<{ repo: string; error: string }>;
}

export async function refreshCuratedHfCache(): Promise<RefreshSummary> {
  const allRepos = CURATED_MODELS.sections.flatMap((s) =>
    s.models.map((m) => ({ repo: m.repo, default_quant: s.default_quant })),
  );
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };
  for (const { repo, default_quant } of allRepos) {
    try {
      const card = await fetchModelMetadata(repo, default_quant);
      if (card === null) {
        // 404 from HF — record but keep any older data.
        await recordCacheError(repo, 'HF 404 (not found)');
        summary.failed++;
        summary.errors.push({ repo, error: 'HF 404' });
        continue;
      }
      await upsertCardCache(repo, card, null);
      summary.refreshed++;
    } catch (e) {
      const msg = (e as Error).message;
      await recordCacheError(repo, msg);
      summary.failed++;
      summary.errors.push({ repo, error: msg });
    }
  }
  return summary;
}

export async function isCacheEmpty(): Promise<boolean> {
  const sample = await getCachedCard(CURATED_MODELS.sections[0]!.models[0]!.repo);
  return sample === null;
}
```

### 4.4 Controller-Änderung

In `backend/src/controllers/catalogController.ts`, `getCurated`-Funktion: liest jetzt aus DB-Cache und merged mit Curated-Meta. Fallback auf Live-HF nur wenn DB-Row fehlt:

```typescript
export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = CURATED_MODELS;
  const sections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map(async (m): Promise<ModelCard | null> => {
          const cached = await getCachedCard(m.repo);
          let card: ModelCard | null;
          if (cached) {
            card = cached.card;
          } else {
            // First-boot fallback: live HF call.
            card = await fetchModelMetadata(m.repo, s.default_quant).catch(() => null);
          }
          if (!card) return null;
          return {
            ...card,
            pros: m.pros,
            cons: m.cons,
            setup_note: m.setup_note,
          };
        }),
      );
      return {
        key: s.key,
        label: s.label,
        default_quant: s.default_quant,
        models: cards.filter((c): c is ModelCard => c !== null),
      };
    }),
  );

  // Footer-Metadaten (Frontend nutzt fetched_at für "letzte Aktualisierung")
  const oldest = await getOldestFetchedAt();
  res.json({ sections, fetched_at: oldest });
}
```

### 4.5 Cron + Server-Start

In `backend/src/server.ts`, neben den anderen Cron-Aufrufen:

```typescript
import { refreshCuratedHfCache, isCacheEmpty } from './services/catalogCacheRefresh.js';

// Daily at 04:00 UTC
cron.schedule('0 4 * * *', async () => {
  try {
    console.log('[catalog-cache] starting daily refresh');
    const r = await refreshCuratedHfCache();
    console.log(`[catalog-cache] refreshed=${r.refreshed} failed=${r.failed}`);
    for (const e of r.errors) {
      console.warn(`[catalog-cache] ${e.repo}: ${e.error}`);
    }
  } catch (err) {
    console.error('[catalog-cache] cron error', err);
  }
});

// On startup: if cache is empty, prime it immediately so the first page-load
// doesn't have to fall back to live HF for every model.
isCacheEmpty().then((empty) => {
  if (empty) {
    console.log('[catalog-cache] cache empty on startup — priming');
    refreshCuratedHfCache()
      .then((r) => console.log(`[catalog-cache] primed: refreshed=${r.refreshed} failed=${r.failed}`))
      .catch((err) => console.error('[catalog-cache] prime error', err));
  }
}).catch((err) => console.error('[catalog-cache] empty-check error', err));
```

---

## 5. Frontend-Änderungen

### 5.1 `catalogApi.ts`

`CuratedResponse` interface erweitert um `fetched_at`:

```typescript
export interface CuratedResponse {
  sections: CuratedSection[];
  fetched_at?: string | null;
}
```

### 5.2 `CatalogPage.tsx`

Am Seitenfuß ein dezenter Hinweis (nur sichtbar wenn `fetched_at` da):

```tsx
{curated?.fetched_at && (
  <div className="mt-8 text-xs text-gray-400 text-right">
    Daten von Hugging Face — letzte Aktualisierung: {relativeTime(curated.fetched_at)}
  </div>
)}
```

`relativeTime` ist eine kleine Helper-Funktion ("vor 2 Std", "vor 5 Min", "gerade eben"). Kein Schwellwert für rote Warnung — bewusst dezent.

---

## 6. Edge Cases

| Szenario | Verhalten |
|---|---|
| Cron läuft komplett fehl (z.B. Server stand) | DB-Daten bleiben, UI zeigt alte Werte mit altem `fetched_at` — Fußzeile signalisiert "vor X Std" |
| Einzelnes Modell schlägt fehl (HF 5xx, 404, Rate-Limit) | Andere Modelle in der Loop laufen weiter; failendes Modell behält alte DB-Row, `last_error` gesetzt. UI zeigt es weiter mit alten Daten |
| Modell aus Curated-Liste entfernt | Beim nächsten Cron nicht mehr gepullt; DB-Row bleibt liegen; Controller liest sowieso nur Modelle aus `CURATED_MODELS` → unsichtbar. Cleanup ist Out-of-Scope |
| Server-Start mit leerer DB | Beim Boot wird ein einmaliger Cron-Tick gefeuert via `isCacheEmpty().then(...)`; bis durchgelaufen, fällt `getCurated` auf Live-HF |
| Erster Page-Load während Initial-Cron läuft | Fallback-Pfad gibt Live-HF (langsamer, aber funktional) |
| Cron läuft gleichzeitig mit Page-Load | UPSERT pro Row ist atomic. Race ist unkritisch — schlimmstenfalls liest die Page eine Mischung aus alten + neuen Rows |
| HF API ändert Shape | `mapToCard` in `catalogService.ts` ist der einzige Mapping-Punkt. Wenn HF was Unverhofftes liefert, fängt das `last_error` per Row; alte DB-Rows bleiben |
| DB-Lese-Fehler | Wirft Exception, vom Express-Error-Handler aufgefangen, gibt 500. Nicht erwartet im Normal-Betrieb |

---

## 7. Testing

### 7.1 Unit-Tests

**`catalogCacheRepo.test.ts`:**
- `upsertCardCache` mit neuer Row → INSERT; mit bestehender Row → UPDATE
- `recordCacheError` ändert nur `last_error`, lässt `data_json` und `fetched_at` unangetastet
- `getCachedCard` returnt `null` für unbekannten Repo; deserialisiert `data_json` korrekt
- `getOldestFetchedAt` returnt das älteste Timestamp; `null` wenn Tabelle leer

**`catalogCacheRefresh.test.ts`:**
- `refreshCuratedHfCache` mit allen Mocks erfolgreich → `refreshed = n`, `failed = 0`
- 1 Mock-Failure (HF 500) → `failed = 1`, andere Rows trotzdem geschrieben
- HF 404 für ein Modell → `last_error` gesetzt, kein Crash
- `isCacheEmpty` returnt `true` wenn Tabelle leer, `false` sobald 1 Row vorhanden

### 7.2 Integration

- Manual smoke: Server starten, prüfen dass `/api/catalog/curated` schnell antwortet (kein HF-Roundtrip im Hot-Path bei vollem Cache), Logs zeigen Cron-Tick beim Start
- DB inspizieren: nach erstem Boot 8 Rows in `catalog_hf_cache`, `last_error` NULL

### 7.3 Manual Smoke nach Deploy

1. Backend deploy → Server-Start löst Initial-Cron-Tick aus
2. Nach ~10s Logs zeigen `[catalog-cache] primed: refreshed=8 failed=0`
3. `/catalog` lädt unverändert; Footer zeigt "Daten von Hugging Face — letzte Aktualisierung: vor wenigen Sekunden"
4. Page-Reload — sollte deutlich schneller sein als vorher (kein HF-Roundtrip)

---

## 8. Rollout

1. **Backend deployen**: neue Tabelle (additiv), Cron-Funktion, Controller-Update, Frontend-Bundle bleibt erst gleich
2. **Beim ersten Start** primt sich der Cache automatisch (Logs zeigen "primed: refreshed=8 failed=0")
3. **Frontend deployen** (kleines Update: `fetched_at` aus Response in Footer-Anzeige)
4. **Smoke prod**: `/catalog` schnell, Footer-Text zeigt frische Zeit

### Rollback
- Code-Rollback wie üblich (`dist.backup`, `git reset`)
- Schema-Cleanup nicht nötig (additive Tabelle)
- Alter live-HF-Pfad ist als Fallback noch im Code → läuft ohne DB-Daten weiter

---

## 9. Bekannte Risiken / Out-of-Scope

- **Wenn HF-API-Shape sich ändert**, könnte der nächste Cron alle Rows mit `last_error` markieren, ohne dass UI alarmiert. Footer zeigt nur alte `fetched_at` — kein lautes Signal. Bei künftigem Bedarf eine Stale-Warning mit Schwellwert (z.B. ">7 Tage alt") nachrüsten
- **`last_error`-Beobachtung** ist heute nur über Backend-Logs (`journalctl -u claudetracker-backend`). Eine Admin-UI im Tracker wäre eine kleine Folge-Aufgabe
- **Search-Pfad bleibt live HF** — falls Search auch gecacht werden soll (für Such-Queries die häufig wiederholt werden), eigenes Sub-Projekt
- **Curated-Liste-Cleanup**: gelöschte Modelle bleiben als Zombie-Rows in der DB. Kosmetisch, kein Funktionsproblem. Cleanup-Step im Cron wäre 5 Zeilen — Out-of-Scope für jetzt

---

## 10. Folge-Sub-Projekte (zur Orientierung)

- **B.2 — Neueste Bartowski/MaziyarPanahi Uploads als 4. Sektion**: profitiert direkt von der DB-Infrastruktur, die hier entsteht (neue Sektion landet als zusätzliche Repos im Cache)
- **B.3 — LLM-generierte Pros/Cons**: nutzt die bereits gecachten HF-Daten als Input (HF-README + Metadata), generiert Pros/Cons via lokales Ollama-Modell, speichert in einer weiteren Spalte/Tabelle
