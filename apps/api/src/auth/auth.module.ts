import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { BootstrapService } from './bootstrap.service';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { LogoutController } from './logout.controller';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenService } from './refresh-token.service';
import { RenewalController } from './renewal.controller';
import { RenewalService } from './renewal.service';
import { RolesGuard } from './roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * AuthModule owns `Usuario` end to end (AD-1), and now also `RefreshToken`,
 * `PasswordResetToken`, and `InvitationToken`. No other module ever injects
 * Prisma to write any of them.
 *
 * `JwtAuthGuard`/`RolesGuard` are registered as ordinary providers, not a
 * global `APP_GUARD` — only routes that explicitly `@UseGuards(...)` them
 * (`POST /auth/invite` since spec-1-7, and `GET /users`,
 * `POST /users/:id/deactivate`, `POST /users/:id/reactivate` since spec-1-8)
 * are protected.
 */
@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.registerAsync({
      // useFactory runs during Nest's DI instantiation (inside
      // `NestFactory.create()`), so a missing secret fails the same way as
      // `PrismaService`'s missing `DATABASE_URL` — caught by main.ts's
      // startup error handler instead of crashing at module-import time.
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret?.trim()) {
          throw new Error('Missing required environment variable: JWT_SECRET');
        }
        return {
          secret,
          // `[ASSUMPTION: 15 minutes]` per AD-5.
          signOptions: { expiresIn: '15m' },
        };
      },
    }),
  ],
  controllers: [
    InviteController,
    LoginController,
    LogoutController,
    PasswordResetController,
    RenewalController,
    UsersController,
  ],
  providers: [
    BootstrapService,
    InviteService,
    JwtAuthGuard,
    LoginService,
    PasswordResetService,
    RefreshTokenService,
    RenewalService,
    RolesGuard,
    UsersService,
  ],
  // `JwtModule` is re-exported too: `JwtAuthGuard`'s own constructor depends
  // on `JwtService`, and a module that only re-exports `JwtAuthGuard` itself
  // (without also re-exporting the module that satisfies its dependency)
  // leaves that dependency unresolvable for a cross-module consumer like
  // `AuditModule` — this was a real app-bootstrap failure, not caught by
  // any unit test (every `@UseGuards(JwtAuthGuard)` unit test overrides the
  // guard directly, never exercising the real module graph).
  // `JwtModule` is re-exported too: `JwtAuthGuard`'s own constructor depends
  // on `JwtService`, and a module that only re-exports `JwtAuthGuard` itself
  // (without also re-exporting the module that satisfies its dependency)
  // leaves that dependency unresolvable for a cross-module consumer like
  // `AuditModule` — this was a real app-bootstrap failure, not caught by
  // any unit test (every `@UseGuards(JwtAuthGuard)` unit test overrides the
  // guard directly, never exercising the real module graph). Verified by
  // `app.module.spec.ts`, which boots the real module graph.
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
