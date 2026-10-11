import { describe, expect, it } from 'vitest';
import { fingerprintFor } from '../src/domain/fingerprint.js';
import { prioritize } from '../src/domain/prioritization.js';
import { normalize } from '../src/ingestion/normalizers.js';
import { sampleFindings } from '../src/infrastructure/mock-findings-queue.js';

describe('scanner normalization', () => {
  it.each(['dependency', 'static-analysis', 'cloud-config'])(
    'normalizes %s records',
    (source) => {
      const record = sampleFindings.find(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'source' in value &&
          value.source === source,
      );
      const finding = normalize(record);
      expect(finding.source).toBe(source);
      expect(finding.identity).toBeTruthy();
      expect(finding.description).toBeTruthy();
    },
  );

  it('rejects malformed and unknown scanner data', () => {
    expect(() =>
      normalize({ source: 'dependency', severity: 'extreme' }),
    ).toThrow();
    expect(() => normalize({ source: 'unknown' })).toThrow();
  });

  it('keeps fingerprints stable across mutable attributes', () => {
    const finding = normalize(sampleFindings[0]);
    expect(
      fingerprintFor({
        ...finding,
        severity: 'low',
        detectedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toBe(fingerprintFor(finding));
    expect(
      fingerprintFor({ ...finding, identity: 'another-advisory' }),
    ).not.toBe(fingerprintFor(finding));
  });

  it('keeps compound identity parts unambiguous', () => {
    const base = sampleFindings[0] as Record<string, unknown>;
    const left = normalize({ ...base, packageName: 'a:b', advisoryId: 'c' });
    const right = normalize({ ...base, packageName: 'a', advisoryId: 'b:c' });
    expect(fingerprintFor(left)).not.toBe(fingerprintFor(right));
  });
});

describe('contextual prioritization', () => {
  it.each([
    [
      {
        severity: 'critical',
        environment: 'production',
        internetFacing: false,
      },
      95,
      'P0',
    ],
    [
      { severity: 'high', environment: 'production', internetFacing: false },
      75,
      'P1',
    ],
    [
      { severity: 'medium', environment: 'staging', internetFacing: false },
      40,
      'P2',
    ],
    [
      { severity: 'medium', environment: 'development', internetFacing: false },
      35,
      'P3',
    ],
    [
      { severity: 'high', environment: 'development', internetFacing: true },
      75,
      'P1',
    ],
  ] as const)('maps %j to score %i and %s', (input, score, priority) => {
    expect(prioritize(input)).toMatchObject({ score, priority });
    expect(prioritize(input).reasons.at(-1)).toContain(`maps to ${priority}`);
  });
});
