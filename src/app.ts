import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import {
  findingSchema,
  prioritySchema,
  severitySchema,
  statusSchema,
} from './domain/finding.js';
import { IngestionService } from './ingestion/ingestion-service.js';
import {
  InMemoryFindingsRepository,
  type FindingsRepository,
} from './infrastructure/in-memory-findings-repository.js';
import {
  MockFindingsQueue,
  type FindingsQueue,
} from './infrastructure/mock-findings-queue.js';

const errorSchema = z.object({ error: z.string(), message: z.string() });
const ingestionSchema = z.object({
  processed: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  rejected: z.number().int(),
});
const listQuerySchema = z.strictObject({
  severity: severitySchema.optional(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  application: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParamsSchema = z.object({ id: z.string().min(1) });
const statusBodySchema = z.strictObject({ status: statusSchema });
const summarySchema = z.object({
  total: z.number().int(),
  bySeverity: z.record(severitySchema, z.number().int()),
  byPriority: z.record(prioritySchema, z.number().int()),
  byStatus: z.record(statusSchema, z.number().int()),
  byApplication: z.record(z.string(), z.number().int()),
});

export interface AppOptions {
  queue?: FindingsQueue;
  repository?: FindingsRepository;
  now?: () => Date;
  seed?: boolean;
  logger?: boolean;
}

export async function buildApp(
  options: AppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Security Findings Hub',
        version: '1.0.0',
        description:
          'Fictional scanner findings and explainable demo prioritization.',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const repository = options.repository ?? new InMemoryFindingsRepository();
  const queue = options.queue ?? new MockFindingsQueue();
  const ingestion = new IngestionService(
    queue,
    repository,
    app.log,
    options.now,
  );
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Process health',
        response: {
          200: z.object({ status: z.literal('ok') }),
          500: errorSchema,
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  routes.post(
    '/api/ingestion/run',
    {
      schema: {
        tags: ['Ingestion'],
        summary:
          'Ingest the repeatable mock scanner batch (public demo endpoint)',
        description:
          'Public for this demo. Authentication and authorization are required in production.',
        response: { 200: ingestionSchema, 500: errorSchema },
      },
    },
    async () => ingestion.run(),
  );

  routes.get(
    '/api/findings',
    {
      schema: {
        tags: ['Findings'],
        summary: 'List findings in stable ID order',
        querystring: listQuerySchema,
        response: {
          200: z.object({
            data: z.array(findingSchema),
            total: z.number().int(),
            limit: z.number().int(),
            offset: z.number().int(),
          }),
          400: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset, ...filters } = request.query;
      return { ...repository.list(filters, limit, offset), limit, offset };
    },
  );

  routes.get(
    '/api/findings/:id',
    {
      schema: {
        tags: ['Findings'],
        summary: 'Get one finding',
        params: idParamsSchema,
        response: {
          200: findingSchema,
          400: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const finding = repository.findById(request.params.id);
      if (!finding)
        return reply
          .code(404)
          .send({ error: 'Not Found', message: 'Finding not found' });
      return finding;
    },
  );

  routes.patch(
    '/api/findings/:id',
    {
      schema: {
        tags: ['Findings'],
        summary: 'Update finding status',
        params: idParamsSchema,
        body: statusBodySchema,
        response: {
          200: findingSchema,
          400: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const finding = repository.updateStatus(
        request.params.id,
        request.body.status,
      );
      if (!finding)
        return reply
          .code(404)
          .send({ error: 'Not Found', message: 'Finding not found' });
      return finding;
    },
  );

  routes.get(
    '/api/summary',
    {
      schema: {
        tags: ['Findings'],
        summary: 'Aggregate all findings, including resolved',
        response: { 200: summarySchema, 500: errorSchema },
      },
    },
    async () => repository.summary(),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.validation ? 400 : error.statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: STATUS_CODES[statusCode] ?? 'Client Error',
        message: 'Request validation failed',
      });
    }
    request.log.error({ err: error }, 'Unexpected request failure');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Unexpected server error',
    });
  });

  await app.ready();
  if (options.seed !== false) await ingestion.run();
  return app;
}
