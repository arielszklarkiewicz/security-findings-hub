import type { Finding, Priority, Severity, Status } from '../domain/finding.js';

export interface FindingFilters {
  severity?: Severity | undefined;
  priority?: Priority | undefined;
  status?: Status | undefined;
  application?: string | undefined;
}

export interface FindingsRepository {
  upsert(finding: Finding): 'created' | 'updated';
  findById(id: string): Finding | undefined;
  list(
    filters: FindingFilters,
    limit: number,
    offset: number,
  ): { data: Finding[]; total: number };
  updateStatus(id: string, status: Status): Finding | undefined;
  summary(): Summary;
}

export interface Summary {
  total: number;
  bySeverity: Record<Severity, number>;
  byPriority: Record<Priority, number>;
  byStatus: Record<Status, number>;
  byApplication: Record<string, number>;
}

function copy(finding: Finding): Finding {
  return structuredClone(finding);
}

export class InMemoryFindingsRepository implements FindingsRepository {
  private readonly byFingerprint = new Map<string, Finding>();
  private readonly fingerprintsById = new Map<string, string>();

  upsert(finding: Finding): 'created' | 'updated' {
    const existing = this.byFingerprint.get(finding.fingerprint);
    if (existing) {
      this.byFingerprint.set(finding.fingerprint, {
        ...copy(finding),
        id: existing.id,
        status: existing.status,
        detectedAt: existing.detectedAt,
        lastSeenAt:
          finding.lastSeenAt >= existing.lastSeenAt
            ? finding.lastSeenAt
            : existing.lastSeenAt,
      });
      return 'updated';
    }
    if (this.fingerprintsById.has(finding.id)) {
      throw new Error('Finding ID collision');
    }
    this.byFingerprint.set(finding.fingerprint, copy(finding));
    this.fingerprintsById.set(finding.id, finding.fingerprint);
    return 'created';
  }

  findById(id: string): Finding | undefined {
    const fingerprint = this.fingerprintsById.get(id);
    const finding = fingerprint
      ? this.byFingerprint.get(fingerprint)
      : undefined;
    return finding ? copy(finding) : undefined;
  }

  list(
    filters: FindingFilters,
    limit: number,
    offset: number,
  ): { data: Finding[]; total: number } {
    const matches = [...this.byFingerprint.values()]
      .filter(
        (finding) =>
          (!filters.severity || finding.severity === filters.severity) &&
          (!filters.priority || finding.priority === filters.priority) &&
          (!filters.status || finding.status === filters.status) &&
          (!filters.application || finding.application === filters.application),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      data: matches.slice(offset, offset + limit).map(copy),
      total: matches.length,
    };
  }

  updateStatus(id: string, status: Status): Finding | undefined {
    const fingerprint = this.fingerprintsById.get(id);
    const finding = fingerprint
      ? this.byFingerprint.get(fingerprint)
      : undefined;
    if (!finding || !fingerprint) return undefined;
    const updated = { ...finding, status };
    this.byFingerprint.set(fingerprint, updated);
    return copy(updated);
  }

  summary(): Summary {
    const result: Summary = {
      total: this.byFingerprint.size,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byPriority: { P0: 0, P1: 0, P2: 0, P3: 0 },
      byStatus: { open: 0, resolved: 0 },
      byApplication: Object.create(null) as Record<string, number>,
    };
    for (const finding of this.byFingerprint.values()) {
      result.bySeverity[finding.severity]++;
      result.byPriority[finding.priority]++;
      result.byStatus[finding.status]++;
      result.byApplication[finding.application] =
        (result.byApplication[finding.application] ?? 0) + 1;
    }
    return result;
  }
}
