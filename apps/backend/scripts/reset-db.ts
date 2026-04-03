/**
 * reset-db.ts — Wipe all data, keep schema
 * Usage: npx tsx scripts/reset-db.ts
 * WARNING: Deletes ALL data. Development/testing only.
 */
import 'dotenv/config';
import pool from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

async function reset() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Cannot run reset in production. Set NODE_ENV=development.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('⚠️  Wiping all data...');
    // Truncate in dependency order — CASCADE handles the rest
    await client.query(`
      TRUNCATE
        crash_log,
        notifications,
        tournament_matches,
        tournament_participants,
        tournaments,
        matchmaking_queue,
        transactions,
        balances,
        games,
        users
      RESTART IDENTITY CASCADE
    `);
    console.log('✅ All data wiped. Schema intact.');
  } finally {
    client.release();
    await pool.end();
  }
}

reset().catch(err => { console.error(err); process.exit(1); });
