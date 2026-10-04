import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestCancellation } from '../analysis-worker';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RepositoryOverviewService } from './repository-overview.service';
class DetailsQuery {
  @IsOptional() @IsUUID() snapshotId?: string;
  @IsOptional() @IsUUID() jobId?: string;
}
class SearchQuery extends DetailsQuery {
  @IsString() @Length(1, 200) q!: string;
}
@Controller('workspaces/:workspaceId/repositories/:repositoryId')
export class RepositoryOverviewController {
  constructor(private readonly service: RepositoryOverviewService) {}
  @Get('details') details(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Query() query: DetailsQuery,
  ) {
    return this.service.details(ws, repo, query.snapshotId, query.jobId);
  }
  @Get('overview') overview(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Query() query: DetailsQuery,
  ) {
    return this.service.overview(ws, repo, query.snapshotId);
  }
  @Get('dependencies') dependencies(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Query() query: DetailsQuery,
  ) {
    return this.service.section(ws, repo, query.snapshotId, 'dependencies');
  }
  @Get('routes') routes(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Query() query: DetailsQuery,
  ) {
    return this.service.section(ws, repo, query.snapshotId, 'routes');
  }
  @Get('implementation-search') async search(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Query() query: SearchQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cancellation = requestCancellation(req, res);
    try {
      return await this.service.search(
        ws,
        repo,
        query.snapshotId,
        query.q,
        cancellation.signal,
      );
    } finally {
      cancellation.dispose();
    }
  }
}
