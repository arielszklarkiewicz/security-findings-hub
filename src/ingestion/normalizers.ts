import { z } from 'zod';
import {
  environmentSchema,
  severitySchema,
  type NormalizedFinding,
} from '../domain/finding.js';

const common = {
  application: z.string().trim().min(1),
  environment: environmentSchema,
  internetFacing: z.boolean(),
  severity: severitySchema,
  detectedAt: z.iso.datetime(),
};

export const dependencySchema = z.strictObject({
  source: z.literal('dependency'),
  ...common,
  packageName: z.string().trim().min(1),
  advisoryId: z.string().trim().min(1),
  version: z.string().trim().min(1),
  details: z.string().trim().min(1),
});
export const staticSchema = z.strictObject({
  source: z.literal('static-analysis'),
  ...common,
  ruleId: z.string().trim().min(1),
  file: z.string().trim().min(1),
  line: z.number().int().positive(),
  message: z.string().trim().min(1),
});
export const cloudSchema = z.strictObject({
  source: z.literal('cloud-config'),
  ...common,
  resourceId: z.string().trim().min(1),
  controlId: z.string().trim().min(1),
  resourceType: z.string().trim().min(1),
  observation: z.string().trim().min(1),
});

export const rawFindingSchema = z.discriminatedUnion('source', [
  dependencySchema,
  staticSchema,
  cloudSchema,
]);

export function normalize(raw: unknown): NormalizedFinding {
  const finding = rawFindingSchema.parse(raw);
  const shared = {
    source: finding.source,
    application: finding.application,
    severity: finding.severity,
    environment: finding.environment,
    internetFacing: finding.internetFacing,
    detectedAt: finding.detectedAt,
  };
  switch (finding.source) {
    case 'dependency':
      return {
        ...shared,
        category: 'vulnerable-dependency',
        identity: JSON.stringify([finding.packageName, finding.advisoryId]),
        title: `${finding.advisoryId} in ${finding.packageName}`,
        description: `${finding.details} Affected version: ${finding.version}.`,
      };
    case 'static-analysis':
      return {
        ...shared,
        category: 'static-analysis',
        identity: JSON.stringify([finding.ruleId, finding.file, finding.line]),
        title: `${finding.ruleId} in ${finding.file}`,
        description: finding.message,
      };
    case 'cloud-config':
      return {
        ...shared,
        category: 'cloud-configuration',
        identity: JSON.stringify([finding.resourceId, finding.controlId]),
        title: `${finding.controlId} on ${finding.resourceType}`,
        description: finding.observation,
      };
  }
}
