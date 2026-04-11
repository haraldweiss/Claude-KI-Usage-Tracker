# Input-Validierung - Quick Reference

## Alle Validatoren auf einen Blick

### 1. POST /api/usage/track

**Validator:** `trackUsageValidator`

| Parameter | Typ | Erforderlich | Min | Max | Zusätzliches |
|-----------|-----|--------------|-----|-----|--------------|
| model | String | ✅ | 1 | 100 | escaped |
| input_tokens | Integer | ✅ | 0 | - | min: 0 |
| output_tokens | Integer | ✅ | 0 | - | min: 0 |
| conversation_id | String | ❌ | - | 500 | escaped |
| source | String | ❌ | - | 50 | escaped |
| task_description | String | ❌ | - | 1000 | escaped |
| success_status | String | ❌ | - | - | whitelist: unknown/success/error |
| response_metadata | JSON | ❌ | - | - | valid JSON if string |

**Beispiel Request:**
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 2000,
    "conversation_id": "conv-abc123",
    "task_description": "Write documentation",
    "success_status": "success"
  }'
```

---

### 2. GET /api/usage/summary

**Validator:** `getSummaryValidator`

| Parameter | Typ | Erforderlich | Whitelist | Standardwert |
|-----------|-----|--------------|-----------|--------------|
| period | String | ❌ | day / week / month | day |

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/usage/summary?period=week"
```

---

### 3. GET /api/usage/models

**Validator:** Keine (alle Requests erlaubt)

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/usage/models"
```

---

### 4. GET /api/usage/history

**Validator:** `getHistoryValidator`

| Parameter | Typ | Erforderlich | Min | Max | Standardwert |
|-----------|-----|--------------|-----|-----|--------------|
| limit | Integer | ❌ | 1 | 500 | 50 |
| offset | Integer | ❌ | 0 | - | 0 |

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/usage/history?limit=25&offset=0"
```

---

### 5. PUT /api/pricing/:model

**Validator:** `updatePricingValidator`

| Parameter | Typ | Erforderlich | Min | Max | Zusätzliches |
|-----------|-----|--------------|-----|-----|--------------|
| model (URL) | String | ✅ | 1 | 100 | escaped |
| input_price | Float | ✅ | 0 | 10000 | - |
| output_price | Float | ✅ | 0 | 10000 | - |

**Beispiel Request:**
```bash
curl -X PUT "http://localhost:3000/api/pricing/Claude%203.5%20Sonnet" \
  -H "Content-Type: application/json" \
  -d '{
    "input_price": 3.5,
    "output_price": 16.5
  }'
```

---

### 6. GET /api/pricing

**Validator:** Keine (alle Requests erlaubt)

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/pricing"
```

---

### 7. POST /api/recommend

**Validator:** `recommendValidator`

| Parameter | Typ | Erforderlich | Min | Max | Zusätzliches |
|-----------|-----|--------------|-----|-----|--------------|
| taskDescription | String | ✅ | 3 | 2000 | escaped |
| constraints | Object | ❌ | - | - | optional |
| constraints.maxCost | Float | ❌ | 0 | - | optional |
| constraints.minSafety | Float | ❌ | 0 | 100 | optional |
| constraints.preferredModels | Array | ❌ | - | - | array of strings |
| constraints.avoidModels | Array | ❌ | - | - | array of strings |

**Beispiel Request:**
```bash
curl -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "taskDescription": "Write a complex algorithm in Python with full documentation",
    "constraints": {
      "maxCost": 0.50,
      "minSafety": 80,
      "preferredModels": ["Claude 3.5 Sonnet"],
      "avoidModels": ["Claude 3.5 Haiku"]
    }
  }'
```

---

### 8. GET /api/analysis/models

**Validator:** `getModelAnalysisValidator`

| Parameter | Typ | Erforderlich | Whitelist | Standardwert |
|-----------|-----|--------------|-----------|--------------|
| period | String | ❌ | day / week / month | month |

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/analysis/models?period=week"
```

---

### 9. GET /api/analysis/opportunities

**Validator:** `getOptimizationOpportunitiesValidator`

| Parameter | Typ | Erforderlich | Whitelist | Standardwert |
|-----------|-----|--------------|-----------|--------------|
| period | String | ❌ | day / week / month | week |

**Beispiel Request:**
```bash
curl "http://localhost:3000/api/analysis/opportunities?period=month"
```

---

## Fehlerbehandlung

### Validierungsfehler (400 Bad Request)

