import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Length,
} from 'class-validator';
import type { Response } from 'express';
import { fixture } from '@impactlens/ingestion';
import { ImportsService } from './imports.service';
import { RequirePermission, type AuthRequest } from '../auth/security';
class BindDto {
  @Matches(/^\d{1,20}$/) installationId!: string;
}
class ImportDto {
  @IsIn(['FIXTURE', 'GITHUB']) source!: 'FIXTURE' | 'GITHUB';
  @IsOptional() @IsUUID() installationId?: string;
  @IsOptional() @Matches(/^\d{1,20}$/) repositoryId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\x00-\x20\\]+$/)
  branch?: string;
}
class AddRepositoryDto {
  @IsString() @Length(1, 2048) url!: string;
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\x00-\x20\\]*$/)
  branch?: string;
}
const pageNumber = (page?: string) =>
  Math.max(1, Math.min(100, Number.parseInt(page ?? '1', 10) || 1));
@Controller('workspaces/:workspaceId')
export class ImportsController {
  constructor(private readonly service: ImportsService) {}
  @Post('repositories/import')
  @RequirePermission('repositories:manage')
  addRepository(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Req() req: AuthRequest,
    @Body() body: AddRepositoryDto,
  ) {
    return this.service.addUrl(
      ws,
      req.authSession!.userId!,
      body.url,
      body.branch,
    );
  }
  @Get('github') status(
    @Param('workspaceId') ws: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.status(ws, req.authSession!.userId!);
  }
  @Post('github/authorize') @RequirePermission('repositories:manage') authorize(
    @Param('workspaceId') ws: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.start(ws, req);
  }
  @Get('github/available-installations')
  @RequirePermission('integrations:manage')
  available(@Req() req: AuthRequest, @Query('page') page?: string) {
    return this.service.available(req.authSession!.userId!, pageNumber(page));
  }
  @Post('github/installations') @RequirePermission('integrations:manage') bind(
    @Param('workspaceId') ws: string,
    @Req() req: AuthRequest,
    @Body() body: BindDto,
  ) {
    return this.service.bind(ws, req.authSession!.userId!, body.installationId);
  }
  @Get('github/installations/:id/repositories')
  @RequirePermission('repositories:manage')
  repositories(
    @Param('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
    @Query('page') page?: string,
  ) {
    return this.service.repositories(
      ws,
      req.authSession!.userId!,
      id,
      pageNumber(page),
    );
  }
  @Get('github/installations/:id/repositories/:repoId/branches')
  @RequirePermission('repositories:manage')
  branches(
    @Param('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repoId') repoId: string,
    @Req() req: AuthRequest,
    @Query('page') page?: string,
  ) {
    return this.service.branches(
      ws,
      req.authSession!.userId!,
      id,
      repoId,
      pageNumber(page),
    );
  }
  @Get('import-fixtures') fixtures() {
    return [fixture];
  }
  @Get('imports') jobs(@Param('workspaceId') ws: string) {
    return this.service.jobs(ws);
  }
  @Get('imports/:id') job(
    @Param('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.job(ws, id);
  }
  @Post('imports') @RequirePermission('repositories:manage') submit(
    @Param('workspaceId') ws: string,
    @Req() req: AuthRequest,
    @Body() body: ImportDto,
  ) {
    return this.service.submit(ws, req.authSession!.userId!, body);
  }
  @Post('imports/:id/cancel') @RequirePermission('repositories:manage') cancel(
    @Param('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.cancel(ws, id, req.authSession!.userId!);
  }
  @Post('imports/:id/retry') @RequirePermission('repositories:manage') retry(
    @Param('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.retry(ws, id, req.authSession!.userId!);
  }
}
@Controller('github')
export class GitHubCallbackController {
  constructor(private readonly service: ImportsService) {}
  @Get('callback') async callback(
    @Req() req: AuthRequest,
    @Query('state') state: string,
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    try {
      const workspaceId = await this.service.callback(
        state ?? '',
        code ?? '',
        req,
      );
      res.redirect(
        this.service.config.WEB_ORIGIN +
          '/settings?github=connected&workspaceId=' +
          encodeURIComponent(workspaceId),
      );
    } catch {
      res.redirect(this.service.config.WEB_ORIGIN + '/settings?github=failed');
    }
  }
}
