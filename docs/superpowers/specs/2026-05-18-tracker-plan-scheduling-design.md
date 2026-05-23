# Tracker — Scheduled Plan Changes

**Date:** 2026-05-18
**Status:** Draft → awaiting user approval
**Author:** Harald Weiss

## Problem

`users.plan_name` ist eine manuelle Einstellung, die der User beim Abo-Wechsel selbst nachpflegen muss. Anthropic exponiert die Subscription-State nicht über eine öffentliche API, deshalb ist eine reine Detection-Lösung nicht praktikabel. Konkreter Auslöser: Wechsel von `Max (5x)` auf `Pro` am 2026-05-22 (Kostengründe). Der Tracker soll diesen Wechsel zum Stichtag automatisch umsetzen, ohne dass der User morgens daran denken muss.

## Scope

**In Scope**
- Einmaliger oder mehrfacher zukünftiger Plan-Wechsel kann vorgemerkt werden.
- Cron flippt `users.plan_name` am Stichtag automatisch.
- UI zeigt anstehende Wechsel und erlaubt Abbrechen.
- Audit-Trail über `plan_history`-Tabelle für alle vergangenen und zukünftigen Wechsel.
- Bestehender Immediate-Switch über das Plan-Dropdown bleibt funktional und schreibt jetzt ebenfalls in die History.

**Explicit Out of Scope**
- `usage_records` werden NICHT mit historischem Plan getaggt. Cost-Reports bleiben "current-plan-based" wie bisher.
- Admin-Override für fremde User-Pläne.
- E-Mail-Bestätigung für Plan-Schedule.
- Push-Notification bei aktiviertem Wechsel.
- Detection-Heuristiken aus dem Usage-Stream.

## Architektur

### Datenmodell

Neue Tabelle, additiv. Keine Änderung an `users`, `usage_records`, `plan_pricing`.

```sql
CREATE TABLE plan_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name       TEXT NOT NULL,
  effective_from  TEXT NOT NULL,                    -- ISO date YYYY-MM-DD
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  source          TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'seed' | 'scheduled'
  note            TEXT
);
CREATE INDEX idx_plan_history_user_date ON plan_history(user_id, effective_from);
```

**`source`-Werte**
- `seed` — einmaliger Backfill-Eintrag bei Migration für jeden bestehenden User
- `manual` — sofortiger Wechsel via bestehendem Plan-Dropdown (`effective_from = today`)
- `scheduled` — vorgemerkter zukünftiger Wechsel (`effective_from > today` beim Anlegen)

**`users.plan_name`** bleibt als Cache erhalten. Wird vom Cron synchron gehalten. Sync-Verzögerung max 24 h (Cron läuft täglich 00:05). Existierende Reads bleiben unverändert.

### Aktuell-Plan-Ableitung

Einzige autoritative Quelle für „aktueller Plan" ist diese Query:
```sql
SELECT plan_name FROM plan_history
 WHERE user_id = ? AND effective_from <= date('now')
 ORDER BY effective_from DESC, id DESC LIMIT 1
```
(Die `id DESC` als Tie-Breaker für mehrere Einträge am selben Tag — der spätere INSERT gewinnt.)

### Migration

Einmaliger Backfill in einer neuen Migration `seedPlanHistoryFromUsers.ts`:
```sql
INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
SELECT id, plan_name, substr(COALESCE(created_at, datetime('now')), 1, 10),
       'seed', 'Backfill from users.plan_name at migration time'
  FROM users
 WHERE plan_name IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM plan_history WHERE user_id = users.id);
```
Idempotent — safe to re-run.

**Neue User nach diesem Release**: Wo immer ein User mit gesetztem `plan_name` angelegt wird (z. B. Admin-Registration), muss in derselben Transaktion ein `plan_history`-Eintrag mit `source='seed'` und `effective_from = today` angelegt werden. Andernfalls liefert `getCurrentPlan` für neue User `null`. Bestehende Stelle: `seedInitialUser.ts`. Künftige Registration-Pfade müssen das ebenso tun.

### Service-Layer

Neuer Service `backend/src/services/planScheduleService.ts`:

