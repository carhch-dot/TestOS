import { SetMetadata } from '@nestjs/common';
import { UsuarioRole } from '@prisma/client';

// Metadata key `RolesGuard` reads back off the handler/class (AD-4).
export const ROLES_KEY = 'roles';

/**
 * `@Roles(...roles)` declares which `UsuarioRole`s may call a handler.
 * Purely declarative metadata — it does nothing by itself; `RolesGuard` is
 * what actually enforces it, and only on routes that also apply
 * `@UseGuards(JwtAuthGuard, RolesGuard)` (spec Boundaries: no global guard
 * yet, so an endpoint without both is unaffected by this decorator).
 */
export const Roles = (
  ...roles: UsuarioRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
