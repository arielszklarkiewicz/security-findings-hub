import { ZodError } from 'zod';
import { fingerprintFor } from '../domain/fingerprint.js';
import { prioritize } from '../domain/prioritization.js';
import type { Finding } from '../domain/finding.js';
import type { FindingsRepository } from '../infrastructure/in-memory-findings-repository.js';
import type { FindingsQueue } from '../infrastructure/mock-findings-queue.js';
import { normalize } from './normalizers.js';

export interface IngestionSummary {
  processed: number;
  created: number;
  updated: number;
  rejected: number;
}

export interface IngestionLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
}

export class IngestionService {
  constructor(
    private readonly queue: FindingsQueue,
    private readonly repository: FindingsRepository,
    private readonly logger: IngestionLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(): Promise<IngestionSummary> {
    this.logger.info({}, 'Ingestion started');
    const records = await this.queue.receive();
    const summary: IngestionSummary = {
      processed: records.length,
      created: 0,
      updated: 0,
      rejected: 0,
    };
    const seenAt = this.now().toISOString();
    for (const [index, record] of records.entries()) {
      try {
        const normalized = normalize(record);
        const fingerprint = fingerprintFor(normalized);
        const { priority, reasons } = prioritize(normalized);
        const { identity: _identity, ...attributes } = normalized;
        void _identity;
        const finding: Finding = {
          ...attributes,
          id: fingerprint,
          fingerprint,
          priority,
          priorityReasons: reasons,
          status: 'open',
          lastSeenAt: seenAt,
        };
        summary[this.repository.upsert(finding)]++;
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        summary.rejected++;
        this.logger.warn(
          {
            index,
            issues: error.issues.map((issue) => ({
              path: issue.path,
              code: issue.code,
            })),
          },
          'Finding rejected',
        );
      }
    }
    this.logger.info(summary, 'Ingestion completed');
    return summary;
  }
}
