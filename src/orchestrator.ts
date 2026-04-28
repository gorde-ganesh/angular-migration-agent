import chalk from 'chalk';
import type {
  AuditReport,
  CompatibilityReport,
  DocStore,
  ExecutionLogEntry,
  MigrationPlan,
  MigrationReport,
  OrchestratorOptions,
  PlanStep,
  ValidationResult,
} from './types';
import { AuditAgent } from './agents/audit-agent';
import { DocsFetcherAgent } from './agents/docs-fetcher-agent';
import { CompatibilityResolverAgent } from './agents/compatibility-resolver-agent';
import { PlannerAgent } from './agents/planner-agent';
import { ExecutorAgent } from './agents/executor-agent';
import { ValidatorAgent } from './agents/validator-agent';
import { createDocStore } from './tools/doc-store';

const DEFAULT_MAX_RETRIES = 3;

export class MigrationOrchestrator {
  private opts: Required<OrchestratorOptions>;
  private executionLog: ExecutionLogEntry[] = [];
  private filesModified: string[] = [];
  private errors: string[] = [];

  constructor(opts: OrchestratorOptions) {
    this.opts = {
      targetVersion: 'latest',
      dryRun: false,
      maxRetries: DEFAULT_MAX_RETRIES,
      verbose: false,
      skipDocs: false,
      ...opts,
    };
  }

  async run(): Promise<MigrationReport> {
    const startTime = new Date().toISOString();
    this.log(chalk.bold.blue('Angular Migration Agent'), 'Starting orchestration...\n');

    let audit: AuditReport;
    let docStore: DocStore = createDocStore();
    let compatibility: CompatibilityReport;
    let plan: MigrationPlan;

    // ── Phase 1: Audit ────────────────────────────────────────────────────
    this.log(chalk.bold('Phase 1/6:'), 'Auditing project...');
    try {
      audit = await new AuditAgent().run(this.opts.projectPath);
      this.logEntry('audit', 'Scanned packages', 'success', this.summariseAudit(audit));
      this.log(chalk.green('  ✓ Audit complete —'), `${Object.keys(audit.packages).length} packages analysed`);
    } catch (e) {
      throw new Error(`Audit failed: ${(e as Error).message}`);
    }

    // ── Phase 2: Docs Fetcher ─────────────────────────────────────────────
    if (!this.opts.skipDocs) {
      this.log(chalk.bold('\nPhase 2/6:'), 'Fetching migration documentation...');
      try {
        docStore = await new DocsFetcherAgent().run(audit);
        this.logEntry('docs', 'Fetched changelogs', 'success', `${docStore.chunks.length} doc chunks stored`);
        this.log(chalk.green('  ✓ Docs fetched —'), `${docStore.chunks.length} chunks stored`);
      } catch (e) {
        this.log(chalk.yellow('  ⚠ Docs fetch failed (continuing without):'), (e as Error).message);
        this.logEntry('docs', 'Fetch changelogs', 'failure', (e as Error).message);
      }
    } else {
      this.log(chalk.gray('\nPhase 2/6: Skipped (--skip-docs)'));
    }

    // ── Phase 3: Compatibility Resolver ───────────────────────────────────
    this.log(chalk.bold('\nPhase 3/6:'), 'Resolving compatibility...');
    try {
      compatibility = await new CompatibilityResolverAgent().run(audit);
      this.logEntry('compatibility', 'Resolved upgrade order', 'success', compatibility.summary);
      this.log(chalk.green('  ✓ Compatibility resolved —'), `${compatibility.upgradeOrder.length} upgrade steps`);
      if (compatibility.conflicts.length > 0) {
        this.log(chalk.yellow(`  ⚠ ${compatibility.conflicts.length} conflict(s) detected`));
      }
    } catch (e) {
      throw new Error(`Compatibility resolution failed: ${(e as Error).message}`);
    }

    // ── Phase 4: Planner ──────────────────────────────────────────────────
    this.log(chalk.bold('\nPhase 4/6:'), 'Planning migration steps...');
    try {
      plan = await new PlannerAgent().run(audit, compatibility, docStore);
      this.logEntry('plan', 'Created migration plan', 'success', `${plan.totalSteps} steps, complexity: ${plan.estimatedComplexity}`);
      this.log(chalk.green('  ✓ Plan created —'), `${plan.totalSteps} steps (${plan.estimatedComplexity} complexity)`);
    } catch (e) {
      throw new Error(`Planning failed: ${(e as Error).message}`);
    }

    // ── Phase 5: Execute + Validate (self-healing loop) ───────────────────
    this.log(chalk.bold('\nPhase 5/6:'), 'Executing migration plan...');
    const executor = new ExecutorAgent();
    const validator = new ValidatorAgent();
    let overallSuccess = true;

    if (this.opts.dryRun) {
      this.log(chalk.yellow('  DRY RUN — no files will be written'));
    }

    for (const step of plan.steps.sort((a, b) => a.order - b.order)) {
      if (step.requiresManualReview) {
        this.log(chalk.yellow(`  ⚠ Step ${step.order} requires manual review — skipping: ${step.description}`));
        this.logEntry(step.id, step.description, 'skipped', 'Manual review required');
        continue;
      }

      this.log(chalk.cyan(`  → Step ${step.order}/${plan.totalSteps}:`), step.description);

      const stepFiles = await this.executeWithValidation(step, executor, validator, docStore);
      this.filesModified.push(...stepFiles);
    }

    // ── Phase 6: Final Report ─────────────────────────────────────────────
    this.log(chalk.bold('\nPhase 6/6:'), 'Generating report...');
    const endTime = new Date().toISOString();

    const report: MigrationReport = {
      projectPath: this.opts.projectPath,
      startTime,
      endTime,
      audit,
      compatibility,
      plan,
      executionLog: this.executionLog,
      filesModified: [...new Set(this.filesModified)],
      manualStepsRequired: plan.manualStepsRequired,
      success: overallSuccess && this.errors.length === 0,
      errors: this.errors,
    };

    return report;
  }

