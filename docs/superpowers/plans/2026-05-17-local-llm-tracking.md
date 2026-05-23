# Local LLM Tracking via ai-provider-service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local LLM usage (Ollama / llama.cpp via `ai-provider-service`) visible in the Claude Usage Tracker as a fourth data source — new "Lokale LLM-Nutzung" overview card, new settings section, new sync cron.

**Architecture:** Pull-based — `ai-provider-service` gets per-call event logging plus a new `GET /usage/events` route. The tracker backend polls every 15 min and mirrors events into a local SQLite table. Frontend gets a card showing token totals and a settings section with encrypted token storage.

**Tech Stack:** Python/Flask + SQLAlchemy (provider-service), Node.js/TypeScript + better-sqlite3 + Jest (tracker backend), React + TypeScript + Vitest (tracker frontend), AES-256-GCM for token encryption.

**Spec:** [docs/superpowers/specs/2026-05-17-local-llm-tracking-design.md](../specs/2026-05-17-local-llm-tracking-design.md)

---

## File Structure

### Phase 1 — ai-provider-service (`/Users/haraldweiss/projects/ai-provider-service/`)

| File | Action | Purpose |
|---|---|---|
| `storage/models.py` | Modify | Add `UsageEvent` model |
| `pricing.py` | Create | `calc_cost_usd` and pricing table |
| `dispatcher.py` | Modify | Add `_log_usage_event`, hook into `_execute` |
| `api/chat_api.py` | Modify | Extract `X-Origin-App` header, pass through |
| `api/usage_api.py` | Create | `GET /usage/events` route |
| `app.py` | Modify | Register new blueprint |
| `tests/test_pricing.py` | Create | Unit tests for cost calculation |
| `tests/test_dispatcher_logging.py` | Create | Verify event written on success and error |
| `tests/test_usage_api.py` | Create | Test the GET endpoint (auth, pagination, filtering) |

### Phase 2 — Tracker Backend

Worktree path: `/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend/`

| File | Action | Purpose |
|---|---|---|
| `src/database/sqlite.ts` | Modify | Add two new `CREATE TABLE` statements |
| `src/utils/secretCrypto.ts` | Create | AES-256-GCM encrypt/decrypt helpers |
| `src/services/providerServiceSyncService.ts` | Create | Pull events from provider-service |
| `src/data/localUsageRepo.ts` | Create | DB queries (config CRUD, event insert, aggregation) |
| `src/controllers/localUsageController.ts` | Create | HTTP handlers |
| `src/routes/localUsage.ts` | Create | Route definitions |
| `src/app.ts` | Modify | Mount the new router |
| `src/server.ts` | Modify | Register the 15-min cron hook |
| `.env.example` | Modify | Document `SECRETS_KEY` |
| `src/__tests__/unit/secretCrypto.test.ts` | Create | Roundtrip + tamper tests |
| `src/__tests__/unit/providerServiceSyncService.test.ts` | Create | Mocked-fetch sync logic |
| `src/__tests__/unit/localUsageRepo.test.ts` | Create | Repo aggregation tests |

### Phase 3 — Tracker Frontend

Worktree path: `/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend/`

| File | Action | Purpose |
|---|---|---|
| `src/services/localUsageApi.ts` | Create | Typed API client |
| `src/components/LocalUsageCard.tsx` | Create | New overview card |
| `src/components/settings/ProviderServiceSettings.tsx` | Create | Settings section |
| `src/components/OverviewTab.tsx` | Modify | Mount card |
| `src/pages/Settings.tsx` | Modify | Mount settings section |
| `src/__tests__/components/LocalUsageCard.test.tsx` | Create | Render states |

---

## Phase 1 — ai-provider-service

### Task 1: Add `UsageEvent` model

**Files:**
- Modify: `storage/models.py`
- Test: `tests/test_usage_event_model.py`

- [ ] **Step 1.1: Write the failing test**

Create `tests/test_usage_event_model.py` with three tests: insert+query, error row, since-filter. Use the fixture pattern from `tests/test_dispatcher_fallback.py` (in-memory SQLite via env vars).

Test content:

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from app import create_app
from database import db


@pytest.fixture
def app():
    os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
    os.environ['ENCRYPTION_KEY'] = 'X' * 44
    os.environ['SERVICE_TOKEN'] = 'test-token'
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_usage_event_insert_and_query(app):
    from storage.models import UsageEvent
    e = UsageEvent(
        user_id='user-1', provider_id='ollama', model='llama3.1:8b',
        input_tokens=120, output_tokens=80, cost_usd=0.0,
        origin_app=None, status='success',
    )
    db.session.add(e)
    db.session.commit()
    rows = UsageEvent.query.filter_by(user_id='user-1').all()
    assert len(rows) == 1
    assert rows[0].provider_id == 'ollama'
    assert rows[0].input_tokens == 120
    assert rows[0].status == 'success'
    assert rows[0].created_at is not None


def test_usage_event_error_row(app):
    from storage.models import UsageEvent
    e = UsageEvent(
        user_id='user-1', provider_id='claude', model='claude-haiku-4-5',
        input_tokens=None, output_tokens=None, cost_usd=None,
        status='error', error_message='ConnectionError: timeout',
    )
    db.session.add(e)
    db.session.commit()
    row = UsageEvent.query.filter_by(status='error').one()
    assert row.error_message.startswith('ConnectionError')
    assert row.input_tokens is None
    assert row.cost_usd is None


def test_usage_event_since_filter(app):
    from storage.models import UsageEvent
    old = UsageEvent(user_id='u', provider_id='ollama', model='m',
                    status='success', created_at=datetime.utcnow() - timedelta(hours=2))
    new = UsageEvent(user_id='u', provider_id='ollama', model='m',
                    status='success', created_at=datetime.utcnow())
    db.session.add_all([old, new])
    db.session.commit()
    cutoff = datetime.utcnow() - timedelta(hours=1)
    rows = UsageEvent.query.filter(UsageEvent.created_at > cutoff).all()
    assert len(rows) == 1
```

- [ ] **Step 1.2: Run test to verify it fails**

```
cd /Users/haraldweiss/projects/ai-provider-service
. venv/bin/activate
pytest tests/test_usage_event_model.py -v
```

Expected: FAIL with `ImportError: cannot import name 'UsageEvent'`.

- [ ] **Step 1.3: Add the model class to `storage/models.py`**

Append to the end of `storage/models.py`:

```python
class UsageEvent(db.Model):
    """Per-Call-Logging für alle Provider-Aufrufe."""
    __tablename__ = 'usage_events'

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow,
                           nullable=False, index=True)
    user_id = db.Column(db.String(255), nullable=False, index=True)
    provider_id = db.Column(db.String(32), nullable=False, index=True)
    model = db.Column(db.String(128), nullable=False)
    input_tokens = db.Column(db.Integer, nullable=True)
    output_tokens = db.Column(db.Integer, nullable=True)
    cost_usd = db.Column(db.Numeric(10, 6), nullable=True)
    origin_app = db.Column(db.String(64), nullable=True)
    status = db.Column(db.String(16), nullable=False)
    error_message = db.Column(db.Text, nullable=True)

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'user_id': self.user_id,
            'provider_id': self.provider_id,
            'model': self.model,
            'input_tokens': self.input_tokens,
            'output_tokens': self.output_tokens,
            'cost_usd': float(self.cost_usd) if self.cost_usd is not None else None,
            'origin_app': self.origin_app,
            'status': self.status,
            'error_message': self.error_message,
        }
