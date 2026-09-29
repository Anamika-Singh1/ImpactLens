import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimit } from './rate-limit.service';
import { AuthGuard } from './auth.guard';
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimit,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
