import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UsuarioRole } from '@prisma/client';
import { InviteService } from './invite.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

// Same defensive-guard posture as LoginController/PasswordResetController:
// generous upper bounds to reject obviously-malformed input cheaply, not
// real-world limits.
const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 1024;

// Cheap shape check only — requires an `@` with a non-empty local part and
// domain part, so a whitespace-only string (which collapses to `""` after
// `normalizeEmail`'s trim) is rejected here instead of persisting an
// unrecoverable empty-email Usuario row (no delete-user feature exists).
// Not a full RFC 5322 validator, same posture as the length caps above.
const EMAIL_SHAPE_PATTERN = /^[^\s@]+@[^\s@]+$/;

export const INVITE_SUCCESS_MESSAGE = 'Invitation sent.';

export const INVALID_INVITE_REQUEST_MESSAGE = 'Invalid email or role';

// Unknown, already-used, expired, and malformed-input cases must all be
// indistinguishable to the caller — same message, same status.
export const ACTIVATE_FAILED_MESSAGE = 'Invalid or expired activation token';

export class InviteRequestDto {
  email!: string;
  role!: UsuarioRole;
}

export class InviteResponseDto {
  message!: string;
}

export class ActivateRequestDto {
  token!: string;
  password!: string;
}

export class ActivateResponseDto {
  message!: string;
}

/**
 * `POST /auth/invite` (RBAC-protected: Manager or Administrator only) and
 * `POST /auth/activate` (public) — bundled in one controller the same way
 * `PasswordResetController` bundles `forgot-password`/`reset-password`, one
 * cohesive flow rather than two controllers (spec Design Notes).
 */
@Controller('auth')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UsuarioRole.MANAGER, UsuarioRole.ADMINISTRATOR)
  @HttpCode(HttpStatus.OK)
  async invite(@Body() body: InviteRequestDto): Promise<InviteResponseDto> {
    if (
      typeof body?.email !== 'string' ||
      body.email.length === 0 ||
      body.email.length > MAX_EMAIL_LENGTH ||
      !EMAIL_SHAPE_PATTERN.test(body.email.trim()) ||
      typeof body?.role !== 'string' ||
      !Object.values(UsuarioRole).includes(body.role)
    ) {
      throw new BadRequestException(INVALID_INVITE_REQUEST_MESSAGE);
    }

    await this.inviteService.invite(body.email, body.role);

    return { message: INVITE_SUCCESS_MESSAGE };
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Body() body: ActivateRequestDto,
  ): Promise<ActivateResponseDto> {
    if (
      typeof body?.token !== 'string' ||
      typeof body?.password !== 'string' ||
      body.token.length === 0 ||
      body.token.length > MAX_TOKEN_LENGTH ||
      body.password.length === 0 ||
      body.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new UnauthorizedException(ACTIVATE_FAILED_MESSAGE);
    }

    const succeeded = await this.inviteService.activate(
      body.token,
      body.password,
    );

    if (!succeeded) {
      throw new UnauthorizedException(ACTIVATE_FAILED_MESSAGE);
    }

    return { message: 'Your account has been activated. You can now log in.' };
  }
}
