/**
 * Normalizes an email address for lookup/storage: trims surrounding
 * whitespace and lowercases it, so `Admin@Example.com` and
 * `admin@example.com ` resolve to the same `Usuario` row.
 *
 * Shared by `bootstrap.service.ts` and `login.service.ts` so both call sites
 * stay consistent (resolves the centralization item in deferred-work.md).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
