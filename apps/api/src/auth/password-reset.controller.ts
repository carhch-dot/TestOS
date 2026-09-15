import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

// Same defensive-guard posture as LoginController: generous upper bounds to
// reject obviously-malformed input cheaply, not real-world limits.
const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 1024;

// `forgot-password` always returns this exact response, whether or not the
// email belongs to a real ACTIVE account (FR5) — never revealing which.
export const FORGOT_PASSWORD_MESSAGE =
  'If an account with that email exists, a password reset token has been sent.';

// Unknown, already-used, expired, and malformed-input cases must all be
// indistinguishable to the caller — same message, same status.
export const RESET_PASSWORD_FAILED_MESSAGE =
  'Invalid or expired password reset token';

export class ForgotPasswordRequestDto {
  email!: string;
}

export class ForgotPasswordResponseDto {
  message!: string;
}

export class ResetPasswordRequestDto {
  token!: string;
  newPassword!: string;
}

export class ResetPasswordResponseDto {
  message!: string;
}

/**
 * `POST /auth/forgot-password` and `POST /auth/reset-password`. Both are
 * public — no `@Roles`/RBAC guard applies here, same posture as
 * login/logout/refresh (see spec Boundaries).
 */
@Controller('auth')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() body: ForgotPasswordRequestDto,
  ): Promise<ForgotPasswordResponseDto> {
    // Malformed input never gets a distinct response — it's simply treated
    // as "nothing to do" (same as an unknown email) rather than validated
    // separately, so it can never leak anything through a different status
    // or body shape.
    if (
      typeof body?.email === 'string' &&
      body.email.length > 0 &&
      body.email.length <= MAX_EMAIL_LENGTH
    ) {
      await this.passwordResetService.requestReset(body.email);
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: ResetPasswordRequestDto,
  ): Promise<ResetPasswordResponseDto> {
    if (
      typeof body?.token !== 'string' ||
      typeof body?.newPassword !== 'string' ||
      body.token.length === 0 ||
      body.token.length > MAX_TOKEN_LENGTH ||
      body.newPassword.length === 0 ||
      body.newPassword.length > MAX_PASSWORD_LENGTH
    ) {
      throw new UnauthorizedException(RESET_PASSWORD_FAILED_MESSAGE);
    }

    const succeeded = await this.passwordResetService.confirmReset(
      body.token,
      body.newPassword,
    );

    if (!succeeded) {
      throw new UnauthorizedException(RESET_PASSWORD_FAILED_MESSAGE);
    }

    return { message: 'Your password has been reset.' };
  }
}
