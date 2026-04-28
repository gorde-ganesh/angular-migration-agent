import OpenAI from 'openai';
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
    type: 'function',
    function: {
      name: 'fetch_peer_deps',
      description: 'Fetch peer dependencies for a specific package@version from npm.',
      parameters: {
        type: 'object',
        properties: {
          package_name: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['package_name', 'version'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'output_compatibility_report',
      description: 'Output the final compatibility and upgrade-order report.',
      parameters: {
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
  },
];

export class CompatibilityResolverAgent {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env['OPENROUTER_API_KEY'],
    });
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
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Resolve upgrade compatibility for this Angular project.\n\nPackages:\n${packageSummary}\n\n${angularHints}\n\nFetch peer deps for key packages at their target versions, then output the ordered upgrade plan.`,
      },
    ];

    let report: CompatibilityReport | null = null;

    let response = await this.client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: 4096,
      messages,
      tools: TOOLS,
    });

    while (response.choices[0].finish_reason === 'tool_calls') {
      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls ?? [];
      const toolResultMap: Record<string, string> = {};

      for (const call of toolCalls) {
        if (call.type !== 'function') continue;

        const toolName = call.function.name;
        const toolInput = JSON.parse(call.function.arguments);
        let result: unknown;

        if (toolName === 'fetch_peer_deps') {
          const input = toolInput as { package_name: string; version: string };
          try {
            const peerDeps = await fetchPeerDepsForVersion(input.package_name, input.version);
            result = peerDeps;
          } catch (e) {
            result = `Error: ${(e as Error).message}`;
          }
        } else if (toolName === 'output_compatibility_report') {
          const input = toolInput as CompatibilityReport;

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
          result = `Unknown tool: ${toolName}`;
        }

        toolResultMap[call.id] = typeof result === 'string' ? result : JSON.stringify(result);
      }

      messages.push({
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });
      for (const call of toolCalls) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultMap[call.id] ?? '' });
      }

      response = await this.client.chat.completions.create({
        model: 'anthropic/claude-sonnet-4-6',
        max_tokens: 4096,
        messages,
        tools: TOOLS,
      });
    }

    if (!report) {
      throw new Error('Compatibility resolver did not produce a report.');
    }

    return report;
  }
}
