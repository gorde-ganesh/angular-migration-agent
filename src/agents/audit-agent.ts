import OpenAI from 'openai';
import type { AuditReport, MessageParam, Tool } from '../types';
import { readFile } from '../tools/file-tools';
import { fetchNpmRegistry } from '../tools/npm-registry';
import { majorGap } from '../tools/semver-utils';
import path from 'path';

const SYSTEM_PROMPT = `You are the Audit Agent for an Angular migration orchestrator.

Your job:
1. Read the project's package.json (and package-lock.json if present) to find all installed packages and their current versions.
2. Call fetch_npm_registry for each Angular-related package to get its latest version and peer dependencies.
3. Focus on: @angular/core, @angular/common, @angular/forms, @angular/router, @angular/platform-browser, @angular/compiler, @angular/animations, @angular/material, @angular/cdk, @ngrx/store, @ngrx/effects, @ngrx/entity, @ngrx/router-store, rxjs, typescript, zone.js
4. Identify which packages are direct dependencies vs devDependencies.
5. Call output_audit_report with the complete structured findings.

Be thorough — check every @angular/* and closely related package you find in package.json.`;

const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_npm_registry',
      description: 'Fetch latest version and peer dependencies for a package from npm registry.',
      parameters: {
        type: 'object',
        properties: {
          package_name: { type: 'string', description: 'npm package name, e.g. @angular/core' },
        },
        required: ['package_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'output_audit_report',
      description: 'Output the final audit report as structured JSON.',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'object',
            description:
              'Map of package name to audit data: { current, latest, gap, isDirect, peerDeps, deprecated? }',
            additionalProperties: {
              type: 'object',
              properties: {
                current: { type: 'string' },
                latest: { type: 'string' },
                gap: { type: 'number' },
                isDirect: { type: 'boolean' },
                peerDeps: { type: 'object' },
                deprecated: { type: 'string' },
              },
              required: ['current', 'latest', 'gap', 'isDirect', 'peerDeps'],
            },
          },
        },
        required: ['packages'],
      },
    },
  },
];

export class AuditAgent {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env['OPENROUTER_API_KEY'],
    });
  }

  async run(projectPath: string): Promise<AuditReport> {
    const pkgJsonPath = path.join(projectPath, 'package.json');

    const messages: MessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Audit the Angular project at: ${projectPath}\n\nStart by reading ${pkgJsonPath}, then fetch npm registry data for each relevant package you find.`,
      },
    ];

    let auditPackages: AuditReport['packages'] | null = null;

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

        if (toolName === 'read_file') {
          const input = toolInput as { path: string };
          try {
            result = await readFile(input.path);
          } catch (e) {
            result = `Error: ${(e as Error).message}`;
          }
        } else if (toolName === 'fetch_npm_registry') {
          const input = toolInput as { package_name: string };
          try {
            const data = await fetchNpmRegistry(input.package_name);
            result = data;
          } catch (e) {
            result = `Error fetching ${input.package_name}: ${(e as Error).message}`;
          }
        } else if (toolName === 'output_audit_report') {
          const input = toolInput as { packages: Record<string, unknown> };
          const packages: AuditReport['packages'] = {};
          for (const [name, raw] of Object.entries(input.packages)) {
            const p = raw as {
              current: string;
              latest: string;
              isDirect: boolean;
              peerDeps: Record<string, string>;
              deprecated?: string;
            };
            packages[name] = {
              ...p,
              gap: majorGap(p.current, p.latest),
              peerDeps: p.peerDeps ?? {},
            };
          }
          auditPackages = packages;
          result = 'Audit report recorded.';
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

    if (!auditPackages) {
      throw new Error('Audit agent did not produce a report. Check your OPENROUTER_API_KEY.');
    }

    return {
      packages: auditPackages,
      projectPath,
      auditedAt: new Date().toISOString(),
    };
  }
}
