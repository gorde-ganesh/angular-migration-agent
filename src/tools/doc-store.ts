import type { DocChunk, DocStore } from '../types';

export function createDocStore(): DocStore {
  return { chunks: [] };
}

export function addChunk(store: DocStore, chunk: Omit<DocChunk, 'id'>): void {
  const id = `chunk-${store.chunks.length}`;
  store.chunks.push({ id, ...chunk });
}

/**
 * Simple keyword-based semantic search over stored doc chunks.
 * Scores each chunk by term frequency of query words.
 */
export function semanticSearch(query: string, store: DocStore, topK = 5): DocChunk[] {
  const terms = tokenize(query);
  if (terms.length === 0) return store.chunks.slice(0, topK);

  const scored = store.chunks.map((chunk) => {
    const body = `${chunk.title} ${chunk.content}`.toLowerCase();
    const score = terms.reduce((acc, term) => {
      const matches = body.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
      return acc + (matches?.length ?? 0);
    }, 0);
    return { chunk, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk }) => chunk);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

export function chunkText(
  text: string,
  source: string,
  title: string,
  chunkSize = 1500
): Omit<DocChunk, 'id'>[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Omit<DocChunk, 'id'>[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > chunkSize && current.length > 0) {
      chunks.push({ source, title, content: current.trim() });
      current = '';
    }
    current += '\n\n' + para;
  }

  if (current.trim()) {
    chunks.push({ source, title, content: current.trim() });
  }

  return chunks;
}
