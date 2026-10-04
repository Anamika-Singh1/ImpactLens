import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { DeletionsService } from './deletions.service';
@Controller('workspaces/:workspaceId/repositories/:repositoryId')
export class DeletionsController {
  constructor(private readonly service: DeletionsService) {}
  @Delete()
  @HttpCode(204)
  @RequirePermission('workspace:manage')
  repository(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.repository(
      { workspaceId, repositoryId },
      req.authSession!.userId!,
    );
  }
  @Delete('test-evidence/artifacts/:artifactId')
  @HttpCode(204)
  @RequirePermission('analyses:manage')
  artifact(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('artifactId', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.artifact(
      { workspaceId, repositoryId },
      id,
      req.authSession!.userId!,
    );
  }
}
