import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Verifies Postgres connectivity. Per NFR5, the API must confirm this
 * succeeds before it accepts any HTTP traffic (see `main.ts`).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkDatabaseConnection(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Postgres health check failed: ${message}`);
      throw new Error(`Postgres is unreachable: ${message}`);
    }
  }
}
