import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, generateTemporaryPassword, hashPassword, verifyPassword } from '../../../src/adapters/idp/password.ts';
import { IdpError } from '../../../src/adapters/errors.ts';

describe('password hashing', () => {
  it('uses the seed format scrypt$N$r$p$salt$hash with a 64-byte key', async () => {
    const hash = await hashPassword('Correct-Horse-1');
    const parts = hash.split('$');
    expect(parts.slice(0, 4)).toEqual(['scrypt', '16384', '8', '1']);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(64);
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('verifies the right password only', async () => {
    const hash = await hashPassword('Correct-Horse-1');
    expect(await verifyPassword('Correct-Horse-1', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-1', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('Same-Password-1')).not.toBe(await hashPassword('Same-Password-1'));
  });

  it('rejects malformed or abusive stored hashes without throwing', async () => {
    for (const stored of ['', 'bcrypt$x', 'scrypt$1048577$8$1$AAAA$AAAA', 'scrypt$16384$8$1$AAAA$AA==']) {
      expect(await verifyPassword('x', stored)).toBe(false);
    }
  });
});

describe('password policy', () => {
  it.each(['Short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHereAtAll'])('rejects %s', (pw) => {
    try {
      checkPasswordPolicy(pw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IdpError);
      expect((e as IdpError).code).toBe('PASSWORD_POLICY');
    }
  });

  it('accepts a compliant password', () => {
    expect(() => checkPasswordPolicy('Sauna-Lover-2026')).not.toThrow();
  });

  it('generates compliant temporary passwords', () => {
    for (let i = 0; i < 50; i++) expect(() => checkPasswordPolicy(generateTemporaryPassword())).not.toThrow();
  });
});
