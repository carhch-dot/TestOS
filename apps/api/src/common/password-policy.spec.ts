import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  enforcePasswordPolicy,
  PASSWORD_REUSED_MESSAGE,
} from './password-policy';

describe('enforcePasswordPolicy', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PASSWORD_MIN_LENGTH;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // I/O matrix row 1: too short, default min length (8).
  it('rejects a password shorter than the default minimum length, naming the requirement', async () => {
    await expect(enforcePasswordPolicy('short1', [])).rejects.toThrow(
      BadRequestException,
    );
    await expect(enforcePasswordPolicy('short1', [])).rejects.toThrow(
      /at least 8 characters/,
    );
  });

  it('accepts a password exactly at the default minimum length with no prior hashes', async () => {
    await expect(
      enforcePasswordPolicy('12345678', []),
    ).resolves.toBeUndefined();
  });

  it('honors PASSWORD_MIN_LENGTH when set', async () => {
    process.env.PASSWORD_MIN_LENGTH = '12';

    await expect(enforcePasswordPolicy('short-pw12', [])).rejects.toThrow(
      /at least 12 characters/,
    );
    await expect(
      enforcePasswordPolicy('long-enough-pw', []),
    ).resolves.toBeUndefined();
  });

  it('falls back to the default minimum length for a non-positive/non-numeric PASSWORD_MIN_LENGTH', async () => {
    process.env.PASSWORD_MIN_LENGTH = 'not-a-number';

    await expect(enforcePasswordPolicy('short1', [])).rejects.toThrow(
      /at least 8 characters/,
    );
  });

  // I/O matrix row 2: reuse of the current password or one of the last N.
  it('rejects a password matching the current password hash', async () => {
    const currentHash = await argon2.hash('reused-password');

    await expect(
      enforcePasswordPolicy('reused-password', [currentHash]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      enforcePasswordPolicy('reused-password', [currentHash]),
    ).rejects.toThrow(PASSWORD_REUSED_MESSAGE);
  });

  it('rejects a password matching one of several prior hashes, not just the first', async () => {
    const hashes = await Promise.all(
      ['old-password-1', 'old-password-2', 'old-password-3'].map((p) =>
        argon2.hash(p),
      ),
    );

    await expect(
      enforcePasswordPolicy('old-password-3', hashes),
    ).rejects.toThrow(PASSWORD_REUSED_MESSAGE);
  });

  // I/O matrix row 3: passes both checks.
  it('resolves with no error for a sufficiently long, non-reused password', async () => {
    const hashes = await Promise.all(
      ['old-password-1', 'old-password-2', 'old-password-3'].map((p) =>
        argon2.hash(p),
      ),
    );

    await expect(
      enforcePasswordPolicy('brand-new-password', hashes),
    ).resolves.toBeUndefined();
  });

  it('resolves with no error when priorHashes is empty (brand-new account)', async () => {
    await expect(
      enforcePasswordPolicy('brand-new-password', []),
    ).resolves.toBeUndefined();
  });

  it('checks length before reuse, so a short reused password reports the length failure', async () => {
    const currentHash = await argon2.hash('short1');

    await expect(
      enforcePasswordPolicy('short1', [currentHash]),
    ).rejects.toThrow(/at least 8 characters/);
  });

  it('rejects a whitespace-only password that would otherwise meet the raw length', async () => {
    await expect(enforcePasswordPolicy('        ', [])).rejects.toThrow(
      /at least 8 characters/,
    );
  });
});
