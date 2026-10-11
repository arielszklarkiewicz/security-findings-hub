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
