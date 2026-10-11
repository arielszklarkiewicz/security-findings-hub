import { z } from 'zod';

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const environmentSchema = z.enum([
  'production',
  'staging',
  'development',
]);
export const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
export const statusSchema = z.enum(['open', 'resolved']);
export const sourceSchema = z.enum([
  'dependency',
  'static-analysis',
  'cloud-config',
]);

export const findingSchema = z.object({
  id: z.string(),
  fingerprint: z.string().describe('Stable SHA-256 identity for deduplication'),
  source: sourceSchema,
  application: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  severity: severitySchema,
  environment: environmentSchema,
  internetFacing: z.boolean(),
  priority: prioritySchema,
  priorityReasons: z
    .array(z.string())
    .describe('Human-readable terms used to calculate the priority'),
  status: statusSchema,
  detectedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export type Finding = z.infer<typeof findingSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type Status = z.infer<typeof statusSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type NormalizedFinding = Omit<
  Finding,
  | 'id'
  | 'fingerprint'
  | 'priority'
  | 'priorityReasons'
  | 'status'
  | 'lastSeenAt'
> & { identity: string };
