import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from './jwt-auth.guard';

function makeContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('JwtAuthGuard', () => {
  let jwtService: { verifyAsync: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    guard = new JwtAuthGuard(jwtService as never);
  });

  it('attaches the verified claims (sub/email/role) to request.user and allows the request through', async () => {
    const claims = {
      sub: 'user-1',
      email: 'user@example.com',
      role: 'MANAGER',
    };
    jwtService.verifyAsync.mockResolvedValue(claims);
    const { context, request } = makeContext({
      authorization: 'Bearer a-valid-token',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('a-valid-token');
    expect(request.user).toEqual(claims);
  });

  it('rejects with 401 when the Authorization header is missing', async () => {
    const { context } = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the Authorization header has no Bearer scheme', async () => {
    const { context } = makeContext({ authorization: 'Basic a-valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the Bearer scheme has no token value', async () => {
    const { context } = makeContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the token is invalid or expired', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const { context, request } = makeContext({
      authorization: 'Bearer an-expired-token',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });
});
