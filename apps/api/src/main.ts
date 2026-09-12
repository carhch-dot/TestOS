import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HealthService } from './health/health.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // NFR5: verify Postgres connectivity before the API accepts any HTTP
  // traffic. On failure, log clearly and exit without ever calling listen().
  try {
    await app.get(HealthService).checkDatabaseConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Startup aborted: ${message}. The API will not accept HTTP traffic.`,
    );
    await app.close();
    process.exit(1);
  }

  await app.listen(Number(process.env.PORT) || 3000);
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // Covers failures during Nest's module bootstrap phase, e.g. the
  // bootstrap-admin service exiting because ADMIN_EMAIL/ADMIN_PASSWORD are
  // missing.

  console.error(`Fatal error during application startup: ${message}`);
  process.exit(1);
});
