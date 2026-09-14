import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { BootstrapService } from './bootstrap.service';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { LogoutController } from './logout.controller';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenService } from './refresh-token.service';
import { RenewalController } from './renewal.controller';
import { RenewalService } from './renewal.service';

/**
 * AuthModule owns `Usuario` end to end (AD-1), and now also `RefreshToken`
 * and `PasswordResetToken`. No other module ever injects Prisma to write any
 * of them.
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
    LoginController,
    LogoutController,
    PasswordResetController,
    RenewalController,
  ],
  providers: [
    BootstrapService,
    LoginService,
    PasswordResetService,
    RefreshTokenService,
    RenewalService,
  ],
})
export class AuthModule {}
