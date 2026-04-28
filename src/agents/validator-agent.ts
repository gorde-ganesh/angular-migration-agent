import Anthropic from '@anthropic-ai/sdk';
import type { BuildError, MessageParam, Tool, ValidationResult } from '../types';
import { runCommand } from '../tools/command-runner';
import { readFile, fileExists } from '../tools/file-tools';
import path from 'path';

const SYSTEM_PROMPT = `You are the Validator Agent for an Angular migration orchestrator.

Your job is to validate that an Angular project builds and type-checks correctly after each migration step.

Steps:
1. Run "npx tsc --noEmit" to check for TypeScript errors.
2. If package.json exists and has "build" script, optionally run "npm run build" for full Angular compilation.
3. Parse any errors from the output — extract file, line, column, error code, and message.
4. Call output_validation_result with the parsed results.

Error parsing rules:
- TypeScript errors format: "path/to/file.ts(line,col): error TSxxxx: message"
- Angular compiler errors may appear differently
- Warnings are not errors — only flag actual errors

Be precise about which errors are blocking (build failures) vs warnings.`;

const TOOLS: Tool[] = [
  {
    name: 'run_command',
    description: 'Run a shell command to validate the build.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file to inspect errors or configuration.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'output_validation_result',
    description: 'Output the validation result.',
    input_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              column: { type: 'number' },
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
        rawOutput: { type: 'string' },
      },
      required: ['success', 'errors', 'warnings', 'rawOutput'],
    },
  },
];

export class ValidatorAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async validate(projectPath: string): Promise<ValidationResult> {
    const hasTsConfig = fileExists(path.join(projectPath, 'tsconfig.json'));
    const hasAngularJson = fileExists(path.join(projectPath, 'angular.json'));

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: `Validate the Angular project at: ${projectPath}

Available config files:
- tsconfig.json: ${hasTsConfig ? 'YES' : 'NO'}
- angular.json: ${hasAngularJson ? 'YES' : 'NO'}

Run TypeScript type-checking first (npx tsc --noEmit), then parse any errors and output the validation result.`,
      },
    ];

    let result: ValidationResult | null = null;

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

        let toolResult: unknown;

        if (block.name === 'run_command') {
          const input = block.input as { command: string; cwd?: string };
          const cmdResult = runCommand(input.command, input.cwd ?? projectPath, 180_000);
          toolResult = {
            exitCode: cmdResult.exitCode,
            stdout: cmdResult.stdout.slice(0, 4000),
            stderr: cmdResult.stderr.slice(0, 2000),
            success: cmdResult.success,
          };
        } else if (block.name === 'read_file') {
          const input = block.input as { path: string };
          try {
            toolResult = await readFile(input.path);
          } catch (e) {
            toolResult = `Error: ${(e as Error).message}`;
          }
        } else if (block.name === 'output_validation_result') {
          const input = block.input as ValidationResult;
          result = input;
          toolResult = 'Validation result recorded.';
        } else {
          toolResult = `Unknown tool: ${block.name}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
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

    // Fallback: if agent didn't use output tool, infer from conversation
    if (!result) {
      result = this.fallbackValidation(projectPath);
    }

    return result;
  }

  /** Direct validation without Claude — used as fallback and in dry-run scenarios. */
  private fallbackValidation(projectPath: string): ValidationResult {
    const hasTsConfig = fileExists(path.join(projectPath, 'tsconfig.json'));
    if (!hasTsConfig) {
      return {
        success: true,
        errors: [],
        warnings: ['No tsconfig.json found — skipping TypeScript validation'],
        rawOutput: '',
      };
    }

    const result = runCommand('npx tsc --noEmit 2>&1', projectPath, 120_000);
    const errors = this.parseTscOutput(result.stdout + result.stderr);

    return {
      success: result.success && errors.length === 0,
      errors,
      warnings: [],
      rawOutput: (result.stdout + result.stderr).slice(0, 5000),
    };
  }

  private parseTscOutput(output: string): BuildError[] {
    const errors: BuildError[] = [];
    // TypeScript error format: path(line,col): error TSxxxx: message
    const pattern = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[4],
        message: match[5],
      });
    }

    return errors;
  }
}
