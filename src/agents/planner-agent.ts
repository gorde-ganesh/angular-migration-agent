import Anthropic from '@anthropic-ai/sdk';
import type {
  AuditReport,
  CompatibilityReport,
  DocStore,
  MessageParam,
  MigrationPlan,
  Tool,
} from '../types';
import { semanticSearch } from '../tools/doc-store';

const SYSTEM_PROMPT = `You are the Planner Agent for an Angular migration orchestrator.

Your job is to produce an ordered, executable migration plan from the audit and compatibility analysis.

Plan structure rules:
1. Prerequisites come first (Node.js version check, environment setup).
2. TypeScript upgrade before Angular upgrade (if needed).
3. Angular core packages before Angular Material/CDK.
4. Angular before NgRx.
5. Code migration steps (deprecated API rewrites) come AFTER package upgrades.
6. Each step must be atomic — one clear action.
7. Steps that require manual developer attention must be flagged with requiresManualReview: true.

Angular code migration rules to include (when applicable):
- *ngIf → @if (Angular 17+ control flow)
- *ngFor → @for (Angular 17+ control flow)
- NgModule → Standalone components (Angular 14+)
- @Input() decorator → input() signal (Angular 17+)
- @Output() decorator → output() signal (Angular 17+)
- HttpClientModule → provideHttpClient() (Angular 15+)
- RouterModule → provideRouter() (Angular 15+)
- ChangeDetectionStrategy.Default → OnPush or Zoneless (Angular 18+)

Use semantic_search to look up specific migration guidance from the fetched docs.
Then call output_migration_plan with the complete ordered plan.`;

const TOOLS: Tool[] = [
  {
    name: 'semantic_search',
    description: 'Search the fetched documentation for relevant migration guidance.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "NgRx 17 breaking changes"' },
        top_k: { type: 'number', description: 'Number of results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'output_migration_plan',
    description: 'Output the final ordered migration plan.',
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              order: { type: 'number' },
              type: {
                type: 'string',
                enum: ['prerequisite', 'dependency-upgrade', 'code-migration', 'config-change', 'validation', 'manual'],
              },
              description: { type: 'string' },
              commands: { type: 'array', items: { type: 'string' } },
              targetFiles: { type: 'array', items: { type: 'string' } },
              migrationRule: { type: 'string' },
              notes: { type: 'string' },
              requiresManualReview: { type: 'boolean' },
            },
            required: ['id', 'order', 'type', 'description'],
          },
        },
        estimatedComplexity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
        },
        manualStepsRequired: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['steps', 'estimatedComplexity', 'manualStepsRequired'],
    },
  },
];

export class PlannerAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async run(
    audit: AuditReport,
    compatibility: CompatibilityReport,
    docStore: DocStore
  ): Promise<MigrationPlan> {
    const auditSummary = Object.entries(audit.packages)
      .filter(([, v]) => v.gap > 0)
      .map(([name, v]) => `  ${name}: ${v.current} → ${v.latest}`)
      .join('\n');

    const compatSummary = compatibility.upgradeOrder
      .map(
        (s) =>
          `  Step ${s.order}: ${s.package} ${s.fromVersion}→${s.toVersion}${s.intermediateVersions.length ? ` (via ${s.intermediateVersions.join(', ')})` : ''}`
      )
      .join('\n');

    const conflictSummary =
      compatibility.conflicts.length > 0
        ? '\nConflicts:\n' +
          compatibility.conflicts.map((c) => `  ${c.package}: ${c.reason} → ${c.resolution}`).join('\n')
        : '';

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: `Create a migration plan for this Angular project.

Audit findings:
${auditSummary}

Compatibility-resolved upgrade order:
${compatSummary}
${conflictSummary}

Compatibility summary: ${compatibility.summary}

Use semantic_search to look up specific breaking changes for each package upgrade, then output the complete migration plan.`,
      },
    ];

    let plan: MigrationPlan | null = null;

    let response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.MessageParam['content'] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: unknown;

        if (block.name === 'semantic_search') {
          const input = block.input as { query: string; top_k?: number };
          const chunks = semanticSearch(input.query, docStore, input.top_k ?? 5);
          result =
            chunks.length > 0
              ? chunks.map((c) => `[${c.source}] ${c.title}\n${c.content}`).join('\n\n---\n\n')
              : 'No relevant documentation found for this query.';
        } else if (block.name === 'output_migration_plan') {
          const input = block.input as Omit<MigrationPlan, 'totalSteps'>;
          plan = { ...input, totalSteps: input.steps.length };
          result = 'Migration plan recorded.';
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
        max_tokens: 8192,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
    }

    if (!plan) {
      throw new Error('Planner agent did not produce a plan.');
    }

    return plan;
  }
}
