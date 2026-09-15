import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';

/**
 * Read-only `TopologyModule` (spec-4-3, FR23/FR24) — owns neither
 * `ItemConfiguracion` nor `Relacion` (a read-only cross-module lookup is not
 * a write, AD-1). Imports `AuthModule` to reach its exported `JwtAuthGuard`
 * (and, transitively, the `JwtModule` that satisfies `JwtAuthGuard`'s own
 * `JwtService` dependency — the same cross-module wiring
 * `InventoryModule`/`RelationsModule` already use). No `AuditModule`
 * import: nothing in this module is audited (spec Boundaries/Never — no
 * writes, no `RegistroAuditoria` entries).
 */
@Module({
  imports: [AuthModule],
  controllers: [TopologyController],
  providers: [TopologyService],
})
export class TopologyModule {}
