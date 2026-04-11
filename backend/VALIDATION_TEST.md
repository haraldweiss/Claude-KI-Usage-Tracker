# API Input Validation Tests

## Überblick
Die `express-validator` Middleware wurde für alle API-Endpunkte integriert. Diese Tests zeigen, wie die Validierung funktioniert.

## Test-Befehle (cURL)

### 1. POST /api/usage/track - Valid Request ✅

```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 2000,
    "conversation_id": "conv-123",
    "source": "claude_ai",
    "task_description": "Write a blog post",
    "success_status": "success"
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": true,
  "id": 123,
  "cost": "0.0450"
}
```

---

### 2. POST /api/usage/track - Missing Required Fields ❌

```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": ""
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "model",
      "message": "model is required",
      "value": ""
    },
    {
      "field": "input_tokens",
      "message": "input_tokens must be a non-negative integer",
      "value": undefined
    },
    {
      "field": "output_tokens",
      "message": "output_tokens must be a non-negative integer",
      "value": undefined
    }
  ]
}
```

---

### 3. POST /api/usage/track - Invalid Token Type ❌

```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": "abc",
    "output_tokens": 2000
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "input_tokens",
      "message": "input_tokens must be a non-negative integer",
      "value": "abc"
    }
  ]
}
```

---

### 4. POST /api/usage/track - XSS Prevention ✅

```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 2000,
    "conversation_id": "<script>alert(\"xss\")</script>",
    "task_description": "<img src=x onerror=alert(\"xss\")>"
  }'
```

**Erwartetes Ergebnis:**
Der Wert wird escaped und gespeichert als:
```
conversation_id: "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
task_description: "&lt;img src=x onerror=alert(&quot;xss&quot;)&gt;"
```

---

### 5. POST /api/usage/track - Invalid JSON Metadata ❌

```bash
curl -X POST http://localhost:3000/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude 3.5 Sonnet",
    "input_tokens": 1000,
    "output_tokens": 2000,
    "response_metadata": "{invalid json"
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "response_metadata",
      "message": "response_metadata must be valid JSON if provided as string",
      "value": "{invalid json"
    }
  ]
}
```

---

### 6. PUT /api/pricing/:model - Valid Request ✅

```bash
curl -X PUT http://localhost:3000/api/pricing/Claude%203.5%20Sonnet \
  -H "Content-Type: application/json" \
  -d '{
    "input_price": 3.5,
    "output_price": 16.5
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": true,
  "message": "Pricing updated successfully"
}
```

---

### 7. PUT /api/pricing/:model - Invalid Price Values ❌

```bash
curl -X PUT http://localhost:3000/api/pricing/Claude%203.5%20Sonnet \
  -H "Content-Type: application/json" \
  -d '{
    "input_price": -5,
    "output_price": "not_a_number"
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "input_price",
      "message": "input_price must be a number between 0 and 10000",
      "value": -5
    },
    {
      "field": "output_price",
      "message": "output_price must be a number between 0 and 10000",
      "value": "not_a_number"
    }
  ]
}
```

---

### 8. POST /api/recommend - Valid Request ✅

```bash
curl -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "taskDescription": "Write a simple hello world program in Python",
    "constraints": {
      "maxCost": 0.10,
      "minSafety": 70,
      "preferredModels": ["Claude 3.5 Haiku"]
    }
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": true,
  "recommendation": {
    "recommended": "Claude 3.5 Haiku",
    "confidence": 0.95,
    ...
  },
  "timestamp": "2026-04-11T10:30:00Z"
}
```

---

### 9. POST /api/recommend - Task Too Short ❌

```bash
curl -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "taskDescription": "hi"
  }'
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "taskDescription",
      "message": "taskDescription must be between 3 and 2000 characters",
      "value": "hi"
    }
  ]
}
```

---

### 10. GET /api/usage/summary - Valid Query ✅

```bash
curl "http://localhost:3000/api/usage/summary?period=week"
```

**Erwartetes Ergebnis:**
```json
{
  "period": "week",
  "request_count": 150,
  "total_input_tokens": 45000,
  "total_output_tokens": 75000,
  "total_tokens": 120000,
  "total_cost": 2.25
}
```

---

### 11. GET /api/usage/summary - Invalid Period ❌

```bash
curl "http://localhost:3000/api/usage/summary?period=invalid_period"
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "period",
      "message": "period must be one of: day, week, month",
      "value": "invalid_period"
    }
  ]
}
```

---

### 12. GET /api/usage/history - Valid Query ✅

```bash
curl "http://localhost:3000/api/usage/history?limit=25&offset=0"
```

**Erwartetes Ergebnis:**
```json
{
  "records": [
    {
      "id": 1,
      "model": "Claude 3.5 Sonnet",
      "input_tokens": 1000,
      "output_tokens": 2000,
      "total_tokens": 3000,
      "cost": 0.045,
      "timestamp": "2026-04-11T10:30:00Z",
      "conversation_id": "conv-123"
    }
  ],
  "limit": 25,
  "offset": 0
}
```

---

### 13. GET /api/usage/history - Invalid Limit ❌

```bash
curl "http://localhost:3000/api/usage/history?limit=1000"
```

**Erwartetes Ergebnis:**
```json
{
  "success": false,
  "errors": [
    {
      "field": "limit",
      "message": "limit must be an integer between 1 and 500",
      "value": "1000"
    }
  ]
}
```

---

## Sicherheitsfeatures

### XSS-Protection
- `escape()` wird auf alle String-Inputs angewendet
- HTML-Zeichen werden in Entity-Referenzen konvertiert
- `<script>` wird zu `&lt;script&gt;`

### SQL-Injection-Protection
- `express-validator` führt keine SQL-Queries direkt aus
- Alle SQL-Queries verwenden parameterized queries (sqlite3 driver)
- Die Validator beschreibt die erwarteten Datentypen

### Input-Längenbeschränkung
- model: max 100 Zeichen
- conversation_id: max 500 Zeichen
- task_description: max 1000 Zeichen
- taskDescription (recommender): max 2000 Zeichen

### Datentyp-Validierung
- input_tokens, output_tokens: non-negative integers
- input_price, output_price: floats zwischen 0 und 10000
- limit: integer zwischen 1 und 500
- period: nur "day", "week", "month"
- success_status: nur "unknown", "success", "error"

---

## Installation & Verwendung

Stelle sicher, dass `express-validator` installiert ist:

```bash
cd backend
npm install express-validator
```

Starten Sie den Server:

```bash
npm run dev
```

Führen Sie dann die Tests oben aus.

---

## Fehlermeldungen-Format

Alle Validierungsfehler folgen diesem Format:

```json
{
  "success": false,
  "errors": [
    {
      "field": "fieldname",
      "message": "error description",
      "value": "received_value"
    }
  ]
}
```

Status-Code: **400 Bad Request**
