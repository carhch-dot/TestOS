import { createHash } from 'crypto';
import { generateRawToken, hashToken } from './hash-token';

describe('generateRawToken', () => {
  it('returns a 64-character hex string (32 random bytes)', () => {
    const raw = generateRawToken();

    expect(raw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a different value on each call', () => {
    const first = generateRawToken();
    const second = generateRawToken();

    expect(first).not.toBe(second);
  });
});

describe('hashToken', () => {
  it('returns the SHA-256 hex digest of the raw value', () => {
    const raw = 'some-raw-token';

    expect(hashToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('is deterministic: hashing the same raw value twice yields the same digest', () => {
    const raw = 'some-raw-token';

    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it('produces a different digest than the raw input', () => {
    const raw = 'some-raw-token';

    expect(hashToken(raw)).not.toBe(raw);
  });
});
