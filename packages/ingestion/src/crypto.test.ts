import { describe, it, expect } from 'vitest';
import { seal, unseal } from './crypto';
describe('stored GitHub credential protection', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('uses randomized authenticated encryption and fails closed on tampering or wrong keys', () => {
    const credential = 'fixture-only-token',
      first = seal(credential, key),
      second = seal(credential, key);
    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64').toString()).not.toContain(credential);
    expect(unseal(first, key)).toBe(credential);
    const tampered = Buffer.from(first, 'base64');
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => unseal(tampered.toString('base64'), key)).toThrow();
    expect(() =>
      unseal(first, Buffer.alloc(32, 8).toString('base64')),
    ).toThrow();
  });
});
