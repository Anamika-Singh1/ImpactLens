import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { ComparisonsService } from './comparisons.service';
import type { Response } from 'express';
import { requestCancellation } from '../analysis-worker';

export class ComparisonDto {
  @IsUUID() baseSnapshotId!: string;
  @IsUUID() headSnapshotId!: string;
}
@Controller('workspaces/:workspaceId/repositories/:repositoryId/comparisons')
export class ComparisonsController {
  constructor(private readonly service: ComparisonsService) {}
  @Get()
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    return this.service.list({ workspaceId, repositoryId });
  }
  @Get(':analysisId')
  detail(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
  ) {
    return this.service.detail({ workspaceId, repositoryId }, analysisId);
  }
  @Post()
  @RequirePermission('analyses:manage')
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() input: ComparisonDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cancellation = requestCancellation(req, res);
    try {
      return await this.service.create(
        { workspaceId, repositoryId },
        input,
        req.authSession!.userId!,
        cancellation.signal,
      );
    } finally {
      cancellation.dispose();
    }
  }
}
