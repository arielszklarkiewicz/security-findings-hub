import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('HTTP API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      logger: false,
      now: () => new Date('2026-02-01T00:00:00.000Z'),
    });
  });
  afterEach(async () => {
    await app.close();
  });

  it('seeds findings, serves health and interactive documentation', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    const findings = await app.inject('/api/findings');
    expect(findings.statusCode).toBe(200);
    expect(findings.json().total).toBe(11);
    expect((await app.inject('/docs/')).body).toContain('swagger-ui');
    expect((await app.inject('/documentation/json')).statusCode).toBe(404);
    expect(
      (await app.inject('/docs/json')).json().paths['/api/findings'],
    ).toBeTruthy();
  });

  it('filters and paginates deterministically', async () => {
    const response = await app.inject(
      '/api/findings?severity=low&limit=2&offset=1',
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(response.json().data).toHaveLength(2);
    const first = await app.inject('/api/findings?limit=2');
    expect(
      first.json().data.map((finding: { id: string }) => finding.id),
    ).toEqual(
      [
        ...first.json().data.map((finding: { id: string }) => finding.id),
      ].sort(),
    );
    const filtered = await app.inject(
      '/api/findings?application=Atlas%20Admin&priority=P3&status=open&limit=2',
    );
    expect(filtered.json()).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
    });
    expect(filtered.json().data).toHaveLength(2);
    for (const finding of filtered.json().data) {
      expect(finding).toMatchObject({
        application: 'Atlas Admin',
        priority: 'P3',
        status: 'open',
      });
    }
    const beyondEnd = await app.inject(
      '/api/findings?application=Atlas%20Admin&limit=2&offset=3',
    );
    expect(beyondEnd.json()).toMatchObject({ data: [], total: 3 });
  });

  it('aggregates seeded findings by each dimension', async () => {
    expect((await app.inject('/api/summary')).json()).toEqual({
      total: 11,
      bySeverity: { critical: 2, high: 3, medium: 3, low: 3 },
      byPriority: { P0: 2, P1: 3, P2: 3, P3: 3 },
      byStatus: { open: 11, resolved: 0 },
      byApplication: {
        'Meridian Payments API': 4,
        'Northstar Portal': 4,
        'Atlas Admin': 3,
      },
    });
  });

  it('updates status and includes resolved findings in summary', async () => {
    const id: string = (await app.inject('/api/findings')).json().data[0].id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/findings/${id}`,
      payload: { status: 'resolved' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe('resolved');
    expect((await app.inject(`/api/findings/${id}`)).json().status).toBe(
      'resolved',
    );
    expect((await app.inject('/api/summary')).json()).toMatchObject({
      total: 11,
      byStatus: { open: 10, resolved: 1 },
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/ingestion/run' })).json(),
    ).toEqual({ processed: 12, created: 0, updated: 12, rejected: 0 });
    expect((await app.inject(`/api/findings/${id}`)).json().status).toBe(
      'resolved',
    );
  });

  it('rejects invalid requests and returns 404 for missing IDs', async () => {
    for (const url of [
      '/api/findings?severity=urgent',
      '/api/findings?limit=0',
      '/api/findings?offset=-1',
      '/api/findings?unknown=x',
    ]) {
      expect((await app.inject(url)).statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/findings/missing',
          payload: { status: 'ignored' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/findings/missing',
          payload: { status: 'open', severity: 'critical' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/findings/missing')).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/findings/missing',
          payload: { status: 'open' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('returns client errors for malformed JSON and oversized bodies', async () => {
    const malformed = await app.inject({
      method: 'PATCH',
      url: '/api/findings/missing',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({
      error: 'Bad Request',
      message: 'Request validation failed',
    });

    const oversized = await app.inject({
      method: 'PATCH',
      url: '/api/findings/missing',
      payload: { status: 'open', padding: 'x'.repeat(1_048_576) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({
      error: 'Payload Too Large',
      message: 'Request validation failed',
    });
  });

  it('hides unexpected errors behind a consistent 500 response', async () => {
    const failing = await buildApp({
      logger: false,
      seed: false,
      queue: {
        receive: async () => {
          throw new Error('private infrastructure detail');
        },
      },
    });
    try {
      const response = await failing.inject({
        method: 'POST',
        url: '/api/ingestion/run',
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'Internal Server Error',
        message: 'Unexpected server error',
      });
      expect(response.body).not.toContain('private infrastructure detail');
    } finally {
      await failing.close();
    }
  });
});
