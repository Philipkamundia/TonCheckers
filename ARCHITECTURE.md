# TonCheckers — Test Suite Documentation

## Architecture Map

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│   Telegram Mini App (React/Vite)  ←→  Socket.io WebSocket       │
└───────────────────┬─────────────────────────────────────────────┘
                    │ HTTPS + WSS
┌───────────────────▼─────────────────────────────────────────────┐
│                    EXPRESS BACKEND (Node.js / ESM)               │
│                                                                  │
│  Auth (JWT + TonConnect proof + Telegram initData)               │
│  ├── POST /auth/connect    — proof verify + JWT issue            │
│  ├── POST /auth/verify     — initData re-auth                    │
│  └── POST /auth/refresh    — rotate access token                 │
│                                                                  │
│  Matchmaking                                                     │
│  ├── POST /matchmaking/join    — lock stake + enter queue        │
│  ├── DELETE /matchmaking/leave — unlock + exit queue             │
│  └── GET  /matchmaking/status  — queue position                  │
│                                                                  │
│  Game (WebSocket)                                                │
│  ├── game:move              — move validation + apply            │
│  ├── game:resign            — settle win for opponent            │
│  └── game:draw_offer        — propose / accept draw              │
│                                                                  │
│  Wallet / Treasury                                               │
│  ├── GET  /balance                — available + locked           │
│  ├── GET  /balance/history        — paginated tx log             │
│  ├── POST /balance/withdraw       — 30min cooldown + daily limit │
│  └── Deposit detection (polling TonCenter API)                   │
│                                                                  │
│  Tournament (bracket + lobby WebSocket rooms)                    │
└──────┬────────────────┬───────────────────────────┬─────────────┘
       │                │                           │
┌──────▼───────┐ ┌──────▼────────┐ ┌───────────────▼─────────────┐
│  PostgreSQL  │ │     Redis      │ │   External APIs              │
│  (Supabase)  │ │  (ioredis)     │ │   TonCenter (TON chain)      │
│              │ │                │ │   Telegram Bot API           │
│  users       │ │  mm:queue      │ │                              │
│  balances    │ │  mm:entry:*    │ │                              │
│  games       │ │  mm:lock:*     │ │                              │
│  transactions│ │  withdrawal:   │ │                              │
│  tournaments │ │    cooldown:*  │ │                              │
│  mm_queue    │ │    daily:*     │ │                              │
│  recon_log   │ │  tonproof:*    │ │                              │
└──────────────┘ └───────────────┘ └──────────────────────────────┘
```

---

## Risk Register (High → Low)

| Risk | Severity | Mitigations tested |
|------|----------|-------------------|
| Double settlement — winner paid twice | CRITICAL | `AND status='active'` guard, idempotency test |
| Negative balance from race condition | CRITICAL | `atomicLockBalance` single-query, TOCTOU test |
| Lost stake after failed queue join | CRITICAL | 3-retry refund + orphanedLockRecovery job test |
| Withdrawal to wrong wallet | CRITICAL | Destination vs registered wallet check test |
| Daily limit bypass via concurrent requests | HIGH | Redis INCRBYFLOAT atomic counter test |
| ELO float arithmetic drift | HIGH | BigInt nanoTON path, 100-stake parity tests |
| TonConnect proof replay attack | HIGH | Redis NX nonce tracking test |
| Telegram initData tampering | HIGH | HMAC-SHA256 tamper detection test |
| Expired JWT accepted | HIGH | requireAuth middleware expiry test |
| Orphaned locked funds after crash | MEDIUM | orphanedLockRecovery job test |
| Stuck withdrawal (sent but unconfirmed) | MEDIUM | withdrawalRecovery job (coverage note) |
| Wrong ELO K-factor applied | MEDIUM | K-factor boundary tests at 1400/1800/2200 |
| Illegal checkers move accepted | MEDIUM | isLegalMove + forced capture tests |
| Flying king captures wrong square | MEDIUM | King landing square test |

---

## Test Strategy

### Coverage Targets

| Module | Target | Rationale |
|--------|--------|-----------|
| `settlement.service.ts` | **100%** | Direct money handling |
| `balance.service.ts` | **100%** | All balance mutations |
| `elo.service.ts` | **100%** | Rating integrity |
| `engine/moves.ts` | **100%** | Game integrity |
| `engine/conditions.ts` | **100%** | Win/draw detection |
| `matchmaking.service.ts` | **95%** | Queue + race conditions |
| `withdrawal.service.ts` | **95%** | Withdrawal flow |
| `validateInitData.ts` | **100%** | Auth security |
| `middleware/auth.ts` | **100%** | JWT gate |
| All other modules | **90%** | Standard threshold |

### Test File Index

```
tests/
  setup/
    global.ts              — env vars, timer freeze, logger mock

  fixtures/
    index.ts               — makeUser, makeBalance, makeQueueEntry,
                             makeGame, makeTelegramInitData, makeAccessToken

  unit/
    services/
      elo.test.ts           — K-factor tiers, expected score, draw=no-change,
                               ELO floor, symmetric results
      settlement.test.ts    — calculateWinPayout (BigInt precision, fee/payout
                               arithmetic, all stakes), settleWin (happy path,
                               double-settlement guard, tournament-game skip,
                               missing players, DB rollback), settleDraw
                               (stake return, no-ELO-change, idempotency)
      balance.test.ts       — getBalance, creditBalance, deductBalance,
                               lockBalance, unlockBalance, atomicLockBalance
                               (TOCTOU proof, concurrency)
      matchmaking.test.ts   — joinQueue (success, STAKE_TOO_LOW, ALREADY_QUEUED,
                               NOT_FOUND, BANNED, refund-on-failure, 3x retry),
                               cancelQueue, getEloRange (expansion timing),
                               findMatch (range, stake preference, ELO proximity),
                               acquireLock/releaseLock
      withdrawal.test.ts    — input validation, dest lock, cooldown, daily limit,
                               admin review routing, balance deduct-before-send,
                               DB-failure refund
    engine/
      moves.test.ts         — starting position, simple moves, forced capture,
                               maximum capture, backward capture, flying kings,
                               multi-jump chains, isLegalMove
      conditions.test.ts    — ongoing, win(no_pieces), win(no_moves),
                               draw(50-move), draw(repetition), hasPlayerLost,
                               priority ordering
    utils/
      validateInitData.test.ts — happy path, tamper detection, expiry,
                                  missing token, malformed input,
                                  isInitDataValid dev bypass
    middleware/
      auth.test.ts          — valid token, missing header, non-Bearer,
                               expired token, tampered token, wrong secret

  integration/
    jobs/
      balanceReconciliation.test.ts — OK state, discrepancy alert,
                                       read-only proof, negative balance,
                                       orphan reporting, stuck withdrawal,
                                       resilience (missing table, DB failure)
      orphanedLockRecovery.test.ts  — no orphans, recovery path, safety
                                       conditions (re-check in tx), rollback

  e2e/
    game-lifecycle.test.ts  — stake locking, ELO range, matchmaking pair,
                               settlement result, balance conservation,
                               draw return, engine moves

  load/
    chaos.test.ts           — ELO determinism (1000 concurrent), payout
                               concurrency (500 calls), atomic lock exclusivity
                               (10 concurrent → 1 succeeds), daily limit race
                               proof, idempotency contract, ELO floor stress,
                               ELO convergence (500 games)
