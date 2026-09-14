---
title: 'Query and filter the audit history'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '8fd842eae21d15f8474f0165c7ba6132d2b2c391'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 built the recording mechanism but nothing can read `RegistroAuditoria` back — there is no way for anyone to see who did what and when (FR-29).

**Approach:** `GET /audit` (authenticated, any role — audit is read-only for everyone, no `@Roles` restriction) returns a paginated, most-recent-first list of `RegistroAuditoria` entries, each including the acting user's `id`/`email`. Optional query filters (`usuarioId`, `entidad`, `tipoAccion`, `desde`/`hasta`) combine with AND logic — only entries matching every supplied filter are returned.

## Boundaries & Constraints

**Always:**
- `AuditController`/new `AuditService.list(...)` method live under `apps/api/src/audit/` (Story 2.1's module), reusing its existing `AuditModule`.
- `GET /audit` uses `@UseGuards(JwtAuthGuard)` only — deliberately no `RolesGuard`/`@Roles(...)`, since every authenticated role may read (epic-2-context.md: "audit is read-only for everyone via the API," one of the few areas with no role restriction). This is intentional, not an oversight — commented as such at the call site.
- Response shape matches the architecture's pagination convention: `{ data, total, page, pageSize }`; `pageSize` defaults/caps exactly like `UsersController.list` (spec-1-8, including its review-fixed `page` upper clamp).
- Each entry includes the acting user's `id` and `email` (a Prisma `include` on the existing `usuario` relation) — a bare `usuarioId` UUID isn't useful for "investigate who did what" (FR-29). **Correction (review, see Spec Change Log):** `GET /users` is Manager/Administrator-only (spec-1-8), so this *does* newly expose every user's email to Editor/Read-only callers via `GET /audit` — a deliberate, human-confirmed trade-off (low-sensitivity data in a single-tenant org, outweighed by the audit log's core purpose), not an accident.
- Unfiltered queries return entries ordered `fecha desc` (most recent first, per epic-2-context.md).
- Query filters — `usuarioId`, `entidad`, `entidadId`, `tipoAccion`, `desde`, `hasta` — are all optional and combine with AND logic (only entries matching every supplied filter are returned, per the AC). (`entidadId` added post-review: without it, the `@@index([entidad, entidadId])` composite index added in spec-2-1's review was only half-usable — "history of this one entity" wasn't actually queryable through the API.)
- An empty-string value for `usuarioId`/`entidad`/`entidadId` means "no filter," not "filter on the empty string" (post-review fix — otherwise it silently returned zero results instead of the unfiltered list).
- `tipoAccion`, if supplied, must be one of the `TipoAccion` enum values, or the request is rejected — same posture as `InviteController`'s `role` guard clause.
- `desde`/`hasta`, if supplied, must each parse to a valid date, or the request is rejected — no cross-check that `desde <= hasta` (a swapped range just yields zero results, which is self-correcting).

