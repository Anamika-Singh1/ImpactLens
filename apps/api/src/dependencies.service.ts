import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { readConfig } from './config';

async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Dependency check timed out')),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
@Injectable()
export class DependenciesService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  private readonly redis = new Redis(readConfig().REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
  });
  constructor() {
    this.redis.on('error', () => {});
    void this.redis.connect().catch(() => {});
  }
  async check() {
    const results = await Promise.allSettled([
      bounded(this.prisma.$queryRaw`SELECT 1`),
      bounded(this.redis.ping()),
    ]);
    return {
      postgres:
        results[0].status === 'fulfilled' ? ('up' as const) : ('down' as const),
      redis:
        results[1].status === 'fulfilled' ? ('up' as const) : ('down' as const),
    };
  }
  async onModuleDestroy() {
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
}
