import OpenAI from 'openai';
import type { AuditReport, DocStore, MessageParam, Tool } from '../types';
import { webFetch } from '../tools/web-fetch';
import { createDocStore, addChunk, chunkText } from '../tools/doc-store';

const SYSTEM_PROMPT = `You are the Docs Fetcher Agent for an Angular migration orchestrator.

Your job is to gather authoritative migration documentation so other agents don't hallucinate.

For each package with a version gap > 0, fetch its migration guide or changelog using web_fetch.

Key sources:
- Angular core (v14-v19): https://raw.githubusercontent.com/angular/angular/main/CHANGELOG.md
- Angular Material/CDK: https://raw.githubusercontent.com/angular/components/main/CHANGELOG.md
- NgRx: https://raw.githubusercontent.com/ngrx/platform/main/CHANGELOG.md
- RxJS: https://raw.githubusercontent.com/ReactiveX/rxjs/master/CHANGELOG.md

After fetching each source, call store_doc_chunks with the relevant breaking-changes sections.
When done with all sources, call complete_fetch.

Focus on extracting: breaking changes, deprecated APIs, migration steps, and new patterns.`;

const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch content from a URL (changelogs, migration guides).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_doc_chunks',
      description: 'Store relevant sections of documentation in the doc store for later RAG queries.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source URL or name (e.g. angular/CHANGELOG.md)' },
          title: { type: 'string', description: 'Section title, e.g. "Angular v17 Breaking Changes"' },
          content: { type: 'string', description: 'The extracted text content to store' },
        },
        required: ['source', 'title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_fetch',
      description: 'Signal that all documentation has been fetched and stored.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of what was fetched' },
        },
        required: ['summary'],
      },
    },
  },
];

export class DocsFetcherAgent {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env['OPENROUTER_API_KEY'],
    });
  }

  async run(audit: AuditReport): Promise<DocStore> {
    const store = createDocStore();

    const packagesWithGap = Object.entries(audit.packages)
      .filter(([, v]) => v.gap > 0)
      .map(([name, v]) => `${name}: ${v.current} → ${v.latest}`)
      .join('\n');

    if (!packagesWithGap) {
      return store;
    }

    const messages: MessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Fetch migration documentation for these packages with version gaps:\n\n${packagesWithGap}\n\nFetch the relevant changelogs and store the breaking-changes sections.`,
      },
    ];

    let done = false;

    let response = await this.client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: 8192,
      messages,
      tools: TOOLS,
    });

    while (response.choices[0].finish_reason === 'tool_calls' && !done) {
      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls ?? [];
      const toolResultMap: Record<string, string> = {};

      for (const call of toolCalls) {
        if (call.type !== 'function') continue;

        const toolName = call.function.name;
        const toolInput = JSON.parse(call.function.arguments);
        let result: string;

        if (toolName === 'web_fetch') {
          const input = toolInput as { url: string };
          try {
            result = await webFetch(input.url);
          } catch (e) {
            result = `Error fetching ${input.url}: ${(e as Error).message}`;
          }
        } else if (toolName === 'store_doc_chunks') {
          const input = toolInput as { source: string; title: string; content: string };
          const chunks = chunkText(input.content, input.source, input.title);
          for (const chunk of chunks) {
            addChunk(store, chunk);
          }
          result = `Stored ${chunks.length} chunks from "${input.title}"`;
        } else if (toolName === 'complete_fetch') {
          done = true;
          result = 'Fetch complete.';
        } else {
          result = `Unknown tool: ${toolName}`;
        }

        toolResultMap[call.id] = result;
      }

      messages.push({
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });
      for (const call of toolCalls) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultMap[call.id] ?? '' });
      }

      if (!done) {
        response = await this.client.chat.completions.create({
          model: 'anthropic/claude-sonnet-4-6',
          max_tokens: 8192,
          messages,
          tools: TOOLS,
        });
      }
    }

    return store;
  }
}
