import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionService, type Identity } from './auth-session.service';

const publicKey = Symbol('publicRoute');
const rolesKey = Symbol('platformRoles');

export const Public = () => SetMetadata(publicKey, true);
export const RequireRoles = (...roles: PlatformRole[]) => SetMetadata(rolesKey, roles);
export type AuthenticatedRequest = Request & { identity?: Identity };

export function identityFrom(context: ExecutionContext): Identity {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.identity) throw new UnauthorizedException();
  return request.identity;
}

export const CurrentIdentity = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  identityFrom(context),
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(publicKey, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match?.[1]) throw new UnauthorizedException('A bearer access token is required');

    request.identity = await this.sessions.authenticate(match[1]);
    return true;
  }
}

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<PlatformRole[]>(rolesKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const { user } = identityFrom(context);
    if (!roles.some((role) => user.roles.includes(role))) throw new ForbiddenException();
    return true;
  }
}
