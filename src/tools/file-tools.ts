import fs from 'fs';
import path from 'path';

export async function readFile(filePath: string): Promise<string> {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${(error as Error).message}`);
  }
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function listFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    const skip = ['node_modules', 'dist', '.angular', '.git', 'coverage'];
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (skip.includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}
