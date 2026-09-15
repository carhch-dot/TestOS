import { Test } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Server } from 'http';
import { TopologyController } from './topology.controller';
import {
  TopologyService,
  ROOT_ITEM_NOT_FOUND_MESSAGE,
} from './topology.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const TREE_RESULT = {
  rootId: 'item-1',
  nodes: [{ id: 'item-1', nombre: 'Root', tipo: 'SERVER' }],
  edges: [],
  truncated: false,
};

const NEIGHBORS_RESULT = {
  rootId: 'item-1',
  nodes: [
    { id: 'item-1', nombre: 'Root', tipo: 'SERVER' },
    { id: 'item-2', nombre: 'Neighbor', tipo: 'SERVICE' },
  ],
  edges: [
    { id: 'rel-1', origenId: 'item-1', destinoId: 'item-2', tipo: 'HOSTS' },
  ],
  truncated: false,
};

describe('TopologyController', () => {
  let topologyService: { tree: jest.Mock; neighbors: jest.Mock };
  let controller: TopologyController;

  beforeEach(async () => {
    topologyService = {
      tree: jest.fn().mockResolvedValue(TREE_RESULT),
      neighbors: jest.fn().mockResolvedValue(NEIGHBORS_RESULT),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TopologyController],
      providers: [{ provide: TopologyService, useValue: topologyService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(TopologyController);
  });

  describe('tree (dispatch)', () => {
    it('delegates to TopologyService.tree with the itemId route param', async () => {
      const result = await controller.tree('item-1');

      expect(topologyService.tree).toHaveBeenCalledWith('item-1');
      expect(result).toBe(TREE_RESULT);
    });

    it('propagates NotFoundException from the service for an unknown itemId', async () => {
      topologyService.tree.mockRejectedValueOnce(
        new NotFoundException(ROOT_ITEM_NOT_FOUND_MESSAGE),
      );

      await expect(controller.tree('missing-item')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('neighbors (dispatch)', () => {
    it('delegates to TopologyService.neighbors with the itemId route param', async () => {
      const result = await controller.neighbors('item-1');

      expect(topologyService.neighbors).toHaveBeenCalledWith('item-1');
      expect(result).toBe(NEIGHBORS_RESULT);
    });

    it('propagates NotFoundException from the service for an unknown itemId', async () => {
      topologyService.neighbors.mockRejectedValueOnce(
        new NotFoundException(ROOT_ITEM_NOT_FOUND_MESSAGE),
      );

      await expect(controller.neighbors('missing-item')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('auth rejection (overridden guard)', () => {
    it('rejects GET /topology/:itemId/tree with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [TopologyController],
        providers: [{ provide: TopologyService, useValue: topologyService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: () => {
            throw new UnauthorizedException(
              'Missing or invalid Authorization header',
            );
          },
        })
        .compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .get('/topology/item-1/tree')
        .expect(401);

      expect(topologyService.tree).not.toHaveBeenCalled();

      await app.close();
    });

    it('rejects GET /topology/:itemId/neighbors with 401 when JwtAuthGuard denies an unauthenticated caller', async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [TopologyController],
        providers: [{ provide: TopologyService, useValue: topologyService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: () => {
            throw new UnauthorizedException(
              'Missing or invalid Authorization header',
            );
          },
        })
        .compile();

      const app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer() as Server)
        .get('/topology/item-1/neighbors')
        .expect(401);

      expect(topologyService.neighbors).not.toHaveBeenCalled();

      await app.close();
    });
  });

  describe('auth (real JwtAuthGuard chain)', () => {
    // Same posture as RelationsController's/InventoryController's
    // precedent test (mirrors InventoryController.list's own "GET /items,
    // no RolesGuard" test exactly, per this spec's own Tasks & Acceptance
    // instruction): boots a real app with the real
    // `@UseGuards(JwtAuthGuard)` on the real compiled route, only stubbing
    // `JwtService.verifyAsync` to hand back claims. No `RolesGuard` here
    // (spec Boundaries: any authenticated role may read) — loops over ALL
    // FOUR roles to prove the guard chain lets any role through, not just
    // that it happens to let one specific role through (the previous
    // version of this test only ever minted a READ_ONLY token, which
    // couldn't distinguish "any role passes" from "READ_ONLY happens to
    // pass").
    it('lets all four roles reach the service for GET /topology/:itemId/tree and /neighbors, and rejects a missing token with 401', async () => {
      const verifyAsync = jest.fn();

      const moduleRef = await Test.createTestingModule({
        controllers: [TopologyController],
        providers: [
          { provide: TopologyService, useValue: topologyService },
          JwtAuthGuard,
          { provide: JwtService, useValue: { verifyAsync } },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      const server = app.getHttpServer() as Server;

      for (const role of ['ADMINISTRATOR', 'MANAGER', 'EDITOR', 'READ_ONLY']) {
        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .get('/topology/item-1/tree')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200)
          .expect(TREE_RESULT);

        verifyAsync.mockResolvedValueOnce({
          sub: 'caller-1',
          email: 'caller@example.com',
          role,
        });

        await request(server)
          .get('/topology/item-1/neighbors')
          .set('Authorization', 'Bearer a-valid-token')
          .expect(200)
          .expect(NEIGHBORS_RESULT);
      }

      expect(topologyService.tree).toHaveBeenCalledTimes(4);
      expect(topologyService.neighbors).toHaveBeenCalledTimes(4);

      await request(server).get('/topology/item-1/tree').expect(401);

      await app.close();
    });
  });
});
