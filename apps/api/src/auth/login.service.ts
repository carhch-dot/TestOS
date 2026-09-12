import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../common/normalize-email';
import { RefreshTokenService } from './refresh-token.service';

// Wrong password, unknown email, and a non-ACTIVE status must all be
// indistinguishable to the caller (I/O matrix) — same message, same shape.
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

// A fixed, valid argon2 hash with no corresponding real account. When the
// email lookup misses, we still run argon2.verify against this instead of
// short-circuiting, so an unknown email pays the same argon2 cost as a wrong
// password — otherwise the response-time gap would reveal account existence
// even though the response bodies are identical.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$aM53NTpDwqia4XfBPzTUqw$zji5LvDh4kW7A0gEELC7EG8tEV1BTmEhO9cOPSf9Ew0';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Verifies email + password against the stored `argon2` hash and, on
 * success, issues a short-lived JWT access token plus a persisted, hashed
 * refresh token (AD-5). Implements FR1.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizeEmail(email) },
    });

    // Always run argon2.verify — against the real hash when the user exists,
    // or a fixed dummy hash when they don't — so an unknown email takes the
    // same time as a wrong password and never reveals account existence via
    // a timing gap.
    const passwordMatches = await argon2.verify(
      usuario?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );

    // Unknown email, wrong password, and a non-ACTIVE status (checked only
    // after paying the same argon2 cost) all fail with the exact same
    // generic error — never revealing which.
    if (
      !usuario ||
      !passwordMatches ||
      usuario.status !== UsuarioStatus.ACTIVE
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const accessToken = await this.jwtService.signAsync({
      sub: usuario.id,
      email: usuario.email,
      role: usuario.role,
    });
    const refreshToken = await this.refreshTokenService.issue(usuario.id);

    return { accessToken, refreshToken };
  }
}
