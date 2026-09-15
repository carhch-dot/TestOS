import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('lowercases the email', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('trims and lowercases combined whitespace + mixed-case input', () => {
    expect(normalizeEmail('  Admin@Example.Com ')).toBe('admin@example.com');
  });

  it('leaves an already-normalized email unchanged', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });
});
