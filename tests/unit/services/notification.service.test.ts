/**
 * tests/unit/services/notification.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../../../apps/backend/src/services/notification.service.js';

const { mockDbQuery } = vi.hoisted(() => ({ mockDbQuery: vi.fn() }));

vi.mock('../../../apps/backend/src/config/db.js', () => ({
  default: { query: mockDbQuery },
}));

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('NotificationService.send', () => {
  it('queues notification and skips Telegram when no telegram_id', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] }) // INSERT notification
      .mockResolvedValueOnce({ rows: [{ telegram_id: null }] }); // SELECT user

    await NotificationService.send('u1', 'deposit_confirmed', { amount: '1.0' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips Telegram send when bot token not set', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ telegram_id: '12345' }] });

    await NotificationService.send('u1', 'withdrawal_processed', { amount: '2.0' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends Telegram message and marks notification sent', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ telegram_id: '12345' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE sent=true

    mockFetch.mockResolvedValueOnce({ ok: true });

    await NotificationService.send('u1', 'deposit_confirmed', { amount: '1.0' });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it('records error when Telegram API returns non-ok', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ telegram_id: '12345' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE error

    mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Bad Request' });

    // Should not throw — errors are swallowed
    await expect(NotificationService.send('u1', 'game_result', { won: true, payout: '1.7', eloChange: '+20' })).resolves.toBeUndefined();
  });

  it('records error when fetch throws', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ telegram_id: '12345' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE error

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(NotificationService.send('u1', 'server_crash_refund', { amount: '1.0' })).resolves.toBeUndefined();
  });

  // ─── Message formatting (all branches) ───────────────────────────────────

  it.each([
    ['deposit_confirmed',      { amount: '1.0' },                                    '✅'],
    ['withdrawal_processed',   { amount: '2.0', txHash: 'abc' },                     '💸'],
    ['game_result',            { won: true, payout: '1.7', eloChange: '+20' },       '🏆'],
    ['game_result',            { won: false, eloChange: '-20' },                     '❌'],
    ['tournament_starting',    { name: 'Test Cup' },                                 '🏟'],
    ['tournament_match_ready', { tournamentName: 'Test Cup', round: 1 },             '⚔️'],
    ['tournament_result',      { won: true, payout: '10', tournamentName: 'Cup' },   '🥇'],
    ['tournament_result',      { won: false, position: 3, tournamentName: 'Cup' },   '🏟'],
    ['server_crash_refund',    { amount: '1.0' },                                    '🔄'],
  ] as const)('formats %s message correctly', async (type, payload, expectedEmoji) => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ telegram_id: '12345' }] })
      .mockResolvedValueOnce({ rows: [] });

    let capturedBody = '';
    mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
      return Promise.resolve({ ok: true });
    });

    await NotificationService.send('u1', type as never, payload as never);
    expect(capturedBody).toContain(expectedEmoji);
  });
});
