import { logger } from '../utils/logger.js';
import pool from '../config/db.js';

// PRD §11 — all notifications delivered via Telegram Bot API
type NotificationType =
  | 'deposit_confirmed'
  | 'withdrawal_processed'
  | 'game_result'
  | 'tournament_starting'
  | 'tournament_match_ready'
  | 'tournament_result'
  | 'server_crash_refund';

interface NotificationPayload {
  [key: string]: unknown;
}

export class NotificationService {
  private static get botToken() { return process.env.TELEGRAM_BOT_TOKEN; }

  private static async sendTelegramMessage(telegramId: string, text: string): Promise<void> {
    if (!this.botToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — notification skipped');
      return;
    }
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' }),
      });
      if (!response.ok) {
        logger.warn(`Telegram API error for ${telegramId}: ${await response.text()}`);
      }
    } catch (err) {
      logger.error(`Telegram send failed: ${(err as Error).message}`);
    }
  }

  static async send(userId: string, type: NotificationType, payload: NotificationPayload): Promise<void> {
    const { rows: [notification] } = await pool.query(
      `INSERT INTO notifications (user_id, type, payload) VALUES ($1, $2, $3) RETURNING id`,
      [userId, type, JSON.stringify(payload)],
    );

    const { rows: [user] } = await pool.query(
      'SELECT telegram_id FROM users WHERE id = $1', [userId],
    );

    if (!user?.telegram_id) {
      logger.warn(`No telegram_id for user ${userId} — ${type} queued only`);
      return;
    }

    const text = NotificationService.formatMessage(type, payload);
    try {
      await NotificationService.sendTelegramMessage(user.telegram_id, text);
      await pool.query(
        `UPDATE notifications SET sent = true, sent_at = NOW() WHERE id = $1`,
        [notification.id],
      );
    } catch (err) {
      await pool.query(
        `UPDATE notifications SET error = $1 WHERE id = $2`,
        [(err as Error).message, notification.id],
      );
    }
  }

  private static formatMessage(type: NotificationType, payload: NotificationPayload): string {
    switch (type) {
      case 'deposit_confirmed':
        return `✅ <b>Deposit Confirmed</b>\n${payload.amount} TON added to your balance.`;
      case 'withdrawal_processed':
        return `💸 <b>Withdrawal Sent</b>\n${payload.amount} TON sent to your wallet.`;
      case 'game_result':
        return payload.won
          ? `🏆 <b>You Won!</b>\n+${payload.payout} TON added to your balance.\nELO: ${payload.eloChange}`
          : `❌ <b>Game Over</b>\nBetter luck next time.\nELO: ${payload.eloChange}`;
      case 'tournament_starting':
        return `🏟 <b>Tournament Starting Soon</b>\n"${payload.name}" begins in 30 minutes.`;
      case 'tournament_match_ready':
        return `⚔️ <b>Your Match is Ready</b>\nTournament: ${payload.tournamentName}\nRound ${payload.round} — Good luck!`;
      case 'tournament_result':
        return payload.won
          ? `🥇 <b>Tournament Winner!</b>\nYou won ${payload.payout} TON in "${payload.tournamentName}"!`
          : `🏟 <b>Tournament Complete</b>\nFinished position ${payload.position} in "${payload.tournamentName}".`;
      case 'server_crash_refund':
        return `🔄 <b>Game Refunded</b>\nYour stake of ${payload.amount} TON has been returned due to a server issue.`;
      default:
        return `CheckTON: ${type}`;
    }
  }
}
