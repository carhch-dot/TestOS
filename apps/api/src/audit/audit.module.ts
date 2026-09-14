import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Owns `RegistroAuditoria` exclusively (AD-1/AD-3) — no other module ever
 * writes it directly via Prisma. Exports `AuditService` so future callers
 * (Inventory/Relations/ChangeRequests/Import per AD-3) can inject it and
 * call `record(tx, params)` inside their own transaction. `AuditController`
 * (spec-2-2) is the module's only registered controller and its only read
 * path — `record`'s write path is still never exposed over HTTP.
 * `PrismaService`, which `AuditService.list` now depends on, is injected via
 * `PrismaModule`'s `@Global()` registration rather than a local import.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
