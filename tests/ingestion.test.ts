import { describe, expect, it, vi } from 'vitest';
import { IngestionService } from '../src/ingestion/ingestion-service.js';
import { InMemoryFindingsRepository } from '../src/infrastructure/in-memory-findings-repository.js';
import {
  MockFindingsQueue,
  sampleFindings,
} from '../src/infrastructure/mock-findings-queue.js';

const logger = { info: vi.fn(), warn: vi.fn() };

describe('ingestion and repository', () => {
  it('rejects individual malformed records and processes the rest', async () => {
    const repository = new InMemoryFindingsRepository();
    const service = new IngestionService(
      new MockFindingsQueue([
        ...sampleFindings,
        { source: 'cloud-config', severity: 'bad' },
      ]),
      repository,
      logger,
      () => new Date('2026-02-01T00:00:00.000Z'),
    );
    expect(await service.run()).toEqual({
      processed: 13,
      created: 11,
      updated: 1,
      rejected: 1,
    });
    expect(repository.summary().total).toBe(11);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('is idempotent, preserves identity and status, and updates context', async () => {
    const repository = new InMemoryFindingsRepository();
    const first = new IngestionService(
      new MockFindingsQueue([sampleFindings[0]]),
      repository,
      logger,
      () => new Date('2026-02-01T00:00:00.000Z'),
    );
    expect(await first.run()).toMatchObject({ created: 1, updated: 0 });
    const original = repository.list({}, 10, 0).data[0]!;
    repository.updateStatus(original.id, 'resolved');
    const changed = {
      ...(sampleFindings[0] as Record<string, unknown>),
      severity: 'low',
      details: 'Updated synthetic advisory.',
    };
    const second = new IngestionService(
      new MockFindingsQueue([changed]),
      repository,
      logger,
      () => new Date('2026-02-02T00:00:00.000Z'),
    );
    expect(await second.run()).toMatchObject({ created: 0, updated: 1 });
    const updated = repository.findById(original.id)!;
    expect(updated).toMatchObject({
      id: original.id,
      fingerprint: original.fingerprint,
      status: 'resolved',
      detectedAt: original.detectedAt,
      lastSeenAt: '2026-02-02T00:00:00.000Z',
      priority: 'P2',
    });
    expect(repository.summary()).toMatchObject({
      total: 1,
      byStatus: { open: 0, resolved: 1 },
    });
  });

  it('returns defensive copies and stable pagination', async () => {
    const repository = new InMemoryFindingsRepository();
    await new IngestionService(
      new MockFindingsQueue(),
      repository,
      logger,
    ).run();
    const firstPage = repository.list({}, 3, 0);
    expect(firstPage.total).toBe(11);
    expect(firstPage.data).toHaveLength(3);
    expect(repository.list({}, 3, 3).data[0]?.id).not.toBe(
      firstPage.data[0]?.id,
    );
    firstPage.data[0]!.priorityReasons.push('tampered');
    expect(
      repository.findById(firstPage.data[0]!.id)?.priorityReasons,
    ).not.toContain('tampered');
  });

  it('deduplicates concurrent ingestion runs in one process', async () => {
    const repository = new InMemoryFindingsRepository();
    const service = new IngestionService(
      new MockFindingsQueue([sampleFindings[0]]),
      repository,
      logger,
    );
    const results = await Promise.all([service.run(), service.run()]);
    expect(results).toEqual([
      { processed: 1, created: 1, updated: 0, rejected: 0 },
      { processed: 1, created: 0, updated: 1, rejected: 0 },
    ]);
    expect(repository.summary().total).toBe(1);
  });
});
