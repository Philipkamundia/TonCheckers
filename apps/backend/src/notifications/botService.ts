/**
 * botService.ts — Telegram Bot API service
 *
 * Two bots:
 *   Main bot (@CheckTONBot)      — user notifications (PRD §11)
 *   Admin bot (@CheckTONAdminBot) — admin dashboard access (PRD §15)
 *
 * PRD §11 — All 6 notification events:
 *   1. Tournament Starting Soon   — 30 min before
 *   2. Tournament Match Ready     — bracket generates next round
 *   3. Winnings Received          — game result confirmed
 *   4. Achievement Unlocked       — milestone (future)
 *   5. Deposit Confirmed          — on-chain tx confirmed
 *   6. Withdrawal Processed       — funds sent from hot wallet
 */

import { logger } from '../utils/logger.js';

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const MINI_APP_URL    = process.env.FRONTEND_URL ?? 'https://checkton.app';

async function sendMessage(token: string, chatId: string, text: string, replyMarkup?: unknown): Promise<boolean> {
  if (!token) return false;
  try {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.warn(`Telegram API error chatId=${chatId}: ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`Telegram send failed: ${(err as Error).message}`);
    return false;
  }
}

// ─── User Notifications (PRD §11) ────────────────────────────────────────────

export const BotService = {

  async depositConfirmed(telegramId: string, amount: string): Promise<void> {
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `✅ <b>Deposit Confirmed</b>\n<b>${amount} TON</b> has been added to your CheckTON balance.`,
    );
  },

  async withdrawalProcessed(telegramId: string, amount: string, txHash?: string): Promise<void> {
    const hashLine = txHash ? `\nTx: <code>${txHash.slice(0, 20)}…</code>` : '';
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `💸 <b>Withdrawal Sent</b>\n<b>${amount} TON</b> has been sent to your wallet.${hashLine}`,
    );
  },

  async winningsReceived(telegramId: string, payout: string, eloChange: string): Promise<void> {
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `🏆 <b>You Won!</b>\n+<b>${payout} TON</b> added to your balance.\nELO change: <b>${eloChange}</b>`,
    );
  },

  async tournamentStartingSoon(telegramId: string, tournamentName: string): Promise<void> {
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `🏟 <b>Tournament Starting Soon</b>\n"${tournamentName}" begins in <b>30 minutes</b>.\nGet ready!`,
    );
  },

  async tournamentMatchReady(telegramId: string, tournamentName: string, round: number): Promise<void> {
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `⚔️ <b>Your Match is Ready</b>\nTournament: <b>${tournamentName}</b>\nRound <b>${round}</b> — Your opponent is waiting!`,
    );
  },

  async tournamentResult(telegramId: string, tournamentName: string, won: boolean, payout?: string, position?: number): Promise<void> {
    const msg = won
      ? `🥇 <b>Tournament Winner!</b>\nYou won <b>${payout} TON</b> in "${tournamentName}"! 🎉`
      : `🏟 <b>Tournament Ended</b>\nYou finished in position <b>${position}</b> in "${tournamentName}".`;
    await sendMessage(BOT_TOKEN ?? '', telegramId, msg);
  },

  async serverCrashRefund(telegramId: string, amount: string): Promise<void> {
    await sendMessage(BOT_TOKEN ?? '', telegramId,
      `🔄 <b>Game Refunded</b>\nYour stake of <b>${amount} TON</b> has been returned due to a server issue. We apologise for the interruption.`,
    );
  },
};

// ─── Admin Bot (PRD §15) ──────────────────────────────────────────────────────

export const AdminBotService = {

  /**
   * Send admin dashboard link to the admin via the private admin bot.
   * The URL includes ?mode=admin so the frontend knows to render the admin UI.
   * The admin still needs to connect their treasury wallet to authenticate.
   */
  async sendDashboardLink(adminTelegramId: string): Promise<void> {
    const url = `${MINI_APP_URL}?mode=admin`;
    await sendMessage(ADMIN_BOT_TOKEN ?? '', adminTelegramId,
      `🔐 <b>CheckTON Admin Dashboard</b>\n\nTap the button below to open the admin panel.\nYou'll need to connect your treasury wallet to authenticate.`,
      {
        inline_keyboard: [[
          { text: '🔐 Open Admin Dashboard', web_app: { url } },
        ]],
      },
    );
  },

  async notifyPendingWithdrawal(adminTelegramId: string, amount: string, username: string): Promise<void> {
    await sendMessage(ADMIN_BOT_TOKEN ?? '', adminTelegramId,
      `⚠️ <b>Large Withdrawal Pending Approval</b>\n\nUser: <b>${username}</b>\nAmount: <b>${amount} TON</b>\n\nOpen the admin dashboard to review.`,
    );
  },
};

/**
 * Webhook handler for the admin bot.
 * Receives /start command and sends the dashboard link.
 * Register at: https://api.telegram.org/bot{TOKEN}/setWebhook?url={BACKEND_URL}/api/admin/bot-webhook
 */
export async function handleAdminBotWebhook(body: {
  message?: { chat?: { id?: number }; text?: string };
}): Promise<void> {
  const chatId = body?.message?.chat?.id;
  const text   = body?.message?.text;

  if (!chatId) return;

  if (text === '/start' || text === '/dashboard') {
    await AdminBotService.sendDashboardLink(String(chatId));
  }
}
