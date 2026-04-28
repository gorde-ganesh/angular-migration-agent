import type Anthropic from '@anthropic-ai/sdk';

export type MessageParam = Anthropic.MessageParam;
export type Tool = Anthropic.Tool;
export type TextBlockParam = Anthropic.TextBlockParam;

// ── Audit ──────────────────────────────────────────────────────────────────

export interface PackageAudit {
  current: string;
  latest: string;
  gap: number;
  isDirect: boolean;
  peerDeps: Record<string, string>;
  deprecated?: string;
}

export interface AuditReport {
  packages: Record<string, PackageAudit>;
  projectPath: string;
  auditedAt: string;
}

// ── Doc Store (RAG) ────────────────────────────────────────────────────────

export interface DocChunk {
  id: string;
  source: string;
  title: string;
  content: string;
}

export interface DocStore {
  chunks: DocChunk[];
}

// ── Compatibility ──────────────────────────────────────────────────────────

export interface Conflict {
  package: string;
  conflictsWith: string;
  reason: string;
  resolution: string;
}

export interface UpgradeStep {
  order: number;
  package: string;
  fromVersion: string;
  toVersion: string;
  intermediateVersions: string[];
  notes: string[];
}

export interface CompatibilityReport {
  conflicts: Conflict[];
  upgradeOrder: UpgradeStep[];
  blockers: string[];
  summary: string;
}

// ── Migration Plan ─────────────────────────────────────────────────────────

export type PlanStepType =
  | 'prerequisite'
  | 'dependency-upgrade'
  | 'code-migration'
  | 'config-change'
  | 'validation'
  | 'manual';

export interface PlanStep {
  id: string;
  order: number;
  type: PlanStepType;
  description: string;
  commands?: string[];
  targetFiles?: string[];
  migrationRule?: string;
  notes?: string;
  requiresManualReview?: boolean;
}

export interface MigrationPlan {
  steps: PlanStep[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  manualStepsRequired: string[];
  totalSteps: number;
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface BuildError {
  file?: string;
  line?: number;
  column?: number;
  code: string;
  message: string;
}

export interface ValidationResult {
  success: boolean;
  errors: BuildError[];
  warnings: string[];
  rawOutput: string;
}

// ── Execution ──────────────────────────────────────────────────────────────

export interface ExecutionLogEntry {
  stepId: string;
  action: string;
  result: 'success' | 'failure' | 'skipped';
  details: string;
  timestamp: string;
}

// ── Final Report ───────────────────────────────────────────────────────────

export interface MigrationReport {
  projectPath: string;
  startTime: string;
  endTime: string;
  audit: AuditReport;
  compatibility: CompatibilityReport;
  plan: MigrationPlan;
  executionLog: ExecutionLogEntry[];
  filesModified: string[];
  manualStepsRequired: string[];
  success: boolean;
  errors: string[];
}

// ── Orchestrator Options ───────────────────────────────────────────────────

export interface OrchestratorOptions {
  projectPath: string;
  targetVersion?: string;
  dryRun?: boolean;
  maxRetries?: number;
  verbose?: boolean;
  skipDocs?: boolean;
}
