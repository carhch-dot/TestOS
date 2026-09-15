import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Owns `ItemConfiguracion` exclusively (AD-1) — no other module ever writes
 * it directly via Prisma (spec-3-1). Imports `AuthModule` to reach its
 * exported `JwtAuthGuard`/`RolesGuard` (and, transitively, the `JwtModule`
 * that satisfies `JwtAuthGuard`'s own `JwtService` dependency — the exact
 * cross-module wiring gap `AuditModule` hit and fixed, spec-2-2/app.module.spec.ts),
 * and `AuditModule` to reach its exported `AuditService`, which
 * `InventoryService.create` calls as the first real caller of
 * `AuditService.record` (AD-3).
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