  /**
   * The self-healing loop: execute a step, validate, retry with error context on failure.
   */
  private async executeWithValidation(
    step: PlanStep,
    executor: ExecutorAgent,
    validator: ValidatorAgent,
    docStore: DocStore
  ): Promise<string[]> {
    let lastError: ValidationResult | undefined;
    let allFilesModified: string[] = [];

    for (let attempt = 1; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 1) {
        this.log(
          chalk.yellow(`    ↻ Retry ${attempt}/${this.opts.maxRetries}`),
          `fixing ${lastError!.errors.length} error(s)...`
        );
      }

      try {
        const execResult = await executor.executeStep(
          step,
          this.opts.projectPath,
          docStore,
          lastError,
          this.opts.dryRun
        );

        allFilesModified.push(...execResult.filesModified);

        if (execResult.skipped) {
          this.logEntry(step.id, step.description, 'skipped', execResult.summary);
          this.log(chalk.gray(`    ⏭ Skipped: ${execResult.summary}`));
          return allFilesModified;
        }

        // Validate (skip in dry-run since no real changes were made)
        if (!this.opts.dryRun) {
          const validation = await validator.validate(this.opts.projectPath);

          if (validation.success) {
            this.logEntry(step.id, step.description, 'success', execResult.summary);
            this.log(chalk.green(`    ✓ Validated`));
            return allFilesModified;
          }

          // Validation failed — prepare for retry
          lastError = validation;
          if (this.opts.verbose) {
            this.log(chalk.red(`    ✗ Validation failed:`));
            for (const err of validation.errors.slice(0, 3)) {
              this.log(chalk.red(`      ${err.code}: ${err.message}`));
            }
          } else {
            this.log(chalk.red(`    ✗ ${validation.errors.length} error(s) — retrying...`));
          }
        } else {
          this.logEntry(step.id, step.description, 'success', `[dry-run] ${execResult.summary}`);
          this.log(chalk.green(`    ✓ Completed (dry-run)`));
          return allFilesModified;
        }
      } catch (e) {
        const msg = (e as Error).message;
        this.log(chalk.red(`    ✗ Error: ${msg}`));

        if (attempt === this.opts.maxRetries) {
          this.logEntry(step.id, step.description, 'failure', msg);
          this.errors.push(`Step ${step.id} failed: ${msg}`);
          return allFilesModified;
        }
      }
    }

    this.logEntry(
      step.id,
      step.description,
      'failure',
      `Failed after ${this.opts.maxRetries} attempts. Last errors: ${lastError?.errors.map((e) => e.code).join(', ')}`
    );
    this.errors.push(`Step ${step.id} failed after ${this.opts.maxRetries} retries`);
    return allFilesModified;
  }

  private logEntry(
    stepId: string,
    action: string,
    result: ExecutionLogEntry['result'],
    details: string
  ): void {
    this.executionLog.push({ stepId, action, result, details, timestamp: new Date().toISOString() });
  }

  private log(...args: string[]): void {
    console.log(...args);
  }

  private summariseAudit(audit: AuditReport): string {
    const outdated = Object.entries(audit.packages).filter(([, v]) => v.gap > 0);
    return `${outdated.length} outdated packages`;
  }
}
