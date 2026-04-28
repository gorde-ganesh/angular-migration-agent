import Anthropic from '@anthropic-ai/sdk';
import type { AuditReport, CompatibilityReport, MessageParam, Tool } from '../types';
import { fetchPeerDepsForVersion } from '../tools/npm-registry';
import { getIncrementalMajors, getMajorVersion } from '../tools/semver-utils';

const SYSTEM_PROMPT = `You are the Compatibility Resolver Agent for an Angular migration orchestrator.

Your job is to determine a SAFE, ORDERED upgrade path that respects all peer dependency constraints.

Key Angular upgrade rules you must enforce:
1. Angular recommends upgrading ONE MAJOR VERSION AT A TIME (e.g. 14→15→16→17→18→19).
2. @angular/material and @angular/cdk must always match @angular/core's major version.
3. @ngrx/* packages must match or be compatible with the Angular version.
4. TypeScript must be upgraded BEFORE the Angular version that requires it.
5. Node.js requirements should be flagged as prerequisites.
6. RxJS v7 is required for Angular 14+; RxJS v8 (if released) for newer Angular.

Steps:
1. Call fetch_peer_deps for each package at both current and target versions to understand constraints.
2. Build the upgrade constraint graph by identifying what must come before what.
3. Detect conflicts where peer requirements cannot be satisfied simultaneously.
4. Call output_compatibility_report with the ordered upgrade steps and any conflicts.

Always prefer the safe incremental path over the fastest path.`;

const TOOLS: Tool[] = [
  {
    name: 'fetch_peer_deps',
    description: 'Fetch peer dependencies for a specific package@version from npm.',
    input_schema: {
      type: 'object',
      properties: {
        package_name: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['package_name', 'version'],
    },
  },
  {
    name: 'output_compatibility_report',
    description: 'Output the final compatibility and upgrade-order report.',
    input_schema: {
      type: 'object',
      properties: {
        conflicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              package: { type: 'string' },
              conflictsWith: { type: 'string' },
              reason: { type: 'string' },
              resolution: { type: 'string' },
            },
            required: ['package', 'conflictsWith', 'reason', 'resolution'],
          },
        },
        upgradeOrder: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order: { type: 'number' },
              package: { type: 'string' },
              fromVersion: { type: 'string' },
              toVersion: { type: 'string' },
              intermediateVersions: { type: 'array', items: { type: 'string' } },
              notes: { type: 'array', items: { type: 'string' } },
            },
            required: ['order', 'package', 'fromVersion', 'toVersion', 'intermediateVersions', 'notes'],
          },
        },
        blockers: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['conflicts', 'upgradeOrder', 'blockers', 'summary'],
    },
  },
];

export class CompatibilityResolverAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async run(audit: AuditReport): Promise<CompatibilityReport> {
    const packageSummary = Object.entries(audit.packages)
      .map(([name, p]) => `${name}: ${p.current} → ${p.latest} (gap: ${p.gap} majors)`)
      .join('\n');

    // Pre-compute incremental paths for Angular to help the agent
    const angularCore = audit.packages['@angular/core'];
    const angularHints = angularCore
      ? `Angular incremental majors: ${getIncrementalMajors(angularCore.current, angularCore.latest).join(', ')}`
      : '';

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: `Resolve upgrade compatibility for this Angular project.\n\nPackages:\n${packageSummary}\n\n${angularHints}\n\nFetch peer deps for key packages at their target versions, then output the ordered upgrade plan.`,
      },
    ];

    let report: CompatibilityReport | null = null;

    let response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.MessageParam['content'] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: unknown;

        if (block.name === 'fetch_peer_deps') {
          const input = block.input as { package_name: string; version: string };
          try {
            const peerDeps = await fetchPeerDepsForVersion(input.package_name, input.version);
            result = peerDeps;
          } catch (e) {
            result = `Error: ${(e as Error).message}`;
          }
        } else if (block.name === 'output_compatibility_report') {
          const input = block.input as CompatibilityReport;

          // Enrich intermediate versions using semver utils for Angular packages
          const enriched = input.upgradeOrder.map((step) => {
            const needsIncremental =
              step.package.startsWith('@angular/') && getMajorVersion(step.toVersion) - getMajorVersion(step.fromVersion) > 1;

            return {
              ...step,
              intermediateVersions:
                needsIncremental && step.intermediateVersions.length === 0
                  ? getIncrementalMajors(step.fromVersion, step.toVersion)
                  : step.intermediateVersions,
            };
          });

          report = { ...input, upgradeOrder: enriched };
          result = 'Compatibility report recorded.';
        } else {
          result = `Unknown tool: ${block.name}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
    }

    if (!report) {
      throw new Error('Compatibility resolver did not produce a report.');
    }

    return report;
  }
}
