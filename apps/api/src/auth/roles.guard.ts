import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsuarioRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Reads the `@Roles(...)` metadata off the handler (falling back to the
 * controller class) and rejects with `403` when `request.user.role` isn't in
 * the allowed list (AD-4). Must run after `JwtAuthGuard` in the same
 * `@UseGuards(...)` list so `request.user` is already populated — a handler
 * with no `@Roles` metadata at all is allowed through unconditionally (no
 * route currently omits it while using this guard, but this keeps the guard
 * safe to reuse standalone).
 *
 * SECURITY: fail-open-by-default is intentional but dangerous to copy
 * blindly — applying `@UseGuards(JwtAuthGuard, RolesGuard)` to a future
 * route and forgetting the accompanying `@Roles(...)` decorator does not
 * lock that route down at all; it lets every authenticated user through
 * regardless of role. Always pair this guard with `@Roles(...)`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UsuarioRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRole = request.user?.role;

    if (!userRole || !requiredRoles.includes(userRole as UsuarioRole)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    return true;
  }
}
