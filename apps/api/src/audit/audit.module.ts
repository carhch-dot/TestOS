import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Owns `RegistroAuditoria` exclusively (AD-1/AD-3) — no other module ever
 * writes it directly via Prisma. Exports `AuditService` so future callers
 * (Inventory/Relations/ChangeRequests/Import per AD-3) can inject it and
 * call `record(tx, params)` inside their own transaction. No controller is
 * registered here: this story never exposes a write path over HTTP.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
