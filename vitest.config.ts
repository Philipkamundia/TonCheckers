import { defineConfig } from 'vitest/config';
import path from 'path';

const BACKEND_NATIVE_EXTERNALS = [
  'winston', 'ioredis', 'pg', 'jsonwebtoken',
  '@ton/core', '@ton/crypto', '@ton/ton', '@tonconnect/sdk',
  'socket.io', 'express', 'express-rate-limit', 'rate-limit-redis',
  'helmet', 'cors', 'compression', 'morgan', 'node-cron',
  'zod', 'axios', '@sentry/node',
];

export default defineConfig({
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, '../apps/backend/src'),
    },
  },

  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/global.ts'],

    deps: {
      moduleDirectories: [
        'node_modules',
        path.resolve(__dirname, '../apps/backend/node_modules'),
      ],
    },

    // Non-deprecated API in vitest 1.x — replaces deps.external
    server: {
      deps: {
        external: BACKEND_NATIVE_EXTERNALS.map(p => new RegExp(`^${p}(/|$)`)),
      },
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],

      // **/ prefix matches the full absolute path V8 reports on Windows
      // (C:\...\apps\backend\src\...) and Unix (/.../.../apps/backend/src/...)
      include: ['**/apps/backend/src/**/*.ts'],
      exclude: [
        '**/apps/backend/src/index.ts',
        '**/apps/backend/src/migrate.ts',
        '**/apps/backend/src/config/**',
        '**/apps/backend/src/types/**',
        '**/node_modules/**',
        '**/*.d.ts',
      ],

      thresholds: {
        global: { lines: 90, functions: 90, branches: 85, statements: 90 },
        '**/apps/backend/src/services/settlement.service.ts': { lines: 100, functions: 100, branches: 100 },
        '**/apps/backend/src/services/balance.service.ts':    { lines: 100, functions: 100, branches: 100 },
        '**/apps/backend/src/engine/moves.ts':                { lines: 98,  functions: 100, branches: 93  },
        '**/apps/backend/src/engine/conditions.ts':           { lines: 100, functions: 100, branches: 100 },
        '**/apps/backend/src/services/elo.service.ts':        { lines: 100, functions: 100, branches: 100 },
        '**/apps/backend/src/services/matchmaking.service.ts':{ lines: 95,  functions: 100, branches: 90  },
      },
    },

    projects: [
      { name: 'unit',        test: { include: ['tests/unit/**/*.test.ts'],        environment: 'node' } },
      { name: 'integration', test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000 } },
      { name: 'e2e',         test: { include: ['tests/e2e/**/*.test.ts'],         environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 } },
    ],
  },
});
