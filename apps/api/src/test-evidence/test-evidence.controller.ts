import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { artifactFormats, type ArtifactFormat } from '@impactlens/shared';
import { RequirePermission, type AuthRequest } from '../auth/security';
import { TestEvidenceService } from './test-evidence.service';

export class ArtifactDto {
  @IsIn(artifactFormats) format!: ArtifactFormat;
  @Matches(/^[a-f0-9]{40}([a-f0-9]{24})?$/) commitSha!: string;
  @IsString() @Length(1, 100) @Matches(/\S/) runner!: string;
  @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d\d:\d\d)$/)
  recordedAt!: string;
  @IsString() @Length(1, 200) @Matches(/^[^\\/\x00-\x1f]+$/) filename!: string;
  @IsString() @Length(1, 1000) @Matches(/\S/) source!: string;
  @IsOptional() @IsString() @Length(1, 2000) sourceRoot?: string;
  @IsString() @Length(1, 2097152) content!: string;
}
export class EvidenceQuery {
  @IsOptional() @Matches(/^[a-f0-9]{40}([a-f0-9]{24})?$/) commitSha?: string;
}
export class TestMappingDto {
  @IsUUID() featureId!: string;
  @IsUUID() artifactId!: string;
  @IsString() @Length(1, 1000) testIdentity!: string;
  @IsString() @Length(1, 2000) @Matches(/\S/) rationale!: string;
}
@Controller('workspaces/:workspaceId/repositories/:repositoryId/test-evidence')
export class TestEvidenceController {
  constructor(private readonly service: TestEvidenceService) {}
  @Get('artifacts')
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Query() query: EvidenceQuery,
  ) {
    return this.service.list({ workspaceId, repositoryId }, query.commitSha);
  }
  @Get('artifacts/:artifactId')
  detail(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('artifactId', ParseUUIDPipe) id: string,
    @Query() query: EvidenceQuery,
  ) {
    return this.service.detail(
      { workspaceId, repositoryId },
      id,
      query.commitSha,
    );
  }
  @Post('artifacts')
  @RequirePermission('analyses:manage')
  import(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() body: ArtifactDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.import(
      { workspaceId, repositoryId },
      body,
      req.authSession!.userId!,
    );
  }
  @Get('mappings')
  mappings(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    return this.service.mappings({ workspaceId, repositoryId });
  }
  @Post('mappings')
  @RequirePermission('features:manage')
  map(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() body: TestMappingDto,
    @Req() req: AuthRequest,
  ) {
    return this.service.map(
      { workspaceId, repositoryId },
      body,
      req.authSession!.userId!,
    );
  }
  @Delete('mappings/:mappingId')
  @RequirePermission('features:manage')
  unmap(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('mappingId', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.unmap(
      { workspaceId, repositoryId },
      id,
      req.authSession!.userId!,
    );
  }
}
