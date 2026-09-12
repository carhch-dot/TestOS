import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global provider of the Prisma connection. Any module may inject
 * `PrismaService` for read-only or cross-cutting use (e.g. the health
 * check); per AD-1, only `AuthModule` may write `Usuario` rows through it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
