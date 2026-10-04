import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArtifact, sourcePath, ARTIFACT_MAX_BYTES } from './artifacts';
const fixture = (name: string) =>
  readFileSync(
    resolve(__dirname, '../../../fixtures/test-evidence', name),
    'utf8',
  );
describe('test evidence artifact validation', () => {
  it('imports real JUnit outcomes and stable identities without inventing coverage', () => {
    const parsed = parseArtifact('JUNIT', fixture('junit.xml'));
    expect(parsed.tests.map((t) => [t.identity, t.outcome])).toEqual([
      ['checkout-success', 'PASSED'],
      ['checkout-declined', 'FAILED'],
      ['profile-skipped', 'SKIPPED'],
    ]);
    expect(parsed.aggregate).toEqual([]);
    expect(parsed.perTest).toEqual([]);
  });
  it('rejects malformed XML, DTDs, XXE, undefined entities and duplicate IDs', () => {
    for (const xml of [
      '<testsuite><testcase></testsuite>',
      '<!DOCTYPE testsuite SYSTEM "file:///etc/passwd"><testsuite/>',
      '<!DOCTYPE testsuite [<!ENTITY x "boom">]><testsuite/>',
      '<testsuite><testcase name="&custom;"/></testsuite>',
      '<testsuite><testcase id="a" name="a"/><testcase id="a" name="b"/></testsuite>',
      '<wrong/>',
    ])
      expect(() => parseArtifact('JUNIT', xml)).toThrow();
    expect(
      parseArtifact(
        'JUNIT',
        '<testsuite name="s"><testcase name="one &amp; two"/></testsuite>',
      ).tests[0]!.name,
    ).toBe('one & two');
  });
  it('bounds artifact bytes, XML depth and custom schema', () => {
    expect(() =>
      parseArtifact('LCOV', 'é'.repeat(ARTIFACT_MAX_BYTES / 2 + 1)),
    ).toThrow('2 MiB');
    expect(() =>
      parseArtifact('LCOV', 'x'.repeat(ARTIFACT_MAX_BYTES + 1)),
    ).toThrow('2 MiB');
    expect(() =>
      parseArtifact(
        'JUNIT',
        '<testsuites>'.repeat(65) + '</testsuites>'.repeat(65),
      ),
    ).toThrow('nesting');
    expect(() => parseArtifact('PER_TEST', '{"version":2,"tests":[]}')).toThrow(
      'schema',
    );
    expect(() => parseArtifact('PER_TEST', '{')).toThrow('Malformed');
    expect(() =>
      parseArtifact(
        'PER_TEST',
        '{"version":1,"tests":[{"identity":"a","name":"a","covers":[{"path":"a.ts","lines":[-1]}]}]}',
      ),
    ).toThrow('schema');
  });
  it('imports both aggregate formats without deriving individual tests, even from LCOV TN', () => {
    for (const [format, name] of [
      ['ISTANBUL', 'istanbul.json'],
      ['LCOV', 'coverage.lcov'],
    ] as const) {
      const p = parseArtifact(format, fixture(name));
      expect(p.tests).toEqual([]);
      expect(p.perTest).toEqual([]);
      expect(p.aggregate[0]!.ranges).toContainEqual({
        start: 3,
        end: 3,
        hits: 0,
      });
    }
  });
  it('rejects mismatched Istanbul counts, bad schema, negative LCOV counts and truncated records', () => {
    const bad = JSON.parse(fixture('istanbul.json'));
    bad['src/checkout.ts'].s = {};
    expect(() => parseArtifact('ISTANBUL', JSON.stringify(bad))).toThrow('IDs');
    for (const content of [
      'SF:a.ts\nDA:1,-1\nend_of_record',
      'SF:a.ts\nDA:1,2',
      'SF:a.ts\nDA:1,1\nLF:bad\nend_of_record',
      'SF:a.ts\nDA:1,1\nDA:1,2\nend_of_record',
    ])
      expect(() => parseArtifact('LCOV', content)).toThrow();
  });
  it('preserves explicit per-test line, symbol and file attribution', () => {
    const p = parseArtifact('PER_TEST', fixture('per-test.json'));
    expect(p.perTest).toHaveLength(3);
    expect(p.perTest[0]!.targets[0]!.lines).toEqual([2]);
    expect(p.perTest[1]!.targets[0]!.symbol?.name).toBe('checkout');
    expect(p.tests.every((t) => t.outcome === 'UNKNOWN')).toBe(true);
  });
  it('normalizes CI paths without filesystem access and rejects traversal and outside roots', () => {
    expect(
      sourcePath('C:\\agent\\repo\\src\\checkout.ts', 'C:\\agent\\repo'),
    ).toBe('src/checkout.ts');
    expect(sourcePath('/ci/repo/src/checkout.ts', '/ci/repo')).toBe(
      'src/checkout.ts',
    );
    expect(sourcePath('./src/checkout.ts')).toBe('src/checkout.ts');
    for (const path of [
      '../secret',
      'src/../../secret',
      '/ci/repo-other/file',
      '/ci/repo/../secret',
      'file:///etc/passwd',
      '%2e%2e/secret',
      'src\u0000/a',
      'C:relative.ts',
    ])
      expect(() => sourcePath(path, '/ci/repo')).toThrow();
    expect(() => sourcePath('/ci/repo/a.ts')).toThrow('sourceRoot');
  });
});
