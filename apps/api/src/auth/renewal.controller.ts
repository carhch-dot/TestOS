import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { RenewalService, REFRESH_FAILED_MESSAGE } from './renewal.service';

// A real refresh token is always 64 hex characters (RefreshTokenService.issue).
// Generous upper bound, not a real limit — same defensive posture as
// LoginController's MAX_EMAIL_LENGTH/MAX_PASSWORD_LENGTH and
// LogoutController's MAX_REFRESH_TOKEN_LENGTH.
const MAX_REFRESH_TOKEN_LENGTH = 512;

export class RefreshRequestDto {
  refreshToken!: string;
}

export class RefreshResponseDto {
  accessToken!: string;
  refreshToken!: string;
}

/**
 * `POST /auth/refresh` (FR4). Public — no `@Roles`/RBAC guard, same posture
 * as login/logout: possession of the refresh token itself is the credential
 * being exchanged.
 */
@Controller('auth')
export class RenewalController {
  constructor(private readonly renewalService: RenewalService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshRequestDto): Promise<RefreshResponseDto> {
    // Malformed input (missing/non-string/empty/oversized) fails the same
    // generic way as any other rejected refresh — never a distinct error.
    if (
      typeof body?.refreshToken !== 'string' ||
      body.refreshToken.length === 0 ||
      body.refreshToken.length > MAX_REFRESH_TOKEN_LENGTH
    ) {
      throw new UnauthorizedException(REFRESH_FAILED_MESSAGE);
    }

    return this.renewalService.renew(body.refreshToken);
  }
}
