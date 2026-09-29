import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Session, Role } from '@prisma/client';
export const Public = () => SetMetadata('public', true);
export const permissions = {
  'workspace:read': ['OWNER', 'ENGINEER', 'VIEWER'],
  'workspace:manage': ['OWNER'],
  'integrations:manage': ['OWNER'],
  'repositories:manage': ['OWNER', 'ENGINEER'],
  'features:manage': ['OWNER', 'ENGINEER'],
  'analyses:manage': ['OWNER', 'ENGINEER'],
  'reviews:write': ['OWNER', 'ENGINEER'],
} as const;
export type Permission = keyof typeof permissions;
export function allowed(role: Role, permission: Permission) {
  return (permissions[permission] as readonly string[]).includes(role);
}
export const RequirePermission = (permission: Permission) =>
  SetMetadata('permission', permission);
export interface AuthRequest extends Request {
  authSession?: Session;
  workspaceRole?: Role;
}
