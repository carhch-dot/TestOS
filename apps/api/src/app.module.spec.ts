import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

/**
 * Boots the real `AppModule` — every real module, every real
 * `@UseGuards(...)`/cross-module import, nothing overridden except the
 * leaf-level `PrismaService` (so this needs no live database). Only
 * `PrismaService` is swapped; every other provider, guard, and inter-module
 * wiring is exactly what `main.ts` would construct.
 *
 * This exists because a real bug — `AuditModule` couldn't resolve
 * `JwtAuthGuard`'s own `JwtService` dependency, since `AuthModule` exported
 * `JwtAuthGuard` without re-exporting the `JwtModule` that satisfies its
 * constructor — passed every unit test and both prior review passes (spec-2-2)
 * and only surfaced when the app was actually started. Every existing
 * `@UseGuards(JwtAuthGuard)` unit test overrides the guard directly with a
 * stub, which structurally can never catch a cross-module DI wiring mistake
 * like that one. This test is the cheap, no-database-required class of
 * safeguard for exactly that failure mode — not a substitute for the deeper,
 * still-deferred integration-test coverage noted in spec-2-1/2-2's
 * deferred-work.md entries (real transaction rollback, etc.), which do need
 * a live database.
 */
describe('AppModule (bootstrap)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('wires up the entire real module graph without any DI resolution error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        usuario: { count: jest.fn().mockResolvedValue(1) },
      })
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
  });
});
