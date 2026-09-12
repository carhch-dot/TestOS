import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around the generated Prisma Client, connected via the
 * `@prisma/adapter-pg` driver adapter (required by Prisma 7 for PostgreSQL).
 *
 * This service only manages the database connection. Per AD-1, `Usuario` is
 * only ever written through `AuthModule` — other modules may inject
 * `PrismaService` for read-only or cross-cutting concerns (e.g. the health
 * check) but must never write `Usuario` rows.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