```

- [ ] **Step 1.4: Run tests to verify pass**

```
pytest tests/test_usage_event_model.py -v
```

Expected: 3 passed.

- [ ] **Step 1.5: Commit**

```
git add storage/models.py tests/test_usage_event_model.py
git commit -m "feat(usage): add UsageEvent model for per-call logging"
```

---

### Task 2: Pricing module — `calc_cost_usd`

**Files:**
- Create: `pricing.py`
- Test: `tests/test_pricing.py`

- [ ] **Step 2.1: Write the failing test**

Create `tests/test_pricing.py`:

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_local_provider_returns_zero():
    from pricing import calc_cost_usd
    assert calc_cost_usd('ollama', 'llama3.1:8b', 1000, 500) == 0.0


def test_local_provider_with_null_tokens_returns_none():
    from pricing import calc_cost_usd
    assert calc_cost_usd('ollama', 'llama3.1:8b', None, None) is None


def test_claude_haiku_pricing():
    from pricing import calc_cost_usd
    cost = calc_cost_usd('claude', 'claude-haiku-4-5', 1_000_000, 1_000_000)
    assert cost == 4.80


def test_claude_versioned_model_strips_version():
    from pricing import calc_cost_usd
    cost = calc_cost_usd('claude', 'claude-haiku-4-5-20251001',
                         1_000_000, 1_000_000)
    assert cost == 4.80


def test_openai_gpt_4o_mini_pricing():
    from pricing import calc_cost_usd
    cost = calc_cost_usd('openai', 'gpt-4o-mini', 1_000_000, 1_000_000)
    assert cost == 0.75


def test_unknown_model_returns_none():
    from pricing import calc_cost_usd
    assert calc_cost_usd('claude', 'unknown-model-xyz', 100, 100) is None


def test_custom_provider_returns_none_for_unknown_model():
    from pricing import calc_cost_usd
    assert calc_cost_usd('custom', 'some-local-model', 100, 100) is None
```

- [ ] **Step 2.2: Run test to verify it fails**

```
pytest tests/test_pricing.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'pricing'`.

- [ ] **Step 2.3: Implement `pricing.py`**

