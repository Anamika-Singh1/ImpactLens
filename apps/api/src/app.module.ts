import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DependenciesService } from './dependencies.service';
@Module({ controllers: [HealthController], providers: [DependenciesService] })
export class AppModule {}
