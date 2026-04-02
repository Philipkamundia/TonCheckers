import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  logger.error(`Redis connection error: ${err.message}`);
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export default redis;
