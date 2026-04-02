/**
 * sentry.ts — Sentry error tracking initialisation
 * Only active when SENTRY_DSN is set in environment.
 */
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry: SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    beforeSend(event) {
      // Strip PII from request bodies
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        if (data.proof) data.proof = '[redacted]';
        if (data.initData) data.initData = '[redacted]';
      }
      return event;
    },
  });

  logger.info('Sentry: error tracking enabled');
}

export { Sentry };
