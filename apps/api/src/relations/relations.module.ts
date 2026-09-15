import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { RelationsController } from './relations.controller';
import { RelationsService } from './relations.service';

/**
 * Owns `Relacion` exclusively (AD-1) — no other module ever writes it
 * directly via Prisma (spec-4-1). Imports `AuthModule` to reach its exported
 * `JwtAuthGuard`/`RolesGuard` (and, transitively, the `JwtModule` that
 * satisfies `JwtAuthGuard`'s own `JwtService` dependency — the same
 * cross-module wiring `InventoryModule` needed, spec-3-1/app.module.spec.ts),
 * and `AuditModule` to reach its exported `AuditService`, which
 * `RelationsService.create` calls exactly like `InventoryService.create`
 * does (AD-3). Mirrors `inventory.module.ts` exactly.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RelationsController],
  providers: [RelationsService],
  exports: [RelationsService],
})
export class RelationsModule {}
