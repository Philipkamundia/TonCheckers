/**
 * tests/unit/middleware/errorHandler.test.ts
 *
 * errorHandler and notFoundHandler middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { errorHandler, notFoundHandler, AppError } from '../../../apps/backend/src/middleware/errorHandler.js';
import type { Request, Response, NextFunction } from 'express';

// Mock the logger before importing the module that uses it
vi.mock('../../../apps/backend/src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  },
}));

function mockRes() {
  const res = {
    status: vi.fn(),
    json:   vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

const mockReq  = {} as Request;
const mockNext = vi.fn() as NextFunction;

describe('AppError', () => {
  it('stores statusCode, message, and code', () => {
    const err = new AppError(400, 'Bad input', 'BAD_INPUT');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad input');
    expect(err.code).toBe('BAD_INPUT');
    expect(err.name).toBe('AppError');
  });

  it('works without code', () => {
    const err = new AppError(500, 'Server error');
    expect(err.code).toBeUndefined();
  });
});

describe('errorHandler', () => {
  it('returns correct status and JSON for AppError', () => {
    const res = mockRes();
    const err = new AppError(404, 'Not found', 'NOT_FOUND');
    errorHandler(err, mockReq, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Not found', code: 'NOT_FOUND' });
  });

  it('returns 500 for unknown errors', () => {
    const res = mockRes();
    errorHandler(new Error('Unexpected'), mockReq, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Internal server error' });
  });

  it('handles 4xx AppError without crashing', () => {
    const res = mockRes();
    const err = new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    expect(() => errorHandler(err, mockReq, res, mockNext)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with route not found message', () => {
    const res = mockRes();
    notFoundHandler(mockReq, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Route not found' });
  });
});
