import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { ExplanationsService } from './explanations.service';
export class AiConsentDto {
  @IsBoolean() enabled!: boolean;
}
@Controller('workspaces/:workspaceId')
export class ExplanationsController {
  constructor(private readonly service: ExplanationsService) {}
  @Get('ai-settings')
  settings(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.service.settings(workspaceId);
  }
  @Patch('ai-settings')
  @RequirePermission('workspace:manage')
  consent(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: AiConsentDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.setEnabled(
      workspaceId,
      body.enabled,
      req.authSession!.userId!,
    );
  }
  @Get('repositories/:repositoryId/comparisons/:analysisId/explanation')
  read(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
  ) {
    return this.service.explain({ workspaceId, repositoryId }, analysisId);
  }
  @Post('repositories/:repositoryId/comparisons/:analysisId/explanation')
  @RequirePermission('analyses:manage')
  generate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.explain(
      { workspaceId, repositoryId },
      analysisId,
      true,
      req.authSession!.userId!,
    );
  }
}
