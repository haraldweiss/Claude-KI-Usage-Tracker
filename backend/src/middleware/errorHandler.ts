/**
 * Global Error Handler Middleware
 * Must be the last middleware in the Express app
 * Catches all synchronous errors and passes them to the client
 *
 * For async errors, wrap route handlers with try/catch blocks
 */

import { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types/index.js';

class AppError extends Error {
  constructor(
    message: string,
    public status: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  // Log the error
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);

  // Default to 500 Internal Server Error
  const status = err instanceof AppError ? err.status : 500;
  const message = err.message || 'Internal Server Error';

  // Send error response
  res.status(status).json({
    error: message,
    status,
    timestamp: new Date().toISOString()
  });
}

export default errorHandler;
export { AppError };
