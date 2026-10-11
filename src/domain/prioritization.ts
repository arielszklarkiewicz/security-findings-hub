import type { Environment, Priority, Severity } from './finding.js';

const severityScores: Record<Severity, number> = {
  critical: 80,
  high: 60,
  medium: 35,
  low: 10,
};
const environmentScores: Record<Environment, number> = {
  production: 15,
  staging: 5,
  development: 0,
};

export function prioritize(input: {
  severity: Severity;
  environment: Environment;
  internetFacing: boolean;
}): { priority: Priority; score: number; reasons: string[] } {
  const score =
    severityScores[input.severity] +
    environmentScores[input.environment] +
    (input.internetFacing ? 15 : 0);
  const priority: Priority =
    score >= 95 ? 'P0' : score >= 75 ? 'P1' : score >= 40 ? 'P2' : 'P3';
  return {
    priority,
    score,
    reasons: [
      `${input.severity} severity: +${severityScores[input.severity]}`,
      `${input.environment} environment: +${environmentScores[input.environment]}`,
      `internet-facing: +${input.internetFacing ? 15 : 0}`,
      `total score ${score} maps to ${priority}`,
    ],
  };
}
