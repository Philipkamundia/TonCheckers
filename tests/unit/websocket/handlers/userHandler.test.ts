/**
 * tests/unit/websocket/handlers/userHandler.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
  return { mockLogger };
});

vi.mock('../../../../apps/backend/src/utils/logger.js', () => ({
  logger: mockLogger,
}));

import { registerUserHandlers } from '../../../../apps/backend/src/websocket/handlers/userHandler.js';

function makeSocket(userId = 'user-1') {
  return {
    id:     'socket-1',
    userId,
    join:   vi.fn(),
    leave:  vi.fn(),
    on:     vi.fn(),
    emit:   vi.fn(),
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe('registerUserHandlers', () => {
  it('joins the personal user room on connect', () => {
    const socket = makeSocket('user-42');
    registerUserHandlers(socket);
    expect(socket.join).toHaveBeenCalledOnce();
    expect(socket.join).toHaveBeenCalledWith('user:user-42');
  });

  it('logs a debug message on connect', () => {
    const socket = makeSocket('user-42');
    registerUserHandlers(socket);
    expect(mockLogger.debug).toHaveBeenCalledWith('User user-42 joined personal room');
  });

  it('registers a disconnect handler', () => {
    const socket = makeSocket('user-1');
    registerUserHandlers(socket);
    expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('leaves the personal room on disconnect', () => {
    const socket = makeSocket('user-99');
    registerUserHandlers(socket);

    const [, disconnectHandler] = socket.on.mock.calls.find(([event]: [string]) => event === 'disconnect')!;
    disconnectHandler();

    expect(socket.leave).toHaveBeenCalledOnce();
    expect(socket.leave).toHaveBeenCalledWith('user:user-99');
  });

  it('logs a debug message on disconnect', () => {
    const socket = makeSocket('user-99');
    registerUserHandlers(socket);

    const [, disconnectHandler] = socket.on.mock.calls.find(([event]: [string]) => event === 'disconnect')!;
    disconnectHandler();

    expect(mockLogger.debug).toHaveBeenCalledWith('User user-99 left personal room');
  });

  it('uses the correct userId from socket', () => {
    const socket = makeSocket('special-user');
    registerUserHandlers(socket);
    expect(socket.join).toHaveBeenCalledWith('user:special-user');
  });
});
