import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database.module';
import { allowed, type AuthRequest, type Permission } from './security';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>('skipSession', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context.switchToHttp().getResponse();
    const session = await this.auth.lookup(
      request.cookies?.[this.auth.cookieName],
    );
    if (session) request.authSession = session;
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic && !session?.userId)
      throw new UnauthorizedException('Authentication required');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.header('origin') !== this.auth.config.WEB_ORIGIN ||
        !session ||
        !this.auth.csrfMatches(session, request.header('x-csrf-token'))
      )
        throw new ForbiddenException('Invalid CSRF token or origin');
    }
    if (request.path.startsWith('/api/auth') || session)
      response.setHeader('Cache-Control', 'no-store');
    const workspaceId = request.params.workspaceId;
    if (workspaceId) {
      if (typeof workspaceId !== 'string' || !isUUID(workspaceId))
        throw new NotFoundException('Workspace not found');
      const membership = await this.db.membership.findUnique({
        where: {
          workspaceId_userId: { workspaceId, userId: session!.userId! },
        },
      });
      if (!membership) throw new NotFoundException('Workspace not found');
      const permission =
        this.reflector.getAllAndOverride<Permission>('permission', [
          context.getHandler(),
          context.getClass(),
        ]) ?? 'workspace:read';
      if (!allowed(membership.role, permission))
        throw new ForbiddenException('Insufficient workspace permissions');
      // Even an accidentally undecorated mutation cannot grant a Viewer write access.
      if (
        membership.role === 'VIEWER' &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      )
        throw new ForbiddenException('Read-only workspace access');
      request.workspaceRole = membership.role;
    }
    return true;
  }
}
