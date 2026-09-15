import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TopologyService } from './topology.service';
import type { TopologyGraph } from './topology.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * `GET /topology/:itemId/tree` / `GET /topology/:itemId/neighbors`
 * (spec-4-3, FR23/FR24) — read-only graph traversal endpoints.
 * `@UseGuards(JwtAuthGuard)` only, no `RolesGuard`/`@Roles(...)`: any
 * authenticated role may read, matching `GET /items`'s posture (spec
 * Boundaries: "usuario autenticado, cualquier rol").
 *
 * No extra validation on the `itemId` route param beyond what
 * `TopologyService`'s own `findUnique` 404 check already handles cleanly —
 * a malformed id just misses in Prisma, the established "clean 404"
 * precedent from spec-3-4/4-2's reviews, mirroring `InventoryController`'s
 * minimal-validation style for route params.
 */
@Controller('topology')
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get(':itemId/tree')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async tree(@Param('itemId') itemId: string): Promise<TopologyGraph> {
    return this.topologyService.tree(itemId);
  }

  @Get(':itemId/neighbors')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async neighbors(@Param('itemId') itemId: string): Promise<TopologyGraph> {
    return this.topologyService.neighbors(itemId);
  }
}
