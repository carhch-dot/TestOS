import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsuarioRole, UsuarioStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Auto-creates the first Administrator account from environment variables
 * the first time the API starts against an empty `Usuario` table (FR6).
 *
 * AD-1: this is the only place that writes `Usuario`.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const existingUserCount = await this.prisma.usuario.count();
    if (existingUserCount > 0) {
      this.logger.log('Skipping admin bootstrap: Usuario table is not empty.');
      return;
    }

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email?.trim()) {
      throw new Error(
        'Cannot bootstrap the first administrator: required environment variable ADMIN_EMAIL is missing.',
      );
    }
    if (!password?.trim()) {
      throw new Error(
        'Cannot bootstrap the first administrator: required environment variable ADMIN_PASSWORD is missing.',
      );
    }

    const passwordHash = await argon2.hash(password);

    await this.prisma.usuario.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        role: UsuarioRole.ADMINISTRATOR,
        status: UsuarioStatus.ACTIVE,
      },
    });

    // Never log the email/password values themselves (AD-7).
    this.logger.log('Bootstrapped the first administrator account.');
  }
}
