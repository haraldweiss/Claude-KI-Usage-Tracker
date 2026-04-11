# Global Error Handler - Testing Guide

## Implementation Complete

The global error handler has been successfully implemented in the Express backend.

### Files Created/Modified

1. **Created**: `/backend/src/middleware/errorHandler.js`
   - Middleware function with 4 parameters: (err, req, res, next)
   - Logs error message and stack trace
   - Returns JSON response with status code and error message
   - Includes timestamp in response

2. **Modified**: `/backend/src/server.js`
   - Imported errorHandler middleware
   - Added `app.use(errorHandler)` AFTER all routes (line 39)
   - Added uncaughtException handler
   - Added unhandledRejection handler

## Testing the Error Handler

### Manual Test 1: Synchronous Error (Thrown Exception)

Add a test route to `backend/src/routes/usage.js`:

```javascript
app.get('/test/error', (req, res, next) => {
  throw new Error('Test error from route');
});
```

Then run:
```bash
cd backend && npm run dev
```

Make request:
```bash
curl http://localhost:3000/api/usage/test/error
```

Expected response:
```json
{
  "error": "Test error from route",
  "status": 500,
  "timestamp": "2026-04-11T10:30:00.000Z"
}
```

Server should NOT crash - it should continue running.

### Manual Test 2: Async Error (with try/catch)

Add test route with try/catch:

```javascript
app.get('/test/async-error', async (req, res, next) => {
  try {
    throw new Error('Async test error');
  } catch (error) {
    next(error);
  }
});
```

Make request:
```bash
curl http://localhost:3000/api/usage/test/async-error
```

Expected: Same error response as Test 1

### Manual Test 3: Custom Status Code

Throw error with custom status:

```javascript
app.get('/test/custom-error', (req, res, next) => {
  const error = new Error('Custom error');
  error.status = 400;
  throw error;
});
```

Expected response (status 400):
```json
{
  "error": "Custom error",
  "status": 400,
  "timestamp": "2026-04-11T10:30:00.000Z"
}
```

### Manual Test 4: Verify Server Stays Running

1. Make 10 requests that throw errors
2. Make a successful request to /health
3. Verify it returns `{ "status": "ok" }` - server is still running

```bash
for i in {1..10}; do
  curl http://localhost:3000/api/usage/test/error 2>/dev/null
done
curl http://localhost:3000/health
```

## Error Handler Behavior

### What It Catches
- Synchronous errors thrown in route handlers
- Errors passed to `next(error)` in async handlers
- Any Express error that occurs

### What It Does NOT Catch (Require try/catch)
- Unhandled promise rejections in async handlers
- Errors in callbacks that don't use next()

### Console Output
When error occurs:
```
Error: Test error from route
Stack: Error: Test error from route
    at /backend/src/routes/usage.js:XX:YY
    ...
```

## Process-Level Error Handling

### Uncaught Exceptions
- Logged with message and stack
- Process exits with code 1
- Allows process manager (PM2, systemd) to restart it

### Unhandled Rejections
- Logged but process continues
- Non-critical failures don't crash the server
- Should still be investigated and fixed

## Verification Checklist

- [x] errorHandler middleware created with correct signature
- [x] Imported in server.js
- [x] Registered as LAST middleware (after all routes)
- [x] Logs errors to console
- [x] Returns JSON with error, status, timestamp
- [x] Process-level handlers added
- [x] Server continues running after errors

## Architecture Notes

The error handler works with this flow:

1. Request comes in
2. Middleware/routes process it
3. If error thrown/passed to next():
   - Error bubbles to errorHandler
   - Handler logs the error
   - Sends JSON response to client
   - Server continues running
4. If uncaught exception:
   - Process handler catches it
   - Logs it
   - Exits (for restart by process manager)

## Next Steps

For production, consider:
1. Integrate Winston or Pino logger (not just console.error)
2. Add error tracking service (Sentry, Datadog, etc.)
3. Implement structured error types (ValidationError, NotFoundError, etc.)
4. Add error rate limiting/circuit breaker
5. Separate logging for different error types (DB errors, auth errors, etc.)
