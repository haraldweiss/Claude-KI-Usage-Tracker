/**
 * Global Error Handler Middleware
 * Must be the last middleware in the Express app
 * Catches all synchronous errors and passes them to the client
 *
 * For async errors, wrap route handlers with try/catch blocks
 */

const errorHandler = (err, req, res, next) => {
  // Log the error
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);

  // Default to 500 Internal Server Error
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Send error response
  res.status(status).json({
    error: message,
    status: status,
    timestamp: new Date().toISOString()
  });
};

export default errorHandler;