| Funktion | Zweck |
|---|---|
| `getCurrentPlan(userId)` | Query oben — einzige Stelle die "current" definiert |
| `getPendingPlanChange(userId)` | Liefert nächsten Eintrag mit `effective_from > date('now')` oder null |
| `getPlanHistory(userId, limit?)` | Komplette History DESC sortiert |
| `schedulePlanChange(userId, planName, effectiveFrom, note?)` | INSERT mit Validierung: `planName` muss in `plan_pricing` existieren, `effective_from >= today` |
| `cancelPendingPlanChange(userId)` | `DELETE FROM plan_history WHERE user_id=? AND effective_from > date('now') AND source='scheduled'` — Sicherheitsfilter `source='scheduled'` damit `manual`/`seed` nie versehentlich entfernt werden |
| `applyDuePlanChanges()` | Cron-Aufruf: für jeden User dessen `getCurrentPlan` ≠ `users.plan_name`, syncen |
| `recordImmediatePlanChange(userId, planName, note?)` | Wird vom existierenden PATCH /api/account aufgerufen — INSERT mit `effective_from=today, source='manual'`. **No-op wenn `planName === getCurrentPlan(userId)`** (sonst Noise-Einträge bei jedem display_name-Update) |

### Cron

Piggyback auf bestehendes Pattern in `pricingService.ts:286`. In `server.ts` beim Start:
```ts
cronJob.schedule('5 0 * * *', applyDuePlanChanges);
applyDuePlanChanges();  // einmal bei Server-Start, falls Server zur Cron-Zeit aus war
```

### API

`accountController.ts` erweitern um:

| Methode | Pfad | Body / Response |
|---|---|---|
| `GET` | `/api/account/plan-history` | Array `{id, plan_name, effective_from, created_at, source, note}` |
| `GET` | `/api/account/plan-pending` | Objekt oder null |
| `POST` | `/api/account/plan-schedule` | Body `{plan_name, effective_from, note?}` → 201 + neuer Eintrag |
| `DELETE` | `/api/account/plan-schedule` | 204, löscht alle pending des aktuellen Users |

Existierendes `PATCH /api/account` bleibt funktional. Wenn der Request einen `plan_name` enthält, ruft der Handler zusätzlich `recordImmediatePlanChange()` auf.

### UI

`AccountSection.tsx` erweitern:

1. **Banner** oben in der Sektion wenn `getPendingPlanChange` einen Eintrag liefert:
   `📅 Plan wechselt am 2026-05-22 auf Pro — [Abbrechen]`
2. **Bestehender Plan-Dropdown** bleibt unverändert (sofortiger Wechsel).
3. **Neuer Block** „Plan-Wechsel vormerken":
   - Plan-Dropdown (gleiche Optionen)
   - Date-Picker `effective_from`, min = morgen
   - Optionales Note-Feld
   - Button „Wechsel vormerken"
4. **Collapsible History** (default eingeklappt): letzte 5 Einträge mit Datum, Plan, Source-Badge.

## Fehlerbehandlung

- POST mit Plan der nicht in `plan_pricing` existiert → 400 `{ error: 'unknown plan' }`
- POST mit `effective_from < today` → 400 `{ error: 'effective_from must be today or later' }`
- POST mit `effective_from = today` → akzeptiert, gleicher Pfad wie immediate-switch (User-Intent ist klar)
- DELETE wenn keine pending Einträge → 204 (idempotent)
- Cron-Fehler beim Sync eines Users → loggt mit `console.error`, fährt mit nächstem User fort

## Tests

`backend/src/__tests__/unit/planScheduleService.test.ts` (neu):
- `schedulePlanChange` lehnt Vergangenheits-Datum ab
- `schedulePlanChange` lehnt unbekannten plan_name ab
- `schedulePlanChange` akzeptiert today und future
- `getCurrentPlan` liefert jüngsten Eintrag mit `effective_from <= today`
- `getCurrentPlan` mit zwei Einträgen am selben Tag: spätere `id` gewinnt
- `getPendingPlanChange` ignoriert `effective_from = today`
- `applyDuePlanChanges` synct `users.plan_name` korrekt
- `applyDuePlanChanges` no-op wenn bereits in sync
- `cancelPendingPlanChange` betrifft nur Zukunfts-Einträge mit `source='scheduled'`
- `recordImmediatePlanChange` legt korrekten History-Eintrag an

`backend/src/__tests__/unit/accountController.test.ts` (erweitern) für die vier neuen Endpoints — happy path + auth checks.

`backend/src/__tests__/unit/seedPlanHistoryFromUsers.test.ts` (neu): bestehende User bekommen exakt einen Seed-Eintrag; re-run ändert nichts.

## Deployment

1. Backend deployen über bestehenden VPS-Workflow.
2. Migration läuft beim ersten Startup automatisch (idempotent).
3. Frontend-Build deployen.
4. `systemctl restart claudetracker-backend`.
5. Verifikation in der UI: Banner erscheint (oder eben nicht), Date-Picker funktioniert.

Für den konkreten 22.5.-Wechsel: nach Deploy einmal die UI öffnen, „Wechsel vormerken" → Plan = Pro, Datum = 2026-05-22, Note = „Kostengründe". Banner sollte erscheinen. Am 22.5. um 00:05 flippt der Cron automatisch.
