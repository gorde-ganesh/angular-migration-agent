const TIMEOUT_MS = 15_000;

export async function webFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'angular-migration-agent/1.0',
        Accept: 'text/plain, text/html, */*',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

    const text = await res.text();
    return truncate(text, 40_000);
  } finally {
    clearTimeout(timer);
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[...truncated...]';
}
