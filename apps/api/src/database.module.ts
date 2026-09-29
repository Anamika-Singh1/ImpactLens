import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
