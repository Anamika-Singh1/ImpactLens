import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DependenciesService } from './dependencies.service';
import { DatabaseModule } from './database.module';
import { AuthModule } from './auth/auth.module';
import { WorkspacesController } from './workspaces/workspaces.controller';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HealthController, WorkspacesController],
  providers: [DependenciesService],
})
export class AppModule {}
