import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

// A real refresh token is always 64 hex characters (RefreshTokenService.issue).
// This is a generous upper bound, not a real limit — same defensive posture
// as LoginController's MAX_EMAIL_LENGTH/MAX_PASSWORD_LENGTH.
const MAX_REFRESH_TOKEN_LENGTH = 512;

export class LogoutRequestDto {
  refreshToken!: string;
}

/**
 * `POST /auth/logout`. No `@Roles`/RBAC guard — possession of the refresh
 * token itself is what is being invalidated (FR3). Always responds `204`,
 * whether the token existed, was already revoked, or never matched
 * anything, so it never reveals token state.
 */
@Controller('auth')
export class LogoutController {
  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: LogoutRequestDto): Promise<void> {
    if (
      typeof body?.refreshToken === 'string' &&
      body.refreshToken.length > 0 &&
      body.refreshToken.length <= MAX_REFRESH_TOKEN_LENGTH
    ) {
      await this.refreshTokenService.revoke(body.refreshToken);
    }
  }
}
