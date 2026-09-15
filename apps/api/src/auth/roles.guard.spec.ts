import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsuarioRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { AuthenticatedRequest } from './jwt-auth.guard';

function makeContext(user: { role: string } | undefined): ExecutionContext {
  const request = { user } as unknown as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request through when request.user.role is in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UsuarioRole.MANAGER,
      UsuarioRole.ADMINISTRATOR,
    ]);
    const context = makeContext({ role: UsuarioRole.MANAGER });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects with 403 when request.user.role is not in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UsuarioRole.MANAGER,
      UsuarioRole.ADMINISTRATOR,
    ]);
    const context = makeContext({ role: UsuarioRole.EDITOR });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects with 403 when request.user.role is Read-only', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UsuarioRole.MANAGER,
      UsuarioRole.ADMINISTRATOR,
    ]);
    const context = makeContext({ role: UsuarioRole.READ_ONLY });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects with 403 when there is no request.user at all (unauthenticated slipping through)', () => {
    reflector.getAllAndOverride.mockReturnValue([UsuarioRole.MANAGER]);
    const context = makeContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows the request through when no @Roles metadata is present at all', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when @Roles metadata is an empty list', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });
});
