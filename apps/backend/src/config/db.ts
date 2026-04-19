import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

function buildConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;

  try {
    const parsed = new URL(raw);

    // Railway/Postgres proxy often presents cert chains that fail strict validation.
    // Force explicit non-strict SSL mode in production to avoid runtime boot loops.
    if (process.env.NODE_ENV === 'production') {
      parsed.searchParams.set('sslmode', 'no-verify');
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, fall back to the raw connection string.
    return raw;
  }
}

export const pool = new Pool({
  connectionString: buildConnectionString(),
  max: parseInt(process.env.DB_POOL_MAX || '100', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,  // increased for Railway cold starts
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Log but don't exit — the pool will attempt to recover the connection
  logger.error(`Unexpected error on idle PostgreSQL client: ${err.message}`);
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

export default pool;
