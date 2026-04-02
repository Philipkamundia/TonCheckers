#!/usr/bin/env tsx
/**
 * Development seed script
 * Usage: npm run seed
 * Creates 5 test users with balances and sample data
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TEST_USERS = [
  { wallet: 'EQD_test_wallet_1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', username: 'DarkKnight_447', elo: 1450 },
  { wallet: 'EQD_test_wallet_2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', username: 'SwiftFox_812',   elo: 1200 },
  { wallet: 'EQD_test_wallet_3_cccccccccccccccccccccccccccccc', username: 'IronEagle_293',  elo: 1875 },
  { wallet: 'EQD_test_wallet_4_dddddddddddddddddddddddddddddd', username: 'ColdWolf_561',   elo: 950  },
  { wallet: 'EQD_test_wallet_5_eeeeeeeeeeeeeeeeeeeeeeeeeeeeee', username: 'NeonViper_104',  elo: 2250 },
];

async function seed() {
  const client = await pool.connect();

  try {
    console.log('🌱 Seeding development database...\n');

    await client.query('BEGIN');

    // Clear existing seed data
    await client.query(`DELETE FROM users WHERE wallet_address LIKE 'EQD_test_%'`);

    for (const u of TEST_USERS) {
      // Insert user
      const gamesWon  = Math.floor(Math.random() * 30) + 5;
      const gamesLost = Math.floor(Math.random() * 15) + 2;
      const { rows: [user] } = await client.query(
        `INSERT INTO users (wallet_address, username, elo, games_played, games_won, games_lost, total_won)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [u.wallet, u.username, u.elo,
         gamesWon + gamesLost,
         gamesWon,
         gamesLost,
         (Math.random() * 50).toFixed(9),
        ]
      );

      // Insert balance
      await client.query(
        `INSERT INTO balances (user_id, available, locked)
         VALUES ($1, $2, 0)`,
        [user.id, (Math.random() * 20 + 1).toFixed(9)]
      );

      // Insert a sample confirmed deposit
      const txHash = crypto.randomBytes(32).toString('hex');
      await client.query(
        `INSERT INTO transactions (user_id, type, status, amount, ton_tx_hash, memo)
         VALUES ($1, 'deposit', 'confirmed', $2, $3, $4)`,
        [user.id, (Math.random() * 5 + 0.5).toFixed(9), txHash, user.id]
      );

      console.log(`  ✅ ${u.username} (ELO: ${u.elo})`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed complete. 5 test users created with balances and deposits.');
    console.log('\nTest wallets start with EQD_test_ — safe to re-run, they are wiped first.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
