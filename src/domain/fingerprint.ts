import { createHash } from 'node:crypto';
import type { NormalizedFinding } from './finding.js';

export function fingerprintFor(finding: NormalizedFinding): string {
  const stableIdentity = JSON.stringify([
    finding.source,
    finding.application,
    finding.category,
    finding.identity,
  ]);
  return createHash('sha256').update(stableIdentity).digest('hex');
}
