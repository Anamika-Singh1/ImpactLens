import {
  HttpException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { readConfig } from '../config';
@Injectable()
export class AuthRateLimit implements OnModuleDestroy {
  private readonly prefix = readConfig().AUTH_RATE_LIMIT_PREFIX;
  private readonly redis = new Redis(readConfig().REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
  private readonly initialConnection: Promise<void>;
  constructor() {
    this.redis.on('error', () => {});
    this.initialConnection = this.redis
      .connect()
      .then(() => {})
      .catch(() => {});
  }
  async consume(bucket: string, identity: string, limit: number) {
    await this.initialConnection;
    const hash = createHash('sha256').update(identity).digest('hex');
    let count: number;
    try {
      count = Number(
        await this.redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n",
          1,
          this.prefix + ':' + bucket + ':' + hash,
        ),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Authentication temporarily unavailable',
      );
    }
    if (count > limit)
      throw new HttpException(
        'Too many authentication attempts. Try again later.',
        429,
      );
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
