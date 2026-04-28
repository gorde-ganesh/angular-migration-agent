#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { MigrationOrchestrator } from './orchestrator';
import { writeReport } from './reporter/migration-reporter';

const program = new Command();

program
  .name('angular-migrate')
  .description('Angular project health + migration orchestrator powered by Claude AI')
  .version('1.0.0');

program
  .command('migrate')
  .description('Audit, plan, and execute a full Angular migration')
  .requiredOption('-p, --project <path>', 'Path to the Angular project root')
  .option('-t, --target <version>', 'Target Angular major version (default: latest)', 'latest')
  .option('-d, --dry-run', 'Analyse and plan without making any changes', false)
  .option('-r, --max-retries <n>', 'Max self-healing retries per step', '3')
  .option('--skip-docs', 'Skip fetching changelogs (faster, less accurate)', false)
  .option('-v, --verbose', 'Show detailed output including error messages', false)
  .option('-o, --output <path>', 'Output path for migration-report.md')
  .action(async (opts) => {
    const projectPath = path.resolve(opts.project);

    if (!fs.existsSync(projectPath)) {
      console.error(chalk.red(`Error: Project path not found: ${projectPath}`));
      process.exit(1);
    }

    if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
      console.error(chalk.red(`Error: No package.json found at ${projectPath}`));
      process.exit(1);
    }

    if (!process.env['ANTHROPIC_API_KEY']) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is not set.'));
      console.error(chalk.gray('  Copy .env.example to .env and add your API key, or export it directly.'));
      process.exit(1);
    }

    const orchestrator = new MigrationOrchestrator({
      projectPath,
      targetVersion: opts.target,
      dryRun: opts.dryRun,
      maxRetries: parseInt(opts.maxRetries, 10),
      verbose: opts.verbose,
      skipDocs: opts.skipDocs,
    });

    try {
      const report = await orchestrator.run();
      const reportPath = writeReport(report, opts.output);

      console.log('\n' + chalk.bold('─'.repeat(60)));
      console.log(
        chalk.bold(report.success ? chalk.green('Migration complete!') : chalk.yellow('Migration finished with issues'))
      );
      console.log(chalk.gray(`Report saved to: ${reportPath}`));

      if (report.manualStepsRequired.length > 0) {
        console.log(chalk.yellow(`\n⚠  ${report.manualStepsRequired.length} manual step(s) require your attention:`));
        for (const step of report.manualStepsRequired) {
          console.log(chalk.yellow(`   • ${step}`));
        }
      }

      if (report.errors.length > 0) {
        console.log(chalk.red(`\n✗  ${report.errors.length} error(s) occurred:`));
        for (const err of report.errors) {
          console.log(chalk.red(`   • ${err}`));
        }
        process.exit(1);
      }
    } catch (e) {
      console.error(chalk.red('\nFatal error:'), (e as Error).message);
      if (opts.verbose) {
        console.error((e as Error).stack);
      }
      process.exit(1);
    }
  });

program
  .command('audit')
  .description('Audit the project and print a version gap report (no changes made)')
  .requiredOption('-p, --project <path>', 'Path to the Angular project root')
  .action(async (opts) => {
    const projectPath = path.resolve(opts.project);

    if (!process.env['ANTHROPIC_API_KEY']) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY is not set.'));
      process.exit(1);
    }

    const { AuditAgent } = await import('./agents/audit-agent');
    console.log(chalk.bold('Auditing Angular project...'));

    try {
      const report = await new AuditAgent().run(projectPath);

      console.log(chalk.bold('\nPackage Version Audit\n'));
      console.log(`${'Package'.padEnd(35)} ${'Current'.padEnd(12)} ${'Latest'.padEnd(12)} Gap`);
      console.log('─'.repeat(70));

      for (const [name, pkg] of Object.entries(report.packages)) {
        const gap = pkg.gap > 0 ? chalk.yellow(`+${pkg.gap} major`) : chalk.green('up to date');
        console.log(
          `${name.padEnd(35)} ${pkg.current.padEnd(12)} ${pkg.latest.padEnd(12)} ${gap}`
        );
      }
    } catch (e) {
      console.error(chalk.red('Audit failed:'), (e as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