**Format:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "input_tokens",
      "message": "input_tokens must be a non-negative integer",
      "value": "not_a_number"
    }
  ]
}
```

### Häufige Fehlermeldungen

| Fehler | Ursache | Lösung |
|--------|--------|--------|
| `must be a non-negative integer` | Wert ist keine Zahl oder negativ | Integer >= 0 verwenden |
| `must be between X and Y characters` | String zu kurz/lang | Länge anpassen |
| `must be one of: ...` | Ungültiger enum-Wert | Whitelist-Wert verwenden |
| `must be an object` | Array statt Object | {} statt [] verwenden |
| `must be a number between X and Y` | Float außerhalb Bereich | Zahl in Bereich anpassen |
| `must be valid JSON if provided as string` | Ungültiges JSON | JSON-Format prüfen |

---

## Sicherheitsmerkmale

### ✅ XSS-Protection
```javascript
All string inputs are escaped:
<script> → &lt;script&gt;
```

### ✅ SQL-Injection-Protection
```javascript
All queries use parameterized statements:
db.run('SELECT * FROM users WHERE id = ?', [id])
```

### ✅ Type-Validation
```javascript
Nur integer/float/string/array/object erlaubt
```

### ✅ Length-Validation
```javascript
Max length definiert pro Feld
Verhindert DoS-Attacken
```

### ✅ Enum-Validation
```javascript
period: nur 'day', 'week', 'month'
success_status: nur 'unknown', 'success', 'error'
```

---

## Integration in Clients

### JavaScript/Fetch Example

```javascript
// Valid Request
async function trackUsage() {
  const response = await fetch('/api/usage/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Claude 3.5 Sonnet',
      input_tokens: 1000,
      output_tokens: 2000
    })
  });

  const data = await response.json();
  
  if (!data.success) {
    // Handle validation errors
    data.errors.forEach(error => {
      console.error(`${error.field}: ${error.message}`);
    });
  } else {
    // Success
    console.log(`Cost: $${data.cost}`);
  }
}
```

### Python Example

```python
import requests

# Valid Request
response = requests.post(
    'http://localhost:3000/api/usage/track',
    json={
        'model': 'Claude 3.5 Sonnet',
        'input_tokens': 1000,
        'output_tokens': 2000
    }
)

data = response.json()

if not data.get('success'):
    # Handle validation errors
    for error in data.get('errors', []):
        print(f"{error['field']}: {error['message']}")
else:
    print(f"Cost: ${data['cost']}")
```

---

## Testing mit cURL

### Test 1: Valid Request
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model":"Sonnet","input_tokens":100,"output_tokens":200}'
```
✅ Status: 201

### Test 2: Missing Required Field
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model":"Sonnet"}'
```
❌ Status: 400, Fehler: input_tokens required

### Test 3: Invalid Type
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model":"Sonnet","input_tokens":"abc","output_tokens":200}'
```
❌ Status: 400, Fehler: must be integer

### Test 4: XSS Prevention
```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model":"<script>alert(1)</script>","input_tokens":100,"output_tokens":200}'
```
✅ Status: 201, Wert ist escaped

### Test 5: Invalid Enum
```bash
curl "http://localhost:3000/api/usage/summary?period=invalid"
```
❌ Status: 400, Fehler: period must be day/week/month

---

## Dateistruktur

```
backend/src/
├── middleware/
│   └── validators.js ← Alle Validatoren
├── routes/
│   ├── usage.js ← Nutzt trackUsageValidator, getSummaryValidator, getHistoryValidator
│   ├── pricing.js ← Nutzt updatePricingValidator
│   └── recommendation.js ← Nutzt recommendValidator, getModelAnalysisValidator, getOptimizationOpportunitiesValidator
├── controllers/
│   └── (keine Änderungen)
└── server.js
```

---

## Wartung

### Validierungen updaten

1. Öffne `src/middleware/validators.js`
2. Finde relevanten Validator-Set
3. Ändere Bedingungen

**Beispiel: maxCost max auf 1000 ändern**
```javascript
// vorher
body('constraints.maxCost')
  .optional()
  .isFloat({ min: 0 })

// nachher
body('constraints.maxCost')
  .optional()
  .isFloat({ min: 0, max: 1000 })
  .withMessage('constraints.maxCost must be between 0 and 1000')
```

### Neue Felder validieren

1. Importiere `{ body, query, param }` in validators.js
2. Erstelle neuen Validator
3. Importiere in Route
4. Verwende in Route-Definition

---

## Performance

- **Validierung Time:** < 1ms per Request
- **Memory Overhead:** Minimal (nur während Request)
- **Server Impact:** Negligible (Validierung ist sehr schnell)

---

## Kompatibilität

- ✅ Node 14+
- ✅ Express 4.18+
- ✅ Chrome/Firefox/Safari (für Frontend)
- ✅ Python requests
- ✅ JavaScript fetch
- ✅ cURL

---

## Support

Für Fragen siehe:
- `IMPLEMENTATION_SUMMARY.md` - Detaillierte Dokumentation
- `VALIDATION_TEST.md` - Praktische Test-Beispiele
- `validators.js` - Quellcode mit Kommentaren
