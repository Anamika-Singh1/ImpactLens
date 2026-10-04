import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { FeaturesService } from './features.service';
import {
  EditMappingDto,
  FeatureDto,
  MappingDto,
  ReviewMappingDto,
  SnapshotDto,
  SnapshotQuery,
  UpdateFeatureDto,
} from './features.dto';
@Controller('workspaces/:workspaceId/repositories/:repositoryId/features')
export class FeaturesController {
  constructor(private readonly service: FeaturesService) {}
  // Repository IDs are validated on every route, workspace membership by AuthGuard.
  @Get()
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    return this.service.list({ workspaceId, repositoryId });
  }
  @Post()
  @RequirePermission('features:manage')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() body: FeatureDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.create(
      { workspaceId, repositoryId },
      body,
      req.authSession!.userId!,
    );
  }
  @Get(':featureId')
  detail(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Query() query: SnapshotQuery,
  ) {
    return this.service.detail(
      { workspaceId, repositoryId },
      featureId,
      query.snapshotId,
    );
  }
  @Patch(':featureId')
  @RequirePermission('features:manage')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() body: UpdateFeatureDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.update(
      { workspaceId, repositoryId },
      featureId,
      body,
      req.authSession!.userId!,
    );
  }
  @Post(':featureId/mappings')
  @RequirePermission('features:manage')
  manual(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() body: MappingDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.manual(
      { workspaceId, repositoryId },
      featureId,
      body,
      req.authSession!.userId!,
    );
  }
  @Patch(':featureId/mappings/:mappingId')
  @RequirePermission('features:manage')
  edit(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @Body() body: EditMappingDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.edit(
      { workspaceId, repositoryId },
      featureId,
      mappingId,
      body,
      req.authSession!.userId!,
    );
  }
  @Post(':featureId/mappings/:mappingId/review')
  @RequirePermission('features:manage')
  review(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @Body() body: ReviewMappingDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.review(
      { workspaceId, repositoryId },
      featureId,
      mappingId,
      body,
      req.authSession!.userId!,
    );
  }
  @Post(':featureId/suggestions')
  @RequirePermission('features:manage')
  suggest(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() body: SnapshotDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.suggest(
      { workspaceId, repositoryId },
      featureId,
      body.snapshotId,
      req.authSession!.userId!,
    );
  }
}
