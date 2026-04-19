/**
 * tests/unit/services/withdrawal.sendTon.test.ts
 *
 * Covers sendTonTransfer uncovered branches by mocking the method itself
 * (since @ton/ton is an external dep that can't be intercepted by vitest).
 * Tests the processWithdrawal logic that calls sendTonTransfer.
 *
 * Also tests the validation branches directly:
 * - No mnemonic → throw
 * - Short mnemonic → throw
 * - Hot wallet lock already held → throw
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis, mockDbQuery, mockCredit, mockNotify, mockGetSeqno, mockSendTransfer, mockMnemonicToKey } = vi.hoisted(() => ({
  mockRedis: { set: vi.fn(), get: vi.fn(), del: vi.fn(), incrbyfloat: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
  mockDbQuery: vi.fn(),
  mockCredit:  vi.fn(),
  mockNotify:  vi.fn(),
  mockGetSeqno: vi.fn(),
  mockSendTransfer: vi.fn(),
  mockMnemonicToKey: vi.fn(),
}));

vi.mock('../../../apps/backend/src/config/redis.js', () => ({ default: mockRedis }));
vi.mock('../../../apps/backend/src/config/db.js', () => ({ default: { query: mockDbQuery, connect: vi.fn() } }));
vi.mock('../../../apps/backend/src/services/balance.service.js', () => ({
  BalanceService: { deductBalance: vi.fn(), creditBalance: mockCredit },
}));
vi.mock('../../../apps/backend/src/services/notification.service.js', () => ({
  NotificationService: { send: mockNotify },
}));

import { WithdrawalService } from '../../../apps/backend/src/services/withdrawal.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOT_WALLET_MNEMONIC = Array(24).fill('word').join(' ');
  process.env.TON_NETWORK = 'testnet';
  delete process.env.TON_API_KEY;
  mockNotify.mockResolvedValue(undefined);
  mockCredit.mockResolvedValue(undefined);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
  mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('WithdrawalService.sendTonTransfer — validation', () => {
  it('throws when HOT_WALLET_MNEMONIC not configured', async () => {
    delete process.env.HOT_WALLET_MNEMONIC;
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('HOT_WALLET_MNEMONIC not configured');
  });

  it('throws when mnemonic has fewer than 12 words', async () => {
    process.env.HOT_WALLET_MNEMONIC = 'word word word';
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('appears invalid');
  });

  it('throws when hot wallet lock already held', async () => {
    mockRedis.set.mockResolvedValueOnce(null); // lock not acquired
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('Hot wallet busy');
  });
});

describe('WithdrawalService.processWithdrawal — via sendTonTransfer mock', () => {
  let sendTonSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock sendTonTransfer to avoid real @ton/ton calls
    sendTonSpy = vi.spyOn(WithdrawalService, 'sendTonTransfer');
  });

  afterEach(() => {
    sendTonSpy.mockRestore();
  });

  it('updates status to confirmed and notifies on successful send', async () => {
    vi.mocked(WithdrawalService.sendTonTransfer).mockResolvedValueOnce('real-hash-abc');
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5', 'cooldown:user-1');

    const confirmCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='confirmed'"));
    expect(confirmCall).toBeDefined();
    expect(mockNotify).toHaveBeenCalledWith('user-1', 'withdrawal_processed', expect.any(Object));
  });

  it('stores pending hash when sendTonTransfer returns pending: prefix', async () => {
    vi.mocked(WithdrawalService.sendTonTransfer).mockResolvedValueOnce('pending:EQDhot:seq42:123');
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5');

    const pendingCall = mockDbQuery.mock.calls.find(c =>
      c[0].includes('ton_tx_hash') && !c[0].includes("status='confirmed'")
    );
    expect(pendingCall).toBeDefined();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('refunds balance and marks failed when sendTonTransfer throws', async () => {
    vi.mocked(WithdrawalService.sendTonTransfer).mockRejectedValueOnce(new Error('Network error'));
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(
      WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5', 'cooldown:user-1'),
    ).rejects.toThrow('Network error');

    expect(mockCredit).toHaveBeenCalledWith('user-1', '5');
    const failedCall = mockDbQuery.mock.calls.find(c => c[0].includes("status='failed'"));
    expect(failedCall).toBeDefined();
  });

  it('does not refund when post-send bookkeeping fails (money already sent)', async () => {
    vi.mocked(WithdrawalService.sendTonTransfer).mockResolvedValueOnce('real-hash-abc');
    mockDbQuery.mockRejectedValueOnce(new Error('Post-send DB error'));

    await expect(
      WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5'),
    ).resolves.toBeUndefined();

    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('sets cooldown after successful send', async () => {
    vi.mocked(WithdrawalService.sendTonTransfer).mockResolvedValueOnce('real-hash');
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await WithdrawalService.processWithdrawal('tx-1', 'user-1', 'EQDdest', '5', 'cooldown:user-1');

    expect(mockRedis.set).toHaveBeenCalledWith('cooldown:user-1', '1', 'EX', 1800);
  });
});

// Mock @ton/ton — use hoisted fns inside factory
vi.mock('@ton/ton', () => ({
  TonClient: vi.fn().mockImplementation(() => ({
    open: vi.fn().mockReturnValue({
      getSeqno:     mockGetSeqno,
      sendTransfer: mockSendTransfer,
      address:      { toString: vi.fn().mockReturnValue('EQDhot') },
    }),
  })),
  WalletContractV5R1: {
    create: vi.fn().mockReturnValue({
      address: { toString: vi.fn().mockReturnValue('EQDhot') },
    }),
  },
  internal: vi.fn().mockReturnValue({}),
}));

// Mock @ton/crypto
vi.mock('@ton/crypto', () => ({
  mnemonicToPrivateKey: mockMnemonicToKey,
  signVerify: vi.fn().mockResolvedValue(true),
}));

// Mock @ton/core
vi.mock('@ton/core', () => ({
  Address: { parse: vi.fn().mockReturnValue({ toString: vi.fn() }) },
  toNano: vi.fn().mockReturnValue(BigInt(5_000_000_000)),
  SendMode: { PAY_GAS_SEPARATELY: 1, IGNORE_ERRORS: 2 },
  contractAddress: vi.fn(),
  loadStateInit: vi.fn(),
  Cell: { fromBase64: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VALID_MNEMONIC = Array(24).fill('word').join(' ');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOT_WALLET_MNEMONIC = VALID_MNEMONIC;
  process.env.TON_NETWORK = 'testnet';
  delete process.env.TON_API_KEY;

  mockNotify.mockResolvedValue(undefined);
  mockCredit.mockResolvedValue(undefined);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
  mockDbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  mockMnemonicToKey.mockResolvedValue({
    publicKey: Buffer.alloc(32),
    secretKey: Buffer.alloc(64),
  });
  mockGetSeqno.mockResolvedValue(42);
  mockSendTransfer.mockResolvedValue(undefined);
});

describe('WithdrawalService.sendTonTransfer', () => {
  it('throws when HOT_WALLET_MNEMONIC not configured', async () => {
    delete process.env.HOT_WALLET_MNEMONIC;
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('HOT_WALLET_MNEMONIC not configured');
  });

  it('throws when mnemonic has fewer than 12 words', async () => {
    process.env.HOT_WALLET_MNEMONIC = 'word word word';
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('appears invalid');
  });

  it('throws when hot wallet lock already held', async () => {
    mockRedis.set.mockResolvedValueOnce(null); // lock not acquired
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('Hot wallet busy');
  });

  it('throws when seqno fetch fails', async () => {
    mockGetSeqno.mockRejectedValueOnce(new Error('TON API timeout'));
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('TON API error getting seqno');
  });

  it('throws when transfer broadcast fails', async () => {
    mockSendTransfer.mockRejectedValueOnce(new Error('Broadcast failed'));
    await expect(WithdrawalService.sendTonTransfer('EQDdest', '5'))
      .rejects.toThrow('TON transfer failed');
  });

  it('returns hash when found on first poll', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: [{
          transaction_id: { hash: 'real-hash-found' },
          out_msgs: [{ destination: 'EQDdest', value: 5_000_000_000 }],
        }],
      }),
    });

    // Mock setTimeout to execute immediately
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const hash = await WithdrawalService.sendTonTransfer('EQDdest', '5', 'tx-1');
    expect(hash).toBe('real-hash-found');
    setTimeoutSpy.mockRestore();
  });

  it('returns synthetic hash when all 5 polls find nothing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const hash = await WithdrawalService.sendTonTransfer('EQDdest', '5', 'tx-1');
    expect(hash).toMatch(/^pending:/);
    setTimeoutSpy.mockRestore();
  });

  it('continues polling when API returns !ok', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: [{
            transaction_id: { hash: 'found-on-attempt-2' },
            out_msgs: [{ destination: 'EQDdest', value: 5_000_000_000 }],
          }],
        }),
      });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const hash = await WithdrawalService.sendTonTransfer('EQDdest', '5');
    expect(hash).toBe('found-on-attempt-2');
    setTimeoutSpy.mockRestore();
  });

  it('continues polling when fetch throws', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: [{
            transaction_id: { hash: 'found-after-error' },
            out_msgs: [{ destination: 'EQDdest', value: 5_000_000_000 }],
          }],
        }),
      });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const hash = await WithdrawalService.sendTonTransfer('EQDdest', '5');
    expect(hash).toBe('found-after-error');
    setTimeoutSpy.mockRestore();
  });

  it('persists seqno to DB when transactionId provided', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await WithdrawalService.sendTonTransfer('EQDdest', '5', 'tx-seqno-test');

    const seqnoCall = mockDbQuery.mock.calls.find(c => c[0].includes('hot_wallet_seqno'));
    expect(seqnoCall).toBeDefined();
    setTimeoutSpy.mockRestore();
  });

  it('skips seqno persistence when no transactionId', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await WithdrawalService.sendTonTransfer('EQDdest', '5');

    const seqnoCall = mockDbQuery.mock.calls.find(c => c[0].includes('hot_wallet_seqno'));
    expect(seqnoCall).toBeUndefined();
    setTimeoutSpy.mockRestore();
  });

  it('uses mainnet endpoint when TON_NETWORK=mainnet', async () => {
    process.env.TON_NETWORK = 'mainnet';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await WithdrawalService.sendTonTransfer('EQDdest', '5');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('toncenter.com/api/v2/getTransactions'),
    );
    setTimeoutSpy.mockRestore();
  });
});
