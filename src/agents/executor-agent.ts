import OpenAI from 'openai';
import type { DocStore, MessageParam, PlanStep, Tool, ValidationResult } from '../types';
import { readFile, writeFile, listFiles } from '../tools/file-tools';
import { runCommand } from '../tools/command-runner';
import { semanticSearch } from '../tools/doc-store';

const SYSTEM_PROMPT = `You are the Executor Agent for an Angular migration orchestrator.

You execute individual migration steps on a real Angular codebase. You have access to file read/write tools and can run shell commands.

For dependency-upgrade steps: run the provided npm commands, then verify with a quick tsc check.
For code-migration steps: read the target files, apply the migration pattern, write the changes.
For config-change steps: read and modify tsconfig.json, angular.json, or other config files.
For prerequisite steps: verify the environment meets requirements.

Code migration patterns to apply:
- *ngIf="expr" → @if (expr) { ... }
- *ngFor="let x of list" → @for (x of list; track x) { ... }
- NgModule-based → Standalone: add standalone: true, remove from NgModule declarations
- @Input() name: Type → name = input<Type>()
- @Output() event = new EventEmitter<T>() → event = output<T>()
- HttpClientModule → provideHttpClient() in app config
- RouterModule.forRoot(routes) → provideRouter(routes)

IMPORTANT: When you have error context from a previous validation failure:
1. Read the failing files first to understand the current state.
2. Use semantic_search to look up guidance for the specific error code.
3. Apply targeted fixes — don't rewrite code that's already correct.
4. Be conservative: only change what's needed to fix the errors.

Always call complete_step when you're done with the step.`;

const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the filesystem.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (creates parent directories as needed).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Complete new file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List TypeScript and HTML files in a directory (excludes node_modules, dist).',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string' },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'e.g. [".ts", ".html"]',
          },
        },
        required: ['directory'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Search the fetched Angular/NgRx documentation for migration guidance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          top_k: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_step',
      description: 'Signal that the current step has been completed (or skipped).',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What was done' },
          filesModified: { type: 'array', items: { type: 'string' } },
          skipped: { type: 'boolean', description: 'True if step was not applicable' },
        },
        required: ['summary'],
      },
    },
  },
];

export interface ExecutionResult {
  summary: string;
  filesModified: string[];
  skipped: boolean;
}

export class ExecutorAgent {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env['OPENROUTER_API_KEY'],
    });
  }

  async executeStep(
    step: PlanStep,
    projectPath: string,
    docStore: DocStore,
    errorContext?: ValidationResult,
    dryRun = false
  ): Promise<ExecutionResult> {
    const errorSection = errorContext
      ? `\n\nPREVIOUS VALIDATION FAILED — fix these errors:\n${errorContext.errors
          .map((e) => `  ${e.code}: ${e.message}${e.file ? ` (${e.file}:${e.line})` : ''}`)
          .join('\n')}\n\nRaw output:\n${errorContext.rawOutput.slice(0, 2000)}`
      : '';

    const dryRunNotice = dryRun
      ? '\n\nDRY RUN MODE: Read files and plan changes but do NOT call write_file or run_command.'
      : '';

    const messages: MessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Execute migration step [${step.id}]: ${step.description}

Type: ${step.type}
${step.commands ? `Commands to run:\n${step.commands.map((c) => `  ${c}`).join('\n')}` : ''}
${step.targetFiles ? `Target files:\n${step.targetFiles.map((f) => `  ${f}`).join('\n')}` : ''}
${step.migrationRule ? `Migration rule: ${step.migrationRule}` : ''}
${step.notes ? `Notes: ${step.notes}` : ''}

Project root: ${projectPath}
${errorSection}${dryRunNotice}

Complete the step, then call complete_step.`,
      },
    ];

    let result: ExecutionResult = { summary: 'Step not completed', filesModified: [], skipped: false };

    let response = await this.client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: 8192,
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
        let toolResult: unknown;

        if (toolName === 'read_file') {
          const input = toolInput as { path: string };
          try {
            toolResult = await readFile(input.path);
          } catch (e) {
            toolResult = `Error: ${(e as Error).message}`;
          }
        } else if (toolName === 'write_file') {
          const input = toolInput as { path: string; content: string };
          if (dryRun) {
            toolResult = `[DRY RUN] Would write ${input.path} (${input.content.length} chars)`;
          } else {
            try {
              await writeFile(input.path, input.content);
              toolResult = `Written: ${input.path}`;
            } catch (e) {
              toolResult = `Error writing ${input.path}: ${(e as Error).message}`;
            }
          }
        } else if (toolName === 'list_files') {
          const input = toolInput as { directory: string; extensions?: string[] };
          const exts = input.extensions ?? ['.ts', '.html'];
          try {
            toolResult = listFiles(input.directory, exts);
          } catch (e) {
            toolResult = `Error: ${(e as Error).message}`;
          }
        } else if (toolName === 'run_command') {
          const input = toolInput as { command: string; cwd?: string };
          if (dryRun) {
            toolResult = `[DRY RUN] Would run: ${input.command}`;
          } else {
            const cmdResult = runCommand(input.command, input.cwd ?? projectPath);
            toolResult = {
              exitCode: cmdResult.exitCode,
              stdout: cmdResult.stdout.slice(0, 3000),
              stderr: cmdResult.stderr.slice(0, 1000),
            };
          }
        } else if (toolName === 'semantic_search') {
          const input = toolInput as { query: string; top_k?: number };
          const chunks = semanticSearch(input.query, docStore, input.top_k ?? 5);
          toolResult =
            chunks.length > 0
              ? chunks.map((c) => `[${c.source}]\n${c.title}\n${c.content}`).join('\n\n---\n\n')
              : 'No matching documentation found.';
        } else if (toolName === 'complete_step') {
          const input = toolInput as {
            summary: string;
            filesModified?: string[];
            skipped?: boolean;
          };
          result = {
            summary: input.summary,
            filesModified: input.filesModified ?? [],
            skipped: input.skipped ?? false,
          };
          toolResult = 'Step completed.';
        } else {
          toolResult = `Unknown tool: ${toolName}`;
        }

        toolResultMap[call.id] = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
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
        max_tokens: 8192,
        messages,
        tools: TOOLS,
      });
    }

    return result;
  }
}