Create `pricing.py`:

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Cost-Berechnung für Provider-Calls. Statischer Snapshot, manuell pflegen."""
from __future__ import annotations
import re
from typing import Optional

_PRICING_USD_PER_MTOK: dict[tuple[str, str], dict[str, float]] = {
    ('claude', 'claude-opus-4-7'):    {'in': 15.0, 'out': 75.0},
    ('claude', 'claude-sonnet-4-6'):  {'in':  3.0, 'out': 15.0},
    ('claude', 'claude-haiku-4-5'):   {'in':  0.8, 'out':  4.0},
    ('openai', 'gpt-4o'):             {'in':  2.5, 'out': 10.0},
    ('openai', 'gpt-4o-mini'):        {'in':  0.15, 'out': 0.6},
}

_LOCAL_PROVIDERS = {'ollama'}


def _strip_version(model: str) -> str:
    return re.sub(r'-\d{8}$', '', model)


def calc_cost_usd(
    provider_id: str, model: str,
    input_tokens: Optional[int], output_tokens: Optional[int],
) -> Optional[float]:
    if input_tokens is None or output_tokens is None:
        return None
    if provider_id in _LOCAL_PROVIDERS:
        return 0.0
    rates = _PRICING_USD_PER_MTOK.get((provider_id, model)) \
        or _PRICING_USD_PER_MTOK.get((provider_id, _strip_version(model)))
    if not rates:
        return None
    return round(
        (input_tokens * rates['in'] + output_tokens * rates['out']) / 1_000_000,
        6,
    )
```

- [ ] **Step 2.4: Run tests to verify pass**

```
pytest tests/test_pricing.py -v
```

Expected: 7 passed.

- [ ] **Step 2.5: Commit**

```
git add pricing.py tests/test_pricing.py
git commit -m "feat(pricing): add USD cost calc module"
```

---

### Task 3: Hook `_log_usage_event` into `_execute`

**Files:**
- Modify: `dispatcher.py`
- Test: `tests/test_dispatcher_logging.py`

- [ ] **Step 3.1: Write the failing test**

Create `tests/test_dispatcher_logging.py`:

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from app import create_app
from database import db


@pytest.fixture
def app():
    os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
    os.environ['ENCRYPTION_KEY'] = 'X' * 44
    os.environ['SERVICE_TOKEN'] = 'test-token'
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_execute_logs_success_event(app):
    from dispatcher import _execute
    from storage.models import UsageEvent
    with patch('dispatcher.get_client') as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.create_message.return_value = {
            'content': [{'text': 'hi'}],
            'usage': {'input_tokens': 42, 'output_tokens': 17},
        }
        _execute('user-1', 'ollama', 'llama3.1:8b',
                 [{'role': 'user', 'content': 'hi'}], 100)
    events = UsageEvent.query.all()
    assert len(events) == 1
    ev = events[0]
    assert ev.user_id == 'user-1'
    assert ev.provider_id == 'ollama'
    assert ev.input_tokens == 42
    assert ev.output_tokens == 17
    assert ev.cost_usd == 0.0
    assert ev.status == 'success'


def test_execute_logs_error_event(app):
    from dispatcher import _execute
    from storage.models import UsageEvent
    with patch('dispatcher.get_client') as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.create_message.side_effect = RuntimeError('boom')
        with pytest.raises(RuntimeError):
            _execute('user-1', 'claude', 'claude-haiku-4-5',
                     [{'role': 'user', 'content': 'hi'}], 100)
    events = UsageEvent.query.all()
    assert len(events) == 1
    ev = events[0]
    assert ev.status == 'error'
    assert 'RuntimeError' in ev.error_message
    assert 'boom' in ev.error_message
    assert ev.input_tokens is None


def test_execute_with_origin_app(app):
    from dispatcher import _execute
    from storage.models import UsageEvent
    with patch('dispatcher.get_client') as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.create_message.return_value = {
            'content': [{'text': 'x'}],
            'usage': {'input_tokens': 1, 'output_tokens': 1},
        }
        _execute('user-1', 'ollama', 'qwen',
                 [{'role': 'user', 'content': 'hi'}], 100,
                 origin_app='bewerbungstracker')
    ev = UsageEvent.query.one()
    assert ev.origin_app == 'bewerbungstracker'
```

- [ ] **Step 3.2: Run test to verify it fails**

```
pytest tests/test_dispatcher_logging.py -v
```

Expected: FAIL — `_execute` does not accept `origin_app` and does not write events.

- [ ] **Step 3.3: Modify `dispatcher.py`**

Add this helper above `_execute`:

```python
def _log_usage_event(
    user_id: str, provider_id: str, model: str,
    input_tokens, output_tokens, status: str,
    error_message: Optional[str] = None,
    origin_app: Optional[str] = None,
) -> None:
    """Schreibt einen UsageEvent. Logging-Fehler werden geschluckt — der
    Hot-Path darf dadurch nicht abbrechen."""
    try:
        from pricing import calc_cost_usd
        from storage.models import UsageEvent
        cost = calc_cost_usd(provider_id, model, input_tokens, output_tokens)
        ev = UsageEvent(
            user_id=user_id, provider_id=provider_id, model=model,
            input_tokens=input_tokens, output_tokens=output_tokens,
            cost_usd=cost, origin_app=origin_app, status=status,
            error_message=error_message,
        )
        db.session.add(ev)
        db.session.commit()
    except Exception as log_err:
        logger.warning(f'usage_event logging failed: {log_err}')
        db.session.rollback()
```

Replace the existing `_execute` function body with:

```python
def _execute(
    user_id: str, provider_id: str, model: str, messages: list, max_tokens: int,
    config_override: Optional[dict] = None,
    origin_app: Optional[str] = None,
) -> dict:
    cfg = config_override if config_override is not None else _load_config(user_id, provider_id)
    if cfg is None:
        raise ValueError(f"Provider {provider_id} ist nicht konfiguriert für user_id={user_id}")
    client = get_client(provider_id, cfg)
    try:
        result = client.create_message(model, messages, max_tokens)
        health_tracker.set_status(provider_id, True)
        usage = (result or {}).get('usage') or {}
        _log_usage_event(
            user_id, provider_id, model,
            usage.get('input_tokens'), usage.get('output_tokens'),
            'success', origin_app=origin_app,
        )
        return result
    except Exception as e:
        health_tracker.set_status(provider_id, False, reason=f"{type(e).__name__}: {e}")
        _log_usage_event(
            user_id, provider_id, model, None, None,
            'error', error_message=f"{type(e).__name__}: {e}",
            origin_app=origin_app,
        )
        raise
```

- [ ] **Step 3.4: Run tests**

```
pytest tests/test_dispatcher_logging.py tests/test_dispatcher_fallback.py -v
```

Expected: All pass. The existing `test_dispatcher_fallback.py` must still pass.

- [ ] **Step 3.5: Commit**

```
git add dispatcher.py tests/test_dispatcher_logging.py
git commit -m "feat(dispatcher): log UsageEvent on every _execute path"
```

---

### Task 4: Wire `origin_app` through `dispatch()` and `/chat`

**Files:**
- Modify: `dispatcher.py` (function `dispatch`)
- Modify: `api/chat_api.py`

- [ ] **Step 4.1: Write the failing test (append to existing file)**

Append to `tests/test_dispatcher_logging.py`:

```python
def test_dispatch_passes_origin_app_through(app):
    from dispatcher import dispatch
    from storage.models import UsageEvent
    with patch('dispatcher.health_tracker.is_healthy', return_value=True), \
         patch('dispatcher.get_client') as mock_get_client:
        mock_client = mock_get_client.return_value
        mock_client.create_message.return_value = {
            'content': [{'text': 'ok'}],
            'usage': {'input_tokens': 5, 'output_tokens': 3},
        }
        dispatch(
            user_id='u1', provider_id='ollama', model='m',
            messages=[{'role': 'user', 'content': 'x'}],
            origin_app='loganonymizer',
        )
    ev = UsageEvent.query.one()
    assert ev.origin_app == 'loganonymizer'
```

- [ ] **Step 4.2: Run test to verify it fails**

```
pytest tests/test_dispatcher_logging.py::test_dispatch_passes_origin_app_through -v
```

Expected: FAIL — `dispatch()` does not accept `origin_app`.

- [ ] **Step 4.3: Modify `dispatch()` signature in `dispatcher.py`**

Change the signature to add `origin_app: Optional[str] = None` as a keyword-only arg:

```python
def dispatch(
    user_id: str,
    provider_id: str,
    model: str,
    messages: list,
    max_tokens: int = 600,
    *,
    fallback_provider_override: Optional[str] = None,
    fallback_model_override: Optional[str] = None,
    fallback_config_override: Optional[dict] = None,
    origin_app: Optional[str] = None,
) -> dict:
```

In the two `_execute(...)` call sites inside `dispatch`, add `origin_app=origin_app`:

```python
# Primary path:
result = _execute(user_id, provider_id, model, messages, max_tokens,
                  origin_app=origin_app)

# Fallback path:
result = _execute(user_id, fallback, fallback_model, messages, max_tokens,
                  fallback_cfg, origin_app=origin_app)
```

Also update `drain_queue_for_provider` — the `_execute(...)` call there should pass `origin_app=None`:

```python
result = _execute(
    q.user_id, q.primary_provider,
    payload.get('model'), payload.get('messages', []),
    payload.get('max_tokens', 600),
    origin_app=None,
)
```

- [ ] **Step 4.4: Modify `api/chat_api.py`**

Open the file with the Read tool, find the `dispatch(...)` call in the `/chat` handler, and add:

```python
origin_app=request.headers.get('X-Origin-App'),
```

to the kwargs. If `chat_api.py` exposes additional endpoints that also call `dispatch()`, modify those too.

- [ ] **Step 4.5: Run tests**

```
pytest tests/test_dispatcher_logging.py tests/test_dispatcher_fallback.py -v
```

Expected: All pass.

- [ ] **Step 4.6: Commit**

```
git add dispatcher.py api/chat_api.py tests/test_dispatcher_logging.py
git commit -m "feat(api): propagate X-Origin-App header into UsageEvent"
```

---

### Task 5: `GET /usage/events` API route

**Files:**
- Create: `api/usage_api.py`
- Modify: `app.py`
- Test: `tests/test_usage_api.py`

- [ ] **Step 5.1: Write the failing test**

Create `tests/test_usage_api.py`:

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from app import create_app
from database import db


@pytest.fixture
def app():
    os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
    os.environ['ENCRYPTION_KEY'] = 'X' * 44
    os.environ['SERVICE_TOKEN'] = 'test-token'
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _seed(n: int, user_id='u1'):
    from storage.models import UsageEvent
    base = datetime(2026, 5, 1, 12, 0, 0)
    for i in range(n):
        ev = UsageEvent(
            user_id=user_id, provider_id='ollama', model='m',
            input_tokens=10, output_tokens=5, cost_usd=0.0,
            status='success',
        )
        ev.created_at = base + timedelta(minutes=i)
        db.session.add(ev)
    db.session.commit()


def test_requires_auth(app, client):
    with app.app_context():
        _seed(3)
    res = client.get('/usage/events?user_id=u1')
    assert res.status_code == 401


def test_requires_user_id(app, client):
    res = client.get('/usage/events',
                     headers={'Authorization': 'Bearer test-token'})
    assert res.status_code == 400


def test_returns_events_for_user(app, client):
    with app.app_context():
        _seed(3, user_id='u1')
        _seed(2, user_id='u2')
    res = client.get('/usage/events?user_id=u1',
                     headers={'Authorization': 'Bearer test-token'})
    assert res.status_code == 200
    data = res.get_json()
    assert data['count'] == 3
    assert len(data['events']) == 3
    assert all(e['user_id'] == 'u1' for e in data['events'])
    assert data['has_more'] is False


def test_since_filter(app, client):
    with app.app_context():
        _seed(5)
    res = client.get(
        '/usage/events?user_id=u1&since=2026-05-01T12:01:30',
        headers={'Authorization': 'Bearer test-token'},
    )
    data = res.get_json()
    assert data['count'] == 3


def test_pagination_limit(app, client):
    with app.app_context():
        _seed(10)
    res = client.get('/usage/events?user_id=u1&limit=4',
                     headers={'Authorization': 'Bearer test-token'})
    data = res.get_json()
    assert data['count'] == 4
    assert data['has_more'] is True
    assert data['next_since'] is not None
    res2 = client.get(
        f'/usage/events?user_id=u1&since={data["next_since"]}&limit=4',
        headers={'Authorization': 'Bearer test-token'},
    )
    data2 = res2.get_json()
    assert data2['count'] == 4
    assert data2['has_more'] is True


def test_invalid_since_returns_400(app, client):
    res = client.get('/usage/events?user_id=u1&since=not-a-timestamp',
                     headers={'Authorization': 'Bearer test-token'})
    assert res.status_code == 400
```

- [ ] **Step 5.2: Run test to verify it fails**

```
pytest tests/test_usage_api.py -v
```

Expected: FAIL — route does not exist.

- [ ] **Step 5.3: Inspect the existing auth decorator**

Read `api/auth.py` to find the existing `require_service_token` decorator (or whatever the name is). Match the import and use pattern that `api/chat_api.py` already follows.

- [ ] **Step 5.4: Create `api/usage_api.py`**

```python
# SPDX-License-Identifier: AGPL-3.0-or-later
"""GET /usage/events — read-only endpoint for the Claude Usage Tracker."""
from __future__ import annotations
from datetime import datetime
from flask import Blueprint, jsonify, request

from api.auth import require_service_token
from storage.models import UsageEvent

bp = Blueprint('usage_api', __name__)


@bp.route('/usage/events', methods=['GET'])
@require_service_token
def list_events():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    since_raw = request.args.get('since')
    since_dt = None
    if since_raw:
        try:
            since_dt = datetime.fromisoformat(since_raw)
        except ValueError:
            return jsonify({'error': 'invalid since timestamp'}), 400

    try:
        limit = int(request.args.get('limit', 500))
    except ValueError:
        return jsonify({'error': 'invalid limit'}), 400
    limit = max(1, min(limit, 2000))

    q = UsageEvent.query.filter_by(user_id=user_id)
    if since_dt is not None:
        q = q.filter(UsageEvent.created_at > since_dt)
    rows = q.order_by(UsageEvent.created_at.asc()).limit(limit).all()

    return jsonify({
        'events': [r.to_dict() for r in rows],
        'count': len(rows),
        'next_since': rows[-1].created_at.isoformat() if rows else since_raw,
        'has_more': len(rows) == limit,
    })
```

If the decorator name in `api/auth.py` differs, adjust the import. The exact name will be visible after Step 5.3.

- [ ] **Step 5.5: Register blueprint in `app.py`**

Find the `app.register_blueprint(...)` block in `app.py` and add:

```python
from api.usage_api import bp as usage_api_bp
app.register_blueprint(usage_api_bp)
```

Match the registration pattern of the other blueprints (some use `url_prefix=`).

- [ ] **Step 5.6: Run all tests**

```
pytest tests/ -v
```

Expected: All tests pass, including pre-existing.

- [ ] **Step 5.7: Commit**

```
git add api/usage_api.py app.py tests/test_usage_api.py
git commit -m "feat(api): add GET /usage/events for tracker pull-sync"
```

---

### Task 6: Phase 1 sanity check (manual)

- [ ] **Step 6.1: Start the service locally**

```
cd /Users/haraldweiss/projects/ai-provider-service
. venv/bin/activate
python3 app.py
```

- [ ] **Step 6.2: Hit the endpoint and confirm an empty response**

In a new shell:

```
curl -H "Authorization: Bearer $(grep ^SERVICE_TOKEN .env | cut -d= -f2)" \
     'http://127.0.0.1:8767/usage/events?user_id=test'
```

Expected: `{"events": [], "count": 0, "next_since": null, "has_more": false}`.

- [ ] **Step 6.3: Trigger an Ollama call (if Ollama is running) and re-poll**

Make a real chat call via `/chat`, then re-run the curl. Expected: at least one event with `input_tokens`, `output_tokens`, `cost_usd: 0.0` populated.

---

## Phase 2 — Tracker Backend

### Task 7: Add new tables to `sqlite.ts`

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 7.1: Read the current file**

Open `backend/src/database/sqlite.ts` and find the section where existing `CREATE TABLE IF NOT EXISTS` statements live.

- [ ] **Step 7.2: Add table definitions**

In that section, append the following SQL via the same db helper the file already uses (the existing code reveals whether it's `db.exec(...)` or a different wrapper — match exactly):

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

- [ ] **Step 7.3: Run existing backend tests**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 7.4: Commit**

```
git add backend/src/database/sqlite.ts
git commit -m "feat(db): add tables for provider-service config and events"
```

---

### Task 8: `secretCrypto.ts` — AES-256-GCM helpers

**Files:**
- Create: `backend/src/utils/secretCrypto.ts`
- Create: `backend/src/__tests__/unit/secretCrypto.test.ts`
- Modify: `backend/.env.example`

- [ ] **Step 8.1: Write the failing test**

Create `backend/src/__tests__/unit/secretCrypto.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import { encryptSecret, decryptSecret } from '../../utils/secretCrypto.js';

const TEST_KEY = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
).toString('base64');

beforeEach(() => {
  process.env.SECRETS_KEY = TEST_KEY;
});

describe('secretCrypto', () => {
  it('roundtrips a plain string', () => {
    const enc = encryptSecret('super-secret-token');
    expect(enc).not.toBe('super-secret-token');
    expect(decryptSecret(enc)).toBe('super-secret-token');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('throws when ciphertext is tampered with', () => {
    const enc = encryptSecret('hello');
    const parts = enc.split(':');
    const tampered = Buffer.from(parts[2], 'base64');
    tampered[0] ^= 0xff;
    parts[2] = tampered.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('throws when SECRETS_KEY missing', () => {
    delete process.env.SECRETS_KEY;
    expect(() => encryptSecret('x')).toThrow(/SECRETS_KEY/);
  });
});
```

- [ ] **Step 8.2: Run to verify fail**

```
npm test -- secretCrypto
```

Expected: FAIL — module does not exist.

- [ ] **Step 8.3: Implement `secretCrypto.ts`**

Create `backend/src/utils/secretCrypto.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error('SECRETS_KEY env var is required for token encryption');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_KEY must be ${KEY_BYTES} bytes (base64); got ${key.length}`,
    );
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = enc.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Invalid encrypted secret format');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}
```

- [ ] **Step 8.4: Document env var**

Append to `backend/.env.example`:

```
# AES-256-GCM key for encrypting per-user secrets (e.g. ai-provider-service token).
# Generate once with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Losing this key means users must re-enter their tokens.
SECRETS_KEY=
```

- [ ] **Step 8.5: Run tests**

```
npm test -- secretCrypto
```

Expected: 4 passed.

- [ ] **Step 8.6: Commit**

```
git add backend/src/utils/secretCrypto.ts \
        backend/src/__tests__/unit/secretCrypto.test.ts \
        backend/.env.example
git commit -m "feat(crypto): add AES-256-GCM helpers for per-user secret storage"
```

---

### Task 9: `localUsageRepo.ts` — DB queries

**Files:**
- Create: `backend/src/data/localUsageRepo.ts`
- Create: `backend/src/__tests__/unit/localUsageRepo.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `backend/src/__tests__/unit/localUsageRepo.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import Database from 'better-sqlite3';
import {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  listUsersWithProviderServiceConfig,
  insertEventIfNew,
  getLocalUsageSummary,
  updateSyncStatus,
} from '../../data/localUsageRepo.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
    CREATE TABLE user_provider_service_config (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      service_url TEXT NOT NULL, service_token_enc TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      last_sync_at TEXT, last_sync_cursor TEXT, last_sync_error TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE provider_service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remote_event_id INTEGER NOT NULL,
      remote_created_at TEXT NOT NULL,
      provider_id TEXT NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
      origin_app TEXT, status TEXT NOT NULL, error_message TEXT,
      ingested_at TEXT NOT NULL,
      UNIQUE (user_id, remote_event_id)
    );
  `);
  db.prepare('INSERT INTO users(id, email) VALUES (1, ?)').run('a@b.c');
});

afterEach(() => db.close());

describe('localUsageRepo', () => {
  it('upsertProviderServiceConfig inserts new and updates existing', () => {
    upsertProviderServiceConfig(db, 1, {
      service_url: 'http://x', service_token_enc: 'enc1',
      provider_user_id: 'p1', enabled: 1,
    });
    let cfg = getProviderServiceConfig(db, 1);
    expect(cfg?.service_url).toBe('http://x');
    upsertProviderServiceConfig(db, 1, {
      service_url: 'http://y', service_token_enc: 'enc2',
      provider_user_id: 'p1', enabled: 1,
    });
    cfg = getProviderServiceConfig(db, 1);
    expect(cfg?.service_url).toBe('http://y');
    expect(cfg?.service_token_enc).toBe('enc2');
  });

  it('listUsersWithProviderServiceConfig returns enabled users only', () => {
    db.prepare('INSERT INTO users(id, email) VALUES (2, ?)').run('c@d.e');
    upsertProviderServiceConfig(db, 1, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'p', enabled: 1,
    });
    upsertProviderServiceConfig(db, 2, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'p', enabled: 0,
    });
    const ids = listUsersWithProviderServiceConfig(db).map((u) => u.user_id);
    expect(ids).toEqual([1]);
  });

  it('insertEventIfNew is idempotent on (user_id, remote_event_id)', () => {
    const ev = {
      remote_event_id: 42, remote_created_at: '2026-05-01T12:00:00',
      provider_id: 'ollama', model: 'm', input_tokens: 10, output_tokens: 5,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    };
    expect(insertEventIfNew(db, 1, ev)).toBe(true);
    expect(insertEventIfNew(db, 1, ev)).toBe(false);
    expect(insertEventIfNew(db, 1, { ...ev, remote_event_id: 43 })).toBe(true);
  });

  it('getLocalUsageSummary aggregates tokens and counts by period', () => {
    const now = new Date();
    const inMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12).toISOString();
    insertEventIfNew(db, 1, {
      remote_event_id: 1, remote_created_at: inMonth,
      provider_id: 'ollama', model: 'llama3.1:8b',
      input_tokens: 100, output_tokens: 50,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    insertEventIfNew(db, 1, {
      remote_event_id: 2, remote_created_at: inMonth,
      provider_id: 'ollama', model: 'llama3.1:8b',
      input_tokens: 200, output_tokens: 100,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    const s = getLocalUsageSummary(db, 1, 'month');
    expect(s.calls).toBe(2);
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(150);
    expect(s.totalTokens).toBe(450);
    expect(s.topModels[0]).toEqual({ model: 'llama3.1:8b', calls: 2 });
  });

  it('updateSyncStatus clears error on success', () => {
    upsertProviderServiceConfig(db, 1, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'p', enabled: 1,
    });
    updateSyncStatus(db, 1, {
      last_sync_at: '2026-05-01T12:00:00',
      last_sync_cursor: '2026-05-01T12:00:00',
      last_sync_error: null,
    });
    const cfg = getProviderServiceConfig(db, 1);
    expect(cfg?.last_sync_at).toBe('2026-05-01T12:00:00');
    expect(cfg?.last_sync_error).toBeNull();
  });
});
```

- [ ] **Step 9.2: Run to verify fail**

```
npm test -- localUsageRepo
```

Expected: FAIL.

- [ ] **Step 9.3: Implement `localUsageRepo.ts`**

Create `backend/src/data/localUsageRepo.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import type Database from 'better-sqlite3';

export interface ProviderServiceConfigRow {
  user_id: number;
  service_url: string;
  service_token_enc: string;
  provider_user_id: string;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  last_sync_error: string | null;
  enabled: number;
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token_enc: string;
  provider_user_id: string;
  enabled: number;
}

export interface RemoteEvent {
  remote_event_id: number;
  remote_created_at: string;
  provider_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  origin_app: string | null;
  status: string;
  error_message: string | null;
}

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModels: Array<{ model: string; calls: number }>;
}

export interface SyncStatusUpdate {
  last_sync_at?: string;
  last_sync_cursor?: string | null;
  last_sync_error?: string | null;
}

export function upsertProviderServiceConfig(
  db: Database.Database, userId: number, input: ProviderServiceConfigInput,
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_provider_service_config
      (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
    VALUES (@user_id, @service_url, @service_token_enc, @provider_user_id, @enabled, @now, @now)
    ON CONFLICT(user_id) DO UPDATE SET
      service_url = excluded.service_url,
      service_token_enc = excluded.service_token_enc,
      provider_user_id = excluded.provider_user_id,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run({
    user_id: userId,
    service_url: input.service_url,
    service_token_enc: input.service_token_enc,
    provider_user_id: input.provider_user_id,
    enabled: input.enabled,
    now,
  });
}

export function getProviderServiceConfig(
  db: Database.Database, userId: number,
): ProviderServiceConfigRow | null {
  const row = db.prepare(
    'SELECT * FROM user_provider_service_config WHERE user_id = ?',
  ).get(userId) as ProviderServiceConfigRow | undefined;
  return row ?? null;
}

export function listUsersWithProviderServiceConfig(
  db: Database.Database,
): Array<{ user_id: number }> {
  return db.prepare(
    'SELECT user_id FROM user_provider_service_config WHERE enabled = 1',
  ).all() as Array<{ user_id: number }>;
}

export function updateSyncStatus(
  db: Database.Database, userId: number, update: SyncStatusUpdate,
): void {
  const sets: string[] = ['updated_at = @updated_at'];
  const params: Record<string, unknown> = {
    user_id: userId, updated_at: new Date().toISOString(),
  };
  if (update.last_sync_at !== undefined) {
    sets.push('last_sync_at = @last_sync_at');
    params.last_sync_at = update.last_sync_at;
  }
  if (update.last_sync_cursor !== undefined) {
    sets.push('last_sync_cursor = @last_sync_cursor');
    params.last_sync_cursor = update.last_sync_cursor;
  }
  if (update.last_sync_error !== undefined) {
    sets.push('last_sync_error = @last_sync_error');
    params.last_sync_error = update.last_sync_error;
  }
  db.prepare(
    `UPDATE user_provider_service_config SET ${sets.join(', ')} WHERE user_id = @user_id`,
  ).run(params);
}

export function insertEventIfNew(
  db: Database.Database, userId: number, ev: RemoteEvent,
): boolean {
  const info = db.prepare(`
    INSERT OR IGNORE INTO provider_service_events
      (user_id, remote_event_id, remote_created_at, provider_id, model,
       input_tokens, output_tokens, cost_usd, origin_app, status, error_message, ingested_at)
    VALUES
      (@user_id, @remote_event_id, @remote_created_at, @provider_id, @model,
       @input_tokens, @output_tokens, @cost_usd, @origin_app, @status, @error_message, @ingested_at)
  `).run({
    user_id: userId,
    remote_event_id: ev.remote_event_id,
    remote_created_at: ev.remote_created_at,
    provider_id: ev.provider_id,
    model: ev.model,
    input_tokens: ev.input_tokens,
    output_tokens: ev.output_tokens,
    cost_usd: ev.cost_usd,
    origin_app: ev.origin_app,
    status: ev.status,
    error_message: ev.error_message,
    ingested_at: new Date().toISOString(),
  });
  return info.changes > 0;
}

function periodSinceISO(period: 'day' | 'week' | 'month'): string {
  const d = new Date();
  if (period === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - (dow - 1));
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

export function getLocalUsageSummary(
  db: Database.Database, userId: number, period: 'day' | 'week' | 'month',
): LocalUsageSummary {
  const since = periodSinceISO(period);

  const agg = db.prepare(`
    SELECT
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens
    FROM provider_service_events
    WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
  `).get(userId, since) as { calls: number; inputTokens: number; outputTokens: number };

  const topModels = db.prepare(`
    SELECT model, COUNT(*) AS calls
    FROM provider_service_events
    WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
    GROUP BY model
    ORDER BY calls DESC
    LIMIT 3
  `).all(userId, since) as Array<{ model: string; calls: number }>;

  const totalTokens = agg.inputTokens + agg.outputTokens;
  const avgTokensPerCall = agg.calls > 0 ? Math.round(totalTokens / agg.calls) : 0;

  return {
    period,
    calls: agg.calls,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    totalTokens,
    avgTokensPerCall,
    topModels,
  };
}
```

- [ ] **Step 9.4: Run tests**

```
npm test -- localUsageRepo
```

Expected: 5 passed.

- [ ] **Step 9.5: Commit**

```
git add backend/src/data/localUsageRepo.ts \
        backend/src/__tests__/unit/localUsageRepo.test.ts
git commit -m "feat(repo): add localUsageRepo for config and event queries"
```

---

### Task 10: `providerServiceSyncService.ts` — Poll loop

**Files:**
- Create: `backend/src/services/providerServiceSyncService.ts`
- Create: `backend/src/__tests__/unit/providerServiceSyncService.test.ts`

- [ ] **Step 10.1: Write the failing test**

Create `backend/src/__tests__/unit/providerServiceSyncService.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import Database from 'better-sqlite3';
import { syncProviderServiceEvents } from '../../services/providerServiceSyncService.js';
import {
  upsertProviderServiceConfig,
  insertEventIfNew,
  getProviderServiceConfig,
} from '../../data/localUsageRepo.js';
import { encryptSecret } from '../../utils/secretCrypto.js';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

let db: Database.Database;
let fetchMock: jest.Mock;

function makeEvent(id: number, ts: string) {
  return {
    id, created_at: ts, user_id: 'pu',
    provider_id: 'ollama', model: 'llama3.1:8b',
    input_tokens: 100, output_tokens: 50, cost_usd: 0,
    origin_app: null, status: 'success', error_message: null,
  };
}

beforeEach(() => {
  process.env.SECRETS_KEY = TEST_KEY;
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE user_provider_service_config (
      user_id INTEGER PRIMARY KEY, service_url TEXT NOT NULL,
      service_token_enc TEXT NOT NULL, provider_user_id TEXT NOT NULL,
      last_sync_at TEXT, last_sync_cursor TEXT, last_sync_error TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE provider_service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, remote_event_id INTEGER NOT NULL,
      remote_created_at TEXT NOT NULL, provider_id TEXT NOT NULL,
      model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      cost_usd REAL, origin_app TEXT, status TEXT NOT NULL,
      error_message TEXT, ingested_at TEXT NOT NULL,
      UNIQUE (user_id, remote_event_id)
    );
  `);
  db.prepare('INSERT INTO users(id, email) VALUES (1, ?)').run('a@b.c');
  upsertProviderServiceConfig(db, 1, {
    service_url: 'http://test-service:8767',
    service_token_enc: encryptSecret('test-token'),
    provider_user_id: 'pu',
    enabled: 1,
  });
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

afterEach(() => { db.close(); jest.resetAllMocks(); });

describe('syncProviderServiceEvents', () => {
  it('pulls events in a single page and inserts them', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [makeEvent(1, '2026-05-01T12:00:00')],
        count: 1, next_since: '2026-05-01T12:00:00', has_more: false,
      }),
    });
    const result = await syncProviderServiceEvents(db, 1);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(1);
    const cfg = getProviderServiceConfig(db, 1);
    expect(cfg?.last_sync_cursor).toBe('2026-05-01T12:00:00');
    expect(cfg?.last_sync_error).toBeNull();
  });

  it('paginates while has_more is true', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [makeEvent(1, '2026-05-01T12:00:00'), makeEvent(2, '2026-05-01T12:01:00')],
          count: 2, next_since: '2026-05-01T12:01:00', has_more: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [makeEvent(3, '2026-05-01T12:02:00')],
          count: 1, next_since: '2026-05-01T12:02:00', has_more: false,
        }),
      });
    const result = await syncProviderServiceEvents(db, 1);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — re-sync with same events inserts zero new', async () => {
    insertEventIfNew(db, 1, {
      remote_event_id: 1, remote_created_at: '2026-05-01T12:00:00',
      provider_id: 'ollama', model: 'm', input_tokens: 1, output_tokens: 1,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [makeEvent(1, '2026-05-01T12:00:00')],
        count: 1, next_since: '2026-05-01T12:00:00', has_more: false,
      }),
    });
    const result = await syncProviderServiceEvents(db, 1);
    expect(result.newEvents).toBe(0);
  });

  it('records last_sync_error on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const result = await syncProviderServiceEvents(db, 1);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
    const cfg = getProviderServiceConfig(db, 1);
    expect(cfg?.last_sync_error).toMatch(/401/);
  });

  it('returns ok with 0 events when disabled', async () => {
    db.prepare('UPDATE user_provider_service_config SET enabled = 0 WHERE user_id = 1').run();
    const result = await syncProviderServiceEvents(db, 1);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends bearer token and user_id in request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, next_since: null, has_more: false }),
    });
    await syncProviderServiceEvents(db, 1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/usage/events');
    expect(String(url)).toContain('user_id=pu');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });
});
```

- [ ] **Step 10.2: Run to verify fail**

```
npm test -- providerServiceSyncService
```

Expected: FAIL.

- [ ] **Step 10.3: Implement the service**

Create `backend/src/services/providerServiceSyncService.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import type Database from 'better-sqlite3';
import {
  getProviderServiceConfig,
  insertEventIfNew,
  updateSyncStatus,
  type RemoteEvent,
} from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

export interface SyncResult {
  ok: boolean;
  newEvents: number;
  error?: string;
}

interface RemotePage {
  events: Array<{
    id: number;
    created_at: string;
    provider_id: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    origin_app: string | null;
    status: string;
    error_message: string | null;
  }>;
  count: number;
  next_since: string | null;
  has_more: boolean;
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 50;

export async function syncProviderServiceEvents(
  db: Database.Database,
  userId: number,
): Promise<SyncResult> {
  const cfg = getProviderServiceConfig(db, userId);
  if (!cfg || cfg.enabled !== 1) {
    return { ok: true, newEvents: 0 };
  }

  let token: string;
  try {
    token = decryptSecret(cfg.service_token_enc);
  } catch (e) {
    const msg = `decrypt failed: ${(e as Error).message}`;
    updateSyncStatus(db, userId, { last_sync_error: msg });
    return { ok: false, newEvents: 0, error: msg };
  }

  let cursor: string | null = cfg.last_sync_cursor;
  let totalNew = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('/usage/events', cfg.service_url);
      url.searchParams.set('user_id', cfg.provider_user_id);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('since', cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RemotePage;

      for (const ev of data.events) {
        const row: RemoteEvent = {
          remote_event_id: ev.id,
          remote_created_at: ev.created_at,
          provider_id: ev.provider_id,
          model: ev.model,
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cost_usd: ev.cost_usd,
          origin_app: ev.origin_app,
          status: ev.status,
          error_message: ev.error_message,
        };
        if (insertEventIfNew(db, userId, row)) totalNew++;
      }

      cursor = data.next_since ?? cursor;
      if (!data.has_more) break;
    }

    updateSyncStatus(db, userId, {
      last_sync_at: new Date().toISOString(),
      last_sync_cursor: cursor,
      last_sync_error: null,
    });
    return { ok: true, newEvents: totalNew };
  } catch (e) {
    const msg = (e as Error).message;
    updateSyncStatus(db, userId, { last_sync_error: msg });
    return { ok: false, newEvents: totalNew, error: msg };
  }
}
```

- [ ] **Step 10.4: Run tests**

```
npm test -- providerServiceSyncService
```

Expected: 6 passed.

- [ ] **Step 10.5: Commit**

```
git add backend/src/services/providerServiceSyncService.ts \
        backend/src/__tests__/unit/providerServiceSyncService.test.ts
git commit -m "feat(sync): add provider-service pull-sync with pagination"
```

---

### Task 11: Controller + Routes

**Files:**
- Create: `backend/src/controllers/localUsageController.ts`
- Create: `backend/src/routes/localUsage.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 11.1: Read existing patterns**

Open `backend/src/controllers/pricingController.ts` and `backend/src/routes/pricing.ts` (or `account*`) to see:
- How `getDb()` is imported (probably `from '../database/sqlite.js'`)
- How the session-authenticated `userId` is read off `req` — adjust the helper below.
- The standard error-response shape.

- [ ] **Step 11.2: Implement the controller**

Create `backend/src/controllers/localUsageController.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import type { Request, Response } from 'express';
import { getDb } from '../database/sqlite.js';
import {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  getLocalUsageSummary,
} from '../data/localUsageRepo.js';
import { encryptSecret } from '../utils/secretCrypto.js';
import { syncProviderServiceEvents } from '../services/providerServiceSyncService.js';

// Adjust this to match the existing session-extraction pattern. Read an
// existing controller (accountController) to confirm.
function requireUserId(req: Request, res: Response): number | null {
  const userId = (req as any).session?.userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: 'unauthenticated' });
    return null;
  }
  return userId;
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const period = (req.query.period as string) ?? 'month';
  if (period !== 'day' && period !== 'week' && period !== 'month') {
    res.status(400).json({ error: 'invalid period' });
    return;
  }
  const summary = getLocalUsageSummary(getDb(), userId, period);
  res.json(summary);
}

export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const cfg = getProviderServiceConfig(getDb(), userId);
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  res.json({
    configured: true,
    enabled: cfg.enabled === 1,
    last_sync_at: cfg.last_sync_at,
    last_sync_error: cfg.last_sync_error,
  });
}

export async function triggerSync(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const result = await syncProviderServiceEvents(getDb(), userId);
  res.json(result);
}

export async function getConfig(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const cfg = getProviderServiceConfig(getDb(), userId);
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  res.json({
    configured: true,
    service_url: cfg.service_url,
    service_token_set: true,
    provider_user_id: cfg.provider_user_id,
    enabled: cfg.enabled === 1,
    last_sync_at: cfg.last_sync_at,
    last_sync_error: cfg.last_sync_error,
  });
}

export async function putConfig(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { service_url, service_token, provider_user_id, enabled } = req.body ?? {};
  if (typeof service_url !== 'string' || !service_url.trim()) {
    res.status(400).json({ error: 'service_url required' });
    return;
  }
  if (typeof provider_user_id !== 'string' || !provider_user_id.trim()) {
    res.status(400).json({ error: 'provider_user_id required' });
    return;
  }
  const existing = getProviderServiceConfig(getDb(), userId);
  let tokenEnc: string;
  if (typeof service_token === 'string' && service_token.length > 0) {
    tokenEnc = encryptSecret(service_token);
  } else if (existing) {
    tokenEnc = existing.service_token_enc;
  } else {
    res.status(400).json({ error: 'service_token required on first save' });
    return;
  }
  upsertProviderServiceConfig(getDb(), userId, {
    service_url: service_url.trim(),
    service_token_enc: tokenEnc,
    provider_user_id: provider_user_id.trim(),
    enabled: enabled === false ? 0 : 1,
  });
  res.json({ ok: true });
}
```

- [ ] **Step 11.3: Implement the router**

Create `backend/src/routes/localUsage.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import { Router } from 'express';
import {
  getSummary, getSyncStatus, triggerSync, getConfig, putConfig,
} from '../controllers/localUsageController.js';

const router = Router();
router.get('/summary', getSummary);
router.get('/sync-status', getSyncStatus);
router.post('/sync', triggerSync);
router.get('/config', getConfig);
router.put('/config', putConfig);
export default router;
```

- [ ] **Step 11.4: Mount in `app.ts`**

Open `backend/src/app.ts`, find the other `app.use('/api/...', someRouter)` calls, and add:

```typescript
import localUsageRouter from './routes/localUsage.js';
// ...
app.use('/api/local-usage', localUsageRouter);
```

Place this after the auth middleware (so the session is already populated).

- [ ] **Step 11.5: Run all backend tests**

```
npm test
```

Expected: all pass. The controller is not unit-tested directly here — Task 17 manual smoke covers it end-to-end.

- [ ] **Step 11.6: Commit**

```
git add backend/src/controllers/localUsageController.ts \
        backend/src/routes/localUsage.ts \
        backend/src/app.ts
git commit -m "feat(api): add /api/local-usage routes for tracker frontend"
```

---

### Task 12: Cron hook in `server.ts`

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 12.1: Read existing scheduled tasks**

Open `backend/src/server.ts` and find the existing `setInterval` calls (e.g. for `pricingService`). Match the style.

- [ ] **Step 12.2: Add the cron hook**

After the existing schedulers, add:

```typescript
import { syncProviderServiceEvents } from './services/providerServiceSyncService.js';
import { listUsersWithProviderServiceConfig } from './data/localUsageRepo.js';
import { getDb } from './database/sqlite.js';

const PROVIDER_SYNC_INTERVAL_MS = 15 * 60 * 1000;

async function runProviderServiceSyncTick(): Promise<void> {
  const users = listUsersWithProviderServiceConfig(getDb());
  for (const u of users) {
    try {
      const r = await syncProviderServiceEvents(getDb(), u.user_id);
      if (r.newEvents > 0) {
        console.log(`[provider-service-sync] user=${u.user_id} new=${r.newEvents}`);
      }
      if (!r.ok) {
        console.warn(`[provider-service-sync] user=${u.user_id} error=${r.error}`);
      }
    } catch (err) {
      console.error('[provider-service-sync] unexpected', u.user_id, err);
    }
  }
}

void runProviderServiceSyncTick();
setInterval(runProviderServiceSyncTick, PROVIDER_SYNC_INTERVAL_MS);
```

If the existing code uses a different scheduling mechanism (e.g. a class-based scheduler), integrate the same way.

- [ ] **Step 12.3: Manual smoke**

Start the backend:

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") npm run dev
```

Expected: backend starts cleanly, log shows initial `[provider-service-sync]` tick. With no configured users, no errors.

- [ ] **Step 12.4: Commit**

```
git add backend/src/server.ts
git commit -m "feat(cron): poll provider-service every 15 min for usage events"
```

---

## Phase 3 — Tracker Frontend

### Task 13: `localUsageApi.ts` — Typed client

**Files:**
- Create: `frontend/src/services/localUsageApi.ts`

- [ ] **Step 13.1: Read existing API client**

Open `frontend/src/services/api.ts` to see how fetch is wrapped — base URL, credentials, error handling.

- [ ] **Step 13.2: Create the file**

Create `frontend/src/services/localUsageApi.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModels: Array<{ model: string; calls: number }>;
}

export interface SyncStatus {
  configured: boolean;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
}

export interface ProviderServiceConfig {
  configured: boolean;
  service_url?: string;
  service_token_set?: boolean;
  provider_user_id?: string;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token?: string;
  provider_user_id: string;
  enabled: boolean;
}

export interface SyncTriggerResult {
  ok: boolean;
  newEvents: number;
  error?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const localUsageApi = {
  getSummary: (period: 'day' | 'week' | 'month' = 'month') =>
    api<LocalUsageSummary>(`/local-usage/summary?period=${period}`),
  getSyncStatus: () => api<SyncStatus>('/local-usage/sync-status'),
  triggerSync: () =>
    api<SyncTriggerResult>('/local-usage/sync', { method: 'POST' }),
  getConfig: () => api<ProviderServiceConfig>('/local-usage/config'),
  putConfig: (cfg: ProviderServiceConfigInput) =>
    api<{ ok: boolean }>('/local-usage/config', {
      method: 'PUT', body: JSON.stringify(cfg),
    }),
};
```

If `api.ts` exports a shared fetch helper, replace the local `api` function with that helper.

- [ ] **Step 13.3: Commit**

```
git add frontend/src/services/localUsageApi.ts
git commit -m "feat(frontend): typed API client for local-usage endpoints"
```

---

### Task 14: `LocalUsageCard.tsx` — Overview card

**Files:**
- Create: `frontend/src/components/LocalUsageCard.tsx`
- Create: `frontend/src/__tests__/components/LocalUsageCard.test.tsx`

- [ ] **Step 14.1: Look at an existing card for style**

Open `frontend/src/components/UsageSummary.tsx` to match Tailwind class patterns.

- [ ] **Step 14.2: Write the failing test**

Create `frontend/src/__tests__/components/LocalUsageCard.test.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LocalUsageCard from '../../components/LocalUsageCard';
import { localUsageApi } from '../../services/localUsageApi';

vi.mock('../../services/localUsageApi');

const mockedApi = localUsageApi as unknown as {
  getSummary: ReturnType<typeof vi.fn>;
  getSyncStatus: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('LocalUsageCard', () => {
  it('renders empty state when not configured', async () => {
    (mockedApi.getSummary as any) = vi.fn().mockResolvedValue({
      period: 'month', calls: 0, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, avgTokensPerCall: 0, topModels: [],
    });
    (mockedApi.getSyncStatus as any) = vi.fn().mockResolvedValue({ configured: false });
    render(<LocalUsageCard />);
    await waitFor(() => {
      expect(screen.getByText(/konfiguriere/i)).toBeInTheDocument();
    });
  });

  it('renders token totals, calls and top models', async () => {
    (mockedApi.getSummary as any) = vi.fn().mockResolvedValue({
      period: 'month',
      calls: 142,
      inputTokens: 612312,
      outputTokens: 235211,
      totalTokens: 847523,
      avgTokensPerCall: 5969,
      topModels: [
        { model: 'llama3.1:8b', calls: 124 },
        { model: 'qwen2.5-coder:7b', calls: 18 },
      ],
    });
    (mockedApi.getSyncStatus as any) = vi.fn().mockResolvedValue({
      configured: true, enabled: true,
      last_sync_at: '2026-05-17T10:00:00', last_sync_error: null,
    });
    render(<LocalUsageCard />);
    await waitFor(() => {
      expect(screen.getByText(/847.523/)).toBeInTheDocument();
      expect(screen.getByText(/142/)).toBeInTheDocument();
      expect(screen.getByText(/llama3\.1:8b/)).toBeInTheDocument();
    });
  });

  it('shows sync error banner', async () => {
    (mockedApi.getSummary as any) = vi.fn().mockResolvedValue({
      period: 'month', calls: 0, inputTokens: 0, outputTokens: 0,
      totalTokens: 0, avgTokensPerCall: 0, topModels: [],
    });
    (mockedApi.getSyncStatus as any) = vi.fn().mockResolvedValue({
      configured: true, enabled: true,
      last_sync_at: '2026-05-17T10:00:00',
      last_sync_error: 'HTTP 401',
    });
    render(<LocalUsageCard />);
    await waitFor(() => {
      expect(screen.getByText(/HTTP 401/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 14.3: Run to verify fail**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npm test -- LocalUsageCard
```

Expected: FAIL.

- [ ] **Step 14.4: Implement the component**

Create `frontend/src/components/LocalUsageCard.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import { useEffect, useState } from 'react';
import {
  localUsageApi,
  type LocalUsageSummary,
  type SyncStatus,
} from '../services/localUsageApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

export default function LocalUsageCard(): JSX.Element {
  const [summary, setSummary] = useState<LocalUsageSummary | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void Promise.all([
      localUsageApi.getSummary('month'),
      localUsageApi.getSyncStatus(),
    ]).then(([s, st]) => {
      setSummary(s);
      setStatus(st);
    }).catch(() => {
      // Silent: card shows empty state on fetch error.
    });
  }, []);

  if (!status) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-gray-400 text-sm">Lade Lokale LLM-Nutzung…</div>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">provider-service</span>
        </div>
        <p className="text-sm text-gray-600">
          Noch keine Daten — <a href="/settings" className="text-blue-600 underline">
          konfiguriere den AI-Provider-Service in den Einstellungen</a>.
        </p>
      </div>
    );
  }

  const s = summary;
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
            provider-service
          </span>
        </div>
      </div>

      {status.last_sync_error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs p-2 mb-3 rounded">
          Sync-Fehler: {status.last_sync_error}
        </div>
      )}

      {s && s.calls === 0 ? (
        <p className="text-sm text-gray-600">Noch keine Calls in diesem Monat.</p>
      ) : s ? (
        <>
          <div className="text-3xl font-bold mb-1">
            {formatNumber(s.totalTokens)} <span className="text-base font-normal">Tokens</span>
          </div>
          <div className="text-sm text-gray-600 mb-1">
            In: {formatNumber(s.inputTokens)} · Out: {formatNumber(s.outputTokens)}
          </div>
          <div className="text-sm text-gray-600 mb-3">
            {formatNumber(s.calls)} Calls · ⌀ {formatNumber(s.avgTokensPerCall)} Tok/Call
          </div>

          {s.topModels.length > 0 && (
            <ul className="text-xs text-gray-700 space-y-0.5">
              {s.topModels.map((m) => (
                <li key={m.model}>
                  <span className="font-mono">{m.model}</span> · {formatNumber(m.calls)} Calls
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 14.5: Run tests**

```
npm test -- LocalUsageCard
```

Expected: 3 passed.

- [ ] **Step 14.6: Commit**

```
git add frontend/src/components/LocalUsageCard.tsx \
        frontend/src/__tests__/components/LocalUsageCard.test.tsx
git commit -m "feat(frontend): add LocalUsageCard for overview tab"
```

---

### Task 15: `ProviderServiceSettings.tsx` — Settings section

**Files:**
- Create: `frontend/src/components/settings/ProviderServiceSettings.tsx`

- [ ] **Step 15.1: Look at existing settings sections**

Open files inside `frontend/src/components/settings/` to match form layout and save-button styling.

- [ ] **Step 15.2: Implement the component**

Create `frontend/src/components/settings/ProviderServiceSettings.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// (c) 2026 Harald Weiss
import { useEffect, useState } from 'react';
import {
  localUsageApi,
  type ProviderServiceConfig,
  type SyncTriggerResult,
} from '../../services/localUsageApi';

export default function ProviderServiceSettings(): JSX.Element {
  const [cfg, setCfg] = useState<ProviderServiceConfig | null>(null);
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceToken, setServiceToken] = useState('');
  const [providerUserId, setProviderUserId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void localUsageApi.getConfig().then((c) => {
      setCfg(c);
      if (c.configured) {
        setServiceUrl(c.service_url ?? '');
        setProviderUserId(c.provider_user_id ?? '');
        setEnabled(c.enabled ?? true);
      }
    });
  }, []);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setFeedback(null);
    try {
      await localUsageApi.putConfig({
        service_url: serviceUrl.trim(),
        service_token: serviceToken || undefined,
        provider_user_id: providerUserId.trim(),
        enabled,
      });
      setServiceToken('');
      const refreshed = await localUsageApi.getConfig();
      setCfg(refreshed);
      setFeedback('Gespeichert.');
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setFeedback(null);
    try {
      const r: SyncTriggerResult = await localUsageApi.triggerSync();
      if (r.ok) {
        setFeedback(`Verbindung ok — ${r.newEvents} neue Events erhalten.`);
      } else {
        setFeedback(`Fehler: ${r.error ?? 'unbekannt'}`);
      }
      const refreshed = await localUsageApi.getConfig();
      setCfg(refreshed);
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="bg-white rounded-lg shadow p-4 mb-4">
      <h2 className="text-lg font-semibold mb-3">AI-Provider-Service</h2>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Service-URL</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="https://bewerbungen.wolfinisoftware.de/ai-provider"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Service-Token {cfg?.service_token_set ? '(gesetzt — leer lassen zum Beibehalten)' : ''}
          </label>
          <input
            type="password"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceToken}
            onChange={(e) => setServiceToken(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Meine user_id im Provider-Service</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={providerUserId}
            onChange={(e) => setProviderUserId(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Aktiv
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !cfg?.configured}
            className="bg-gray-200 px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {testing ? 'Teste…' : 'Verbindung testen'}
          </button>
        </div>
        {feedback && <div className="text-sm text-gray-700">{feedback}</div>}
        {cfg?.configured && (
          <div className="text-xs text-gray-500 pt-2 border-t">
            Letzter Sync: {cfg.last_sync_at ?? '—'}
            {cfg.last_sync_error && (
              <div className="text-red-600">Fehler: {cfg.last_sync_error}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 15.3: Commit**

```
git add frontend/src/components/settings/ProviderServiceSettings.tsx
git commit -m "feat(frontend): add ProviderServiceSettings section"
```

---

### Task 16: Wire the new components into Overview + Settings

**Files:**
- Modify: `frontend/src/components/OverviewTab.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

- [ ] **Step 16.1: Add card to OverviewTab**

Open `frontend/src/components/OverviewTab.tsx`. Find the cards grid and add:

```typescript
import LocalUsageCard from './LocalUsageCard';
// ...
<LocalUsageCard />
```

If a `SyncStatusFooter` exists with badges for `claude.ai`/`console`/`code`, adding a fourth badge for `provider-service` is also expected — but if that grows scope, leave it as follow-up and rely on the card's own error banner.

- [ ] **Step 16.2: Add settings section**

Open `frontend/src/pages/Settings.tsx`. Find the existing settings sections and add:

```typescript
import ProviderServiceSettings from '../components/settings/ProviderServiceSettings';
// ...
<ProviderServiceSettings />
```

- [ ] **Step 16.3: Visual check**

Start both services and verify in the browser:

```
# Terminal 1
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") npm run dev

# Terminal 2
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npm run dev
```

Open `http://localhost:5173`, log in, verify:
- Overview tab shows the empty-state card "Noch keine Daten — konfiguriere…"
- Settings page shows the "AI-Provider-Service" section
- Saving valid config → "Gespeichert." feedback
- "Verbindung testen" button works

- [ ] **Step 16.4: Commit**

```
git add frontend/src/components/OverviewTab.tsx frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): mount LocalUsageCard and ProviderServiceSettings"
```

---

### Task 17: End-to-end smoke test

- [ ] **Step 17.1: Start the provider-service**

```
cd /Users/haraldweiss/projects/ai-provider-service
. venv/bin/activate
python3 app.py
```

- [ ] **Step 17.2: Trigger a real call**

```
SERVICE_TOKEN=$(grep ^SERVICE_TOKEN .env | cut -d= -f2)
curl -X POST http://127.0.0.1:8767/chat \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Origin-App: smoke-test" \
  -d '{
    "user_id": "test-user",
    "provider": "ollama",
    "model": "llama3.1:8b",
    "messages": [{"role":"user","content":"hi"}]
  }'
```

If Ollama is not running, substitute another working provider/model.

- [ ] **Step 17.3: Configure the tracker**

In the tracker UI Settings, fill in:
- Service-URL: `http://127.0.0.1:8767`
- Service-Token: the `SERVICE_TOKEN` value
- user_id: `test-user`
- Enabled: yes

Click **Speichern**, then **Verbindung testen**.

Expected: `"Verbindung ok — 1 neue Events erhalten."`

- [ ] **Step 17.4: Verify the dashboard**

Refresh Overview tab. The "Lokale LLM-Nutzung" card should show:
- Total tokens
- In/Out split
- 1 Call · ⌀ N Tok/Call
- Top-model: `llama3.1:8b · 1 Call`

- [ ] **Step 17.5: Verify cron**

Trigger another call via `curl` (without re-clicking the test button). Restart the backend to fire the startup tick, refresh the card.

- [ ] **Step 17.6: Verify error path**

Change the token to a wrong value, save, click **Verbindung testen**. Expected: red banner with "HTTP 401" or similar. Restore the correct token.

---

## Final Checks

- [ ] All Phase 1 tests pass: `cd /Users/haraldweiss/projects/ai-provider-service && pytest tests/ -v`
- [ ] All Phase 2 tests pass: `cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend" && npm test`
- [ ] All Phase 3 tests pass: `cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend" && npm test`
- [ ] Manual smoke test (Task 17) green end-to-end
- [ ] No regression in pre-existing tests in either codebase
- [ ] `SECRETS_KEY` documented in `.env.example`
