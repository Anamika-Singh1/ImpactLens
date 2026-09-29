import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { DatabaseService } from '../database.module';
import { RequirePermission, type AuthRequest } from '../auth/security';
class WorkspaceDto {
  @IsString() @Length(1, 100) @Matches(/\S/) name!: string;
}
class MemberDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsIn(['ENGINEER', 'VIEWER']) role!: 'ENGINEER' | 'VIEWER';
}
class RoleDto {
  @IsIn(['ENGINEER', 'VIEWER']) role!: 'ENGINEER' | 'VIEWER';
}
class RepositoryDto {
  @IsString() @Length(1, 100) @Matches(/^[a-zA-Z0-9_.-]+$/) owner!: string;
  @IsString() @Length(1, 100) @Matches(/^[a-zA-Z0-9_.-]+$/) name!: string;
}
class FeatureDto {
  @IsString() @Length(1, 100) @Matches(/^[a-zA-Z0-9_.-]+$/) key!: string;
  @IsString() @Length(1, 150) @Matches(/\S/) name!: string;
}
class MappingDto {
  @IsUUID() snapshotId!: string;
  @IsUUID() fileId!: string;
  @IsString() @Length(1, 2000) @Matches(/\S/) rationale!: string;
}
class AnalysisDto {
  @IsUUID() baseSnapshotId!: string;
  @IsUUID() headSnapshotId!: string;
}
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly db: DatabaseService) {}
  private audit(
    request: AuthRequest,
    response: Response,
    workspaceId: string,
    action: string,
    targetId: string,
    repositoryId?: string,
  ) {
    return {
      workspaceId,
      actorId: request.authSession!.userId!,
      action,
      targetId,
      repositoryId,
      requestId: response.locals.requestId as string,
    };
  }
  private async repository(workspaceId: string, id: string) {
    const result = await this.db.repository.findFirst({
      where: { id, workspaceId },
    });
    if (!result) throw new NotFoundException('Repository not found');
    return result;
  }
  @Get()
  list(@Req() request: AuthRequest) {
    return this.db.membership.findMany({
      where: { userId: request.authSession!.userId! },
      select: { role: true, workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
  @Get(':workspaceId')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() request: AuthRequest,
  ) {
    return this.db.workspace
      .findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true, createdAt: true },
      })
      .then((workspace) => ({ ...workspace, role: request.workspaceRole }));
  }
  @Patch(':workspaceId')
  @RequirePermission('workspace:manage')
  async update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() input: WorkspaceDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.workspace.update({
        where: { id: workspaceId },
        data: { name: input.name.trim() },
      });
      await tx.auditEvent.create({
        data: this.audit(
          request,
          response,
          workspaceId,
          'workspace.updated',
          workspaceId,
        ),
      });
      return result;
    });
  }
  @Get(':workspaceId/members')
  members(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.db.membership.findMany({
      where: { workspaceId },
      select: {
        role: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }
  @Post(':workspaceId/members')
  @RequirePermission('workspace:manage')
  async addMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() input: MemberDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    });
    if (!user) throw new NotFoundException('Registered user not found');
    try {
      return await this.db.$transaction(async (tx) => {
        const member = await tx.membership.create({
          data: { workspaceId, userId: user.id, role: input.role },
        });
        await tx.auditEvent.create({
          data: this.audit(
            request,
            response,
            workspaceId,
            'membership.added',
            user.id,
          ),
        });
        return member;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('User is already a workspace member');
      throw error;
    }
  }
  @Patch(':workspaceId/members/:userId')
  @RequirePermission('workspace:manage')
  async changeRole(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: RoleDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.membership.updateMany({
        where: { workspaceId, userId, role: { not: 'OWNER' } },
        data: { role: input.role },
      });
      if (!result.count)
        throw new NotFoundException('Editable membership not found');
      await tx.auditEvent.create({
        data: this.audit(
          request,
          response,
          workspaceId,
          'membership.role_changed',
          userId,
        ),
      });
      return { userId, role: input.role };
    });
  }
  @Delete(':workspaceId/members/:userId')
  @RequirePermission('workspace:manage')
  @HttpCode(204)
  async removeMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.db.$transaction(async (tx) => {
      const result = await tx.membership.deleteMany({
        where: { workspaceId, userId, role: { not: 'OWNER' } },
      });
      if (!result.count)
        throw new NotFoundException('Removable membership not found');
      await tx.auditEvent.create({
        data: this.audit(
          request,
          response,
          workspaceId,
          'membership.removed',
          userId,
        ),
      });
    });
  }
  @Get(':workspaceId/repositories')
  repositories(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.db.repository.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get(':workspaceId/repositories/:repositoryId')
  repositoryById(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    return this.repository(workspaceId, repositoryId);
  }
  @Post(':workspaceId/repositories')
  @RequirePermission('repositories:manage')
  async createRepository(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() input: RepositoryDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const repo = await tx.repository.create({
          data: {
            workspaceId,
            owner: input.owner.toLowerCase(),
            name: input.name.toLowerCase(),
          },
        });
        await tx.auditEvent.create({
          data: this.audit(
            request,
            response,
            workspaceId,
            'repository.registered',
            repo.id,
            repo.id,
          ),
        });
        return repo;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Repository already registered in this workspace',
        );
      throw error;
    }
  }
  @Get(':workspaceId/repositories/:repositoryId/features')
  async features(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    await this.repository(workspaceId, repositoryId);
    return this.db.businessFeature.findMany({
      where: { workspaceId, repositoryId },
      include: { mappings: true },
    });
  }
  @Post(':workspaceId/repositories/:repositoryId/features')
  @RequirePermission('features:manage')
  async createFeature(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() input: FeatureDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.repository(workspaceId, repositoryId);
    try {
      return await this.db.$transaction(async (tx) => {
        const feature = await tx.businessFeature.create({
          data: {
            workspaceId,
            repositoryId,
            key: input.key,
            name: input.name.trim(),
          },
        });
        await tx.auditEvent.create({
          data: this.audit(
            request,
            response,
            workspaceId,
            'feature.created',
            feature.id,
            repositoryId,
          ),
        });
        return feature;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Feature key already exists');
      throw error;
    }
  }
  @Post(':workspaceId/repositories/:repositoryId/features/:featureId/mappings')
  @RequirePermission('features:manage')
  async createMapping(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Param('featureId', ParseUUIDPipe) featureId: string,
    @Body() input: MappingDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const feature = await this.db.businessFeature.findFirst({
      where: { id: featureId, workspaceId, repositoryId },
    });
    const file = await this.db.sourceFile.findFirst({
      where: {
        id: input.fileId,
        snapshotId: input.snapshotId,
        workspaceId,
        repositoryId,
      },
    });
    if (!feature || !file)
      throw new NotFoundException('Feature or source file not found');
    try {
      return await this.db.$transaction(async (tx) => {
        const mapping = await tx.featureMapping.create({
          data: { ...input, workspaceId, repositoryId, featureId },
        });
        await tx.auditEvent.create({
          data: this.audit(
            request,
            response,
            workspaceId,
            'feature.mapping_created',
            mapping.id,
            repositoryId,
          ),
        });
        return mapping;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Mapping already exists');
      throw error;
    }
  }
  @Get(':workspaceId/repositories/:repositoryId/analyses')
  async analyses(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ) {
    await this.repository(workspaceId, repositoryId);
    return this.db.analysis.findMany({
      where: { workspaceId, repositoryId },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post(':workspaceId/repositories/:repositoryId/analyses')
  @RequirePermission('analyses:manage')
  async draftAnalysis(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() input: AnalysisDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.repository(workspaceId, repositoryId);
    const ids = [...new Set([input.baseSnapshotId, input.headSnapshotId])];
    const count = await this.db.repositorySnapshot.count({
      where: { workspaceId, repositoryId, id: { in: ids } },
    });
    if (count !== ids.length) throw new NotFoundException('Snapshot not found');
    return this.db.$transaction(async (tx) => {
      const analysis = await tx.analysis.create({
        data: { workspaceId, repositoryId, ...input, status: 'DRAFT' },
      });
      await tx.auditEvent.create({
        data: this.audit(
          request,
          response,
          workspaceId,
          'analysis.draft_created',
          analysis.id,
          repositoryId,
        ),
      });
      return analysis;
    });
  }
  @Get(':workspaceId/audit-events')
  @RequirePermission('workspace:manage')
  auditEvents(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.db.auditEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