```

### Running Tests

```bash
# All tests
npm test

# Unit only (fast, no external dependencies)
npm run test:unit

# Integration (requires DB + Redis via Docker services)
npm run test:integration

# E2E simulation
npm run test:e2e

# Chaos / load
npm run test:chaos

# With coverage report
npm run test:coverage

# Watch mode during development
npm run test:watch
```

### Adding New Financial Logic

When adding any new money-handling code, follow this checklist:

1. **Test the arithmetic separately** — write a pure function test for the
   calculation before wiring it to the DB
2. **Prove the guard condition** — if it has `WHERE balance >= amount`, test
   the rowCount=0 path explicitly
3. **Test idempotency** — if it can be called twice, prove the second call is safe
4. **Test the rollback** — if it uses a DB transaction, inject a failure and verify
   `ROLLBACK` is called and state is restored
5. **Check for float** — if it handles TON amounts, verify it uses BigInt nanoTON
   arithmetic and not IEEE 754 floats

---

## Coverage Report Expectations

After running `npm run test:coverage`:

```
File                              | Lines | Branches | Functions |
----------------------------------|-------|----------|-----------|
settlement.service.ts             | 100%  |   100%   |   100%    | ← REQUIRED
balance.service.ts                | 100%  |   100%   |   100%    | ← REQUIRED
elo.service.ts                    | 100%  |   100%   |   100%    | ← REQUIRED
engine/moves.ts                   | 100%  |    95%   |   100%    | ← REQUIRED
engine/conditions.ts              | 100%  |   100%   |   100%    | ← REQUIRED
matchmaking.service.ts            |  95%  |    90%   |   100%    | ← REQUIRED
validateInitData.ts               | 100%  |   100%   |   100%    | ← REQUIRED
middleware/auth.ts                | 100%  |   100%   |   100%    | ← REQUIRED
withdrawal.service.ts             |  95%  |    90%   |    95%    |
auth.service.ts                   |  90%  |    85%   |    90%    |
jobs/balanceReconciliation.ts     |  90%  |    90%   |   100%    |
jobs/orphanedLockRecovery.ts      |  85%  |    80%   |   100%    |
----------------------------------|-------|----------|-----------|
ALL FILES (aggregate)             |  92%  |    90%   |    96%    |
```
