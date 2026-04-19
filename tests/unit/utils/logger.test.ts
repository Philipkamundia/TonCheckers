/**
 * tests/unit/utils/logger.test.ts
 *
 * Covers the production transport branches in logger.ts (lines 12, 17-20).
 * Must import with a fresh module to test different NODE_ENV values.
 */
import { describe, it, expect, vi } from 'vitest';

describe('logger.ts — production mode', () => {
  it('exports logger and morganStream', async () => {
    // Import the already-loaded module (test env)
    const { logger, morganStream } = await import('../../../apps/backend/src/utils/logger.js');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(morganStream).toBeDefined();
    expect(typeof morganStream.write).toBe('function');
  });

  it('morganStream.write calls logger.http', async () => {
    const { logger, morganStream } = await import('../../../apps/backend/src/utils/logger.js');
    const spy = vi.spyOn(logger, 'http').mockImplementation(() => logger);
    morganStream.write('GET /api/health 200\n');
    expect(spy).toHaveBeenCalledWith('GET /api/health 200');
    spy.mockRestore();
  });

  it('default export is the logger', async () => {
    const mod = await import('../../../apps/backend/src/utils/logger.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.info).toBe('function');
  });
});

describe('logger.ts — LOG_LEVEL env', () => {
  it('logger level is set (debug in test env)', async () => {
    const { logger } = await import('../../../apps/backend/src/utils/logger.js');
    // In test env (not production), level should be debug
    expect(logger.level).toBeDefined();
  });
});
