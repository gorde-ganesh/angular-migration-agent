import Anthropic from '@anthropic-ai/sdk';
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
    name: 'web_fetch',
    description: 'Fetch content from a URL (changelogs, migration guides).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'store_doc_chunks',
    description: 'Store relevant sections of documentation in the doc store for later RAG queries.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source URL or name (e.g. angular/CHANGELOG.md)' },
        title: { type: 'string', description: 'Section title, e.g. "Angular v17 Breaking Changes"' },
        content: { type: 'string', description: 'The extracted text content to store' },
      },
      required: ['source', 'title', 'content'],
    },
  },
  {
    name: 'complete_fetch',
    description: 'Signal that all documentation has been fetched and stored.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Brief summary of what was fetched' },
      },
      required: ['summary'],
    },
  },
];

export class DocsFetcherAgent {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
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
      {
        role: 'user',
        content: `Fetch migration documentation for these packages with version gaps:\n\n${packagesWithGap}\n\nFetch the relevant changelogs and store the breaking-changes sections.`,
      },
    ];

    let done = false;

    let response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    while (response.stop_reason === 'tool_use' && !done) {
      const toolResults: Anthropic.MessageParam['content'] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;

        if (block.name === 'web_fetch') {
          const input = block.input as { url: string };
          try {
            const content = await webFetch(input.url);
            result = content;
          } catch (e) {
            result = `Error fetching ${input.url}: ${(e as Error).message}`;
          }

          // Cache large fetched content to reduce token usage on retransmission
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: [
              {
                type: 'text',
                text: result,
                cache_control: { type: 'ephemeral' },
              },
            ],
          });
          continue;
        } else if (block.name === 'store_doc_chunks') {
          const input = block.input as { source: string; title: string; content: string };
          const chunks = chunkText(input.content, input.source, input.title);
          for (const chunk of chunks) {
            addChunk(store, chunk);
          }
          result = `Stored ${chunks.length} chunks from "${input.title}"`;
        } else if (block.name === 'complete_fetch') {
          done = true;
          result = 'Fetch complete.';
        } else {
          result = `Unknown tool: ${block.name}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      if (!done) {
        response = await this.client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
        });
      }
    }

    return store;
  }
}
