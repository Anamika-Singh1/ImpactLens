import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@impactlens/shared';
import { DependenciesService } from './dependencies.service';
@Controller('health')
export class HealthController {
  constructor(private readonly dependencies: DependenciesService) {}
  @Get('live')
  live(): HealthResponse {
    return {
      status: 'ok',
      service: 'impactlens-api',
      timestamp: new Date().toISOString(),
    };
  }
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const dependencies = await this.dependencies.check();
    const ok = Object.values(dependencies).every((value) => value === 'up');
    response.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'unavailable',
      service: 'impactlens-api',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
