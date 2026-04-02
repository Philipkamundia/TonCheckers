import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Sentry is optional — only capture if initialised
function captureException(err: Error): void {
  try {
    // Dynamic import avoids hard dependency if Sentry is not installed
    const sentry = require('@sentry/node') as typeof import('@sentry/node');
    if (sentry.getClient()) sentry.captureException(err);
  } catch { /* Sentry not available */ }
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    // 5xx AppErrors are unexpected — capture them
    if (err.statusCode >= 500) captureException(err);
    return res.status(err.statusCode).json({
      ok: false,
      error: err.message,
      code: err.code,
    });
  }

  // Unhandled errors — always capture
  captureException(err);
  logger.error(err.message, { stack: err.stack });

  return res.status(500).json({
    ok: false,
    error: 'Internal server error',
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ ok: false, error: 'Route not found' });
}
