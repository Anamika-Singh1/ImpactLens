import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { ExplorerService } from './explorer.service';
import type { Response } from 'express';
import { requestCancellation } from '../analysis-worker';
@Controller('workspaces/:workspaceId/repositories/:repositoryId/snapshots')
export class ExplorerController {
  constructor(private readonly service: ExplorerService) {}
  @Get()
  snapshots(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
  ) {
    return this.service.snapshots(ws, repo);
  }
  @Get(':snapshotId/graph')
  graph(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Param('snapshotId', ParseUUIDPipe) snapshot: string,
  ) {
    return this.service.graph(ws, repo, snapshot);
  }
  @Post(':snapshotId/graph')
  @RequirePermission('analyses:manage')
  async analyze(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Param('snapshotId', ParseUUIDPipe) snapshot: string,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cancellation = requestCancellation(req, res);
    try {
      return await this.service.analyze(
        ws,
        repo,
        snapshot,
        req.authSession!.userId!,
        cancellation.signal,
      );
    } finally {
      cancellation.dispose();
    }
  }
  @Get(':snapshotId/files')
  files(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Param('snapshotId', ParseUUIDPipe) snapshot: string,
  ) {
    return this.service.files(ws, repo, snapshot);
  }
  @Get(':snapshotId/files/:fileId')
  source(
    @Param('workspaceId', ParseUUIDPipe) ws: string,
    @Param('repositoryId', ParseUUIDPipe) repo: string,
    @Param('snapshotId', ParseUUIDPipe) snapshot: string,
    @Param('fileId', ParseUUIDPipe) file: string,
  ) {
    return this.service.source(ws, repo, snapshot, file);
  }
}
