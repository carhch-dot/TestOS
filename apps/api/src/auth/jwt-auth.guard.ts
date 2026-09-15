import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

// The exact claim shape `LoginService`/`RenewalService` sign into every
// access token (`sub`/`email`/`role`) — see login.service.ts's `signAsync`
// call. `JwtAuthGuard` must parse it identically.
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
}

export type AuthenticatedRequest = Request & { user?: AccessTokenClaims };

/**
 * Verifies the `Authorization: Bearer <token>` access token and attaches its
 * claims straight to `request.user` — no DB round-trip per request, matching
 * the existing short-lived-JWT design (spec Boundaries; see
 * `RenewalService`'s own comment: claims go stale by design, refreshed only
 * at renewal). Missing, malformed, invalid, or expired tokens are all
 * rejected the same way: a generic 401.
 *
 * Applied only via explicit `@UseGuards(...)` on routes that opt in — there
 * is no global `APP_GUARD` wiring (spec Boundaries), so every pre-existing
 * public endpoint is unaffected.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenClaims>(token);
      request.user = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers?.authorization;
    if (typeof header !== 'string') {
      return undefined;
    }

    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) {
      return undefined;
    }

    return value;
  }
}