**Never:**
- No write path added or changed here — `AuditService.record()` (spec-2-1) is untouched.
- No search/sort options beyond the four listed filters and the fixed `fecha desc` default ordering.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Any authenticated user queries with no filters | `GET /audit?page=1&pageSize=20` | `200`; `{ data, total, page, pageSize }`; entries ordered `fecha desc`, each with `usuario: { id, email }` | N/A |
| Query with one or more filters (`usuarioId`, `entidad`, `entidadId`, `tipoAccion`, `desde`/`hasta`) | `GET /audit?entidad=ItemConfiguracion&tipoAccion=UPDATE` | `200`; only entries matching every supplied filter | N/A |
| `desde` supplied later than `hasta` | `GET /audit?desde=2026-12-31&hasta=2026-01-01` | `200`; empty `data` (self-correcting, not an error) | N/A |
| Invalid `tipoAccion` value | `GET /audit?tipoAccion=NOT_REAL` | `400` | Clear error message |
| Unparseable `desde`/`hasta` | `GET /audit?desde=not-a-date` | `400` | Clear error message |
| Unauthenticated caller | `GET /audit` | `401` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/audit/audit.controller.ts` -- new: `GET /audit`, `@UseGuards(JwtAuthGuard)` only
- `apps/api/src/audit/audit.service.ts` -- existing (spec-2-1): add `list(filters, page, pageSize)`
- `apps/api/src/audit/audit.module.ts` -- existing: register the new controller
- `apps/api/src/auth/users.controller.ts` -- reference only: the existing `page`/`pageSize` parsing-and-clamping pattern to mirror exactly (spec-1-8, incl. its review-fixed `page` cap)
- `apps/api/src/auth/jwt-auth.guard.ts` -- existing, reused unchanged (Story 1.7) — no `RolesGuard` needed here

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/audit/audit.service.ts` -- `list(filters, page, pageSize)` implementing the I/O matrix
- [x] `apps/api/src/audit/audit.controller.ts` -- `GET /audit`, parses/validates query params
- [x] `apps/api/src/audit/audit.module.ts` -- register the new controller
- [x] Unit tests: `audit.service.ts` (all filter combinations, ordering, pagination), `audit.controller.ts` (dispatch, validation rejections, and that no role is excluded — a real-guard-chain test asserting all four roles reach the service, per Story 1.7/1.8's precedent)

**Acceptance Criteria:**
- Given entries from multiple users/entities, when queried unfiltered, then the most recent entries are returned first, paginated.
- Given entries from multiple users/entities, when filtered by any combination of `usuarioId`/`entidad`/`tipoAccion`/date range, then only entries matching every supplied filter are returned.
- Given a caller with any of the four roles, when they call `GET /audit`, then they can read normally — none is rejected.

## Implementation Notes

`apps/api/src/audit/audit.service.ts` gained a constructor-injected `PrismaService` (previously `AuditService` had no constructor at all — `record` only ever touched the caller's passed-in `tx`) plus a new `list(filters, page, pageSize)` method, `AuditListFilters`/`AuditListItem`/`AuditListResult` types. `list` builds a single `Prisma.RegistroAuditoriaWhereInput` by spreading in only the keys whose filter was actually supplied (an absent key, not an explicit `undefined` value, is what makes Prisma treat "no filter" as "match everything"), reuses that same `where` for both `findMany` and `count` so total always matches the filtered page, orders `fecha: 'desc'` unconditionally, and joins `usuario: { select: { id: true, email: true } }` via Prisma's existing relation. `desde`/`hasta` collapse into one `fecha: { gte, lte }` range clause when either is supplied.

`apps/api/src/audit/audit.controller.ts` is new: `GET /audit` under `@UseGuards(JwtAuthGuard)` only (no `RolesGuard`/`@Roles(...)`, commented as intentional). It parses/clamps `page`/`pageSize` with the exact same `DEFAULT_PAGE`/`DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`/`MAX_PAGE` constants and `parsePositiveInt` logic as `UsersController.list` (spec-1-8). `tipoAccion` is validated against `Object.values(TipoAccion)` before being passed on (same guard-clause shape as `InviteController`'s `role` check); an invalid value throws `BadRequestException(INVALID_TIPO_ACCION_MESSAGE)`. `desde`/`hasta` are each parsed with `new Date(raw)` and rejected individually (`INVALID_DESDE_MESSAGE`/`INVALID_HASTA_MESSAGE`) on `Number.isNaN(date.getTime())`, with no `desde <= hasta` cross-check per spec Boundaries. All validation happens before `AuditService.list` is ever called.

`apps/api/src/audit/audit.module.ts` now declares `controllers: [AuditController]` alongside the existing `providers`/`exports`; `AuditService.record`'s write path is otherwise untouched. `PrismaService` reaches `AuditService` through `PrismaModule`'s existing `@Global()` registration (already imported in `AppModule`) — no new import was needed in `AuditModule` itself.

Tests: `audit.service.spec.ts` gained a `describe('list', ...)` block covering unfiltered ordering/shape (including the joined `usuario`), pagination `skip`/`take` math, each of the five filters individually, the `desde`+`hasta` combined range, and all five filters AND-combined together — each asserting the exact `where` object passed to both `findMany` and `count`. New `audit.controller.spec.ts` mirrors `users.controller.spec.ts`'s structure: dispatch tests (defaults, page/pageSize parsing and clamping at both boundaries, filter pass-through), validation-rejection tests for each of the three invalid-input cases in the I/O matrix, and a "RBAC (real guard chain)" block that boots a real Nest app with the real `@UseGuards(JwtAuthGuard)` chain (real `JwtService.verifyAsync` stubbed only for its claims) to prove all four `UsuarioRole` values reach the service with no rejection — the spec's third acceptance criterion — plus a 401-unauthenticated case and a full-response-body shape assertion.

## Spec Change Log

- **Triggering finding:** the frozen Intent's justification for including `usuario.email` in each `GET /audit` entry claimed "the email is already visible to any authenticated caller via `GET /users`, so surfacing it here adds no new exposure" — verified false: `GET /users` (spec-1-8) is `@Roles(MANAGER, ADMINISTRATOR)`-gated, not open to all four roles. Since `GET /audit` is open to all four roles by explicit, non-negotiable epic requirement (FR-29 / epics.md AC3), this means Editor/Read-only callers gain new access to every user's email through the audit history that `GET /users` never granted them.
  **Amendment:** human-resolved (asked directly, not a full replan) — keep including `usuario.email`. Rationale recorded: email is low-sensitivity in a single-tenant organization (likely already known/predictable by corporate domain), and omitting it would undermine the audit log's core "who did what" purpose (FR-29) for two of the four roles. The exposure is accepted as a deliberate trade-off, not an oversight.
  **Known-bad state avoided:** silently shipping a factually-wrong justification in the frozen spec, which could mislead a future reader into believing no new exposure exists.
  **KEEP:** the rest of the `GET /audit` design (open to all roles, AND-combined filters, pagination convention, ordering) is unaffected and worked correctly per review — only the stated *justification* for including email was wrong, not the decision to include it.

## Review Triage Log

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | `GET /audit` including `usuario.email` newly exposes every user's email to Editor/Read-only callers — the frozen Intent's "no new exposure" justification was false (`GET /users` is Manager/Administrator-only) (edge-case-hunter, pre-verified claim) | medium | Confirmed at `users.controller.ts:71` (`@Roles(MANAGER, ADMINISTRATOR)`). Human-resolved directly (see Spec Change Log): keep the email, accepted as a deliberate trade-off. |
| 2 | The `@@index([entidad, entidadId])` composite index (added in spec-2-1's review) is only half-usable — `GET /audit` exposes an `entidad` filter but no `entidadId` filter, so "history of this one item" isn't actually queryable (blind-hunter) | low | Verified — real, and the fix is a direct, small addition mirroring the existing `entidad` filter. |
| 3 | An empty-string query param (e.g. `GET /audit?usuarioId=`) is treated as a real filter value rather than "not supplied," silently returning zero results instead of the unfiltered list (blind-hunter, edge-case-hunter) | low | Verified — `!== undefined` doesn't exclude `''`. |
| 4 | `audit.controller.ts` imports `AuditListResult` (a type) via a plain value import instead of `import type`, unlike the sibling convention in `users.controller.ts` (blind-hunter) | low | Verified — cosmetic-but-real inconsistency; not enforced by the project's eslint config, but cheap to align. |
| 5 | No `orderBy` tie-breaker for rows sharing an identical `fecha` — could skip or duplicate rows across paginated pages (edge-case-hunter) | low | Verified — real, extremely low probability (millisecond-precision timestamps), but the fix is a one-line, zero-downside addition. |
| 6 | No test for the `page='-1'`/negative-`pageSize` boundary, unlike the equivalent `page` case (blind-hunter) | low | Verified — real, trivial test-coverage gap, matches the boundary-test pattern already established in spec-1-8/1-9. |
| 7 | The spec's own documented "`desde > hasta` self-corrects to zero results" behavior is never actually tested (blind-hunter) | low | Verified — real, the authors' own called-out edge case went unverified. |
| 8 | Swapping the `desde`/`hasta` parsing lines would silently invert every date-range filter, and no test would catch it — the existing "parses valid desde/hasta" test only checks `instanceof Date`, never which raw input produced which field (verification-gap) | medium | Pre-verified by the verification-gap layer per its evidence rules — a concrete, demonstrated regression that the current suite would miss. |
| 9 | No note anywhere flags that a future module's `cambios` payload (Epic 3+, caller-shaped JSON) will be visible to all four roles via this endpoint, with no redaction mechanism (blind-hunter) | low | Real but speculative this far out — no real caller exists yet (spec-2-1). Worth a note for whoever builds the first real `record()` caller. |
| 10 | Duplicate query keys (e.g. `?usuarioId=a&usuarioId=b`) parse to a string array under NestJS's `@Query()`, which Prisma would receive as an unexpected type, likely surfacing as an unhandled `500` rather than a clean `400` (edge-case-hunter) | low | Real but narrow (requires a client deliberately or accidentally sending duplicate keys) — no existing controller anywhere in this codebase guards against this class of input either; would be a new validation pattern, not a one-line fix. |
| 11 | `list()` has no internal guard against a non-positive `page`/`pageSize` if ever called directly, bypassing the controller's clamping (edge-case-hunter) | low (rejected) | No other caller exists or is anticipated — matches the same internal-trust convention `UsersService.list` (spec-1-8) already established (no internal guard there either). |
| 12 | `findMany`/`count` run as two separate, non-transactional queries — a row inserted in between could make `total` briefly disagree with the returned page (edge-case-hunter) | low (rejected) | Matches `UsersService.list`'s identical, already-accepted `Promise.all([findMany, count])` shape (spec-1-8) — standard, universally-accepted eventual-consistency property of non-transactional pagination, not a regression introduced here. |
| 13 | Three files in the diff (`password-reset.service.spec.ts`, `users.controller.spec.ts`, `password-policy.spec.ts`) carry purely cosmetic formatting changes unrelated to this story (blind-hunter) | false | Confirmed non-behavioral (project-wide `eslint --fix` reformatting touched during the implementation subagent's lint run) — harmless, not worth reverting. |
| 14 | `sprint-status.yaml` shows `in-progress` while the spec shows `status: 'done'` (blind-hunter) | false | Process is incomplete, not contradictory — `sprint-status.yaml` is synced to `review` as part of finishing this review pass, same as every prior story. |



## Design Notes

## Verification

**Commands:**
- `npm run -w apps/api build` -- expected: exit 0. Passed.
- `npm run -w apps/api test` -- expected: all suites pass, including new/updated `audit.*` specs. Passed: 24 suites, 304 tests, 0 failures.
- `npm run -w apps/api lint` -- not in the spec's list, run anyway for hygiene: initially flagged 2 `@typescript-eslint/no-unsafe-member-access` errors in `audit.controller.spec.ts` (nested access into supertest's `any`-typed `response.body`), fixed by asserting the full response body with `toEqual` instead of drilling into individual fields. Clean on re-run.
