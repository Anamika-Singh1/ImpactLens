import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type Session } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { DatabaseService } from '../database.module';
import { readConfig } from '../config';
const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
@Injectable()
export class AuthService {
  readonly config = readConfig();
  readonly cookieName =
    this.config.NODE_ENV === 'production'
      ? '__Host-impactlens_session'
      : 'impactlens_session';
  // Unknown accounts still perform the same Argon2 verification.
  private dummyHash?: Promise<string>;
  constructor(private readonly db: DatabaseService) {}
  async lookup(token: unknown) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    return session;
  }
  csrfMatches(session: Session, supplied: unknown) {
    return (
      typeof supplied === 'string' &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      timingSafeEqual(Buffer.from(session.csrfToken), Buffer.from(supplied))
    );
  }
  private options() {
    return {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }
  clearCookie(response: Response) {
    response.clearCookie(this.cookieName, this.options());
  }
  private setCookie(response: Response, token: string, expires: Date) {
    response.cookie(this.cookieName, token, {
      ...this.options(),
      expires,
      maxAge: expires.getTime() - Date.now(),
    });
  }
  private newSession(userId: string | null) {
    const token = randomBytes(32).toString('hex');
    return {
      token,
      data: {
        userId,
        tokenHash: hashToken(token),
        csrfToken: randomBytes(32).toString('hex'),
        expiresAt: new Date(
          Date.now() +
            (userId ? this.config.SESSION_TTL_HOURS * 3600000 : 900000),
        ),
      },
    };
  }
  async csrf(existing: Session | undefined, response: Response) {
    if (existing) return { csrfToken: existing.csrfToken };
    await this.db.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const next = this.newSession(null);
    await this.db.session.create({ data: next.data });
    this.setCookie(response, next.token, next.data.expiresAt);
    return { csrfToken: next.data.csrfToken };
  }
  async current(session: Session) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: session.userId! },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaces: user.memberships.map((m) => ({
        ...m.workspace,
        role: m.role,
      })),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
  async register(
    input: { email: string; password: string; name: string },
    previous: Session,
    response: Response,
    requestId: string,
  ) {
    const passwordHash = await argon2.hash(input.password, passwordOptions);
    const next = this.newSession('pending');
    try {
      const session = await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email.toLowerCase().trim(),
            name: input.name.trim(),
            passwordHash,
          },
        });
        const workspace = await tx.workspace.create({
          data: {
            name: input.name.trim() + "'s workspace",
            memberships: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        await tx.auditEvent.create({
          data: {
            workspaceId: workspace.id,
            actorId: user.id,
            action: 'workspace.created',
            targetId: workspace.id,
            requestId,
          },
        });
        await tx.session.delete({ where: { id: previous.id } });
        return tx.session.create({ data: { ...next.data, userId: user.id } });
      });
      this.setCookie(response, next.token, session.expiresAt);
      return this.current(session);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2025'].includes(error.code)
      )
        throw new ConflictException('Unable to register with these details.');
      throw error;
    }
  }
  async login(
    input: { email: string; password: string },
    previous: Session,
    response: Response,
  ) {
    const user = await this.db.user.findUnique({
      where: { email: input.email.toLowerCase().trim() },
    });
    this.dummyHash ??= argon2.hash(
      randomBytes(32).toString('hex'),
      passwordOptions,
    );
    const valid = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    if (!user || !valid)
      throw new UnauthorizedException('Invalid email or password');
    const next = this.newSession(user.id);
    let session: Session;
    try {
      session = await this.db.$transaction(async (tx) => {
        await tx.session.delete({ where: { id: previous.id } });
        return tx.session.create({ data: next.data });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new UnauthorizedException('Session expired. Please try again.');
      throw error;
    }
    this.setCookie(response, next.token, session.expiresAt);
    return this.current(session);
  }
  async logout(session: Session, response: Response) {
    await this.db.session.deleteMany({ where: { id: session.id } });
    this.clearCookie(response);
  }
}
