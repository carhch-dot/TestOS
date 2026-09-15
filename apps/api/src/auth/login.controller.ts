import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginService, INVALID_CREDENTIALS_MESSAGE } from './login.service';

// Generous upper bounds to reject obviously-malformed input before it reaches
// argon2.verify — not a real-world email/password length limit, just a
// cheap guard. RFC 5321 caps an email address at 254 characters.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;

export class LoginRequestDto {
  email!: string;
  password!: string;
}

export class LoginResponseDto {
  accessToken!: string;
  refreshToken!: string;
}

/**
 * `POST /auth/login`. Login is public — no `@Roles`/RBAC guard applies here
 * (none exists yet; see spec Boundaries).
 */
@Controller('auth')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginRequestDto): Promise<LoginResponseDto> {
    // Malformed input (missing/non-string/empty/oversized fields) fails the
    // same generic way as any other invalid-credentials case — never a
    // distinct error.
    if (
      typeof body?.email !== 'string' ||
      typeof body?.password !== 'string' ||
      body.email.length === 0 ||
      body.password.length === 0 ||
      body.email.length > MAX_EMAIL_LENGTH ||
      body.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.loginService.login(body.email, body.password);
  }
}
