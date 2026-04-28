const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 10_000;

export interface NpmPackageData {
  name: string;
  latestVersion: string;
  allVersions: string[];
  peerDependencies: Record<string, string>;
  deprecated?: string;
}

export async function fetchNpmRegistry(packageName: string): Promise<NpmPackageData> {
  const encoded = packageName.replace('/', '%2F');
  const url = `${REGISTRY}/${encoded}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${packageName}`);

    const data = (await res.json()) as Record<string, unknown>;
    const distTags = data['dist-tags'] as Record<string, string>;
    const latestVersion = distTags?.latest ?? '0.0.0';
    const versions = Object.keys((data['versions'] as Record<string, unknown>) ?? {});

    const latestManifest = (
      (data['versions'] as Record<string, unknown>)[latestVersion] as Record<string, unknown>
    ) ?? {};

    const deprecated =
      typeof latestManifest['deprecated'] === 'string'
        ? latestManifest['deprecated']
        : undefined;

    const peerDependencies =
      (latestManifest['peerDependencies'] as Record<string, string>) ?? {};

    return { name: packageName, latestVersion, allVersions: versions, peerDependencies, deprecated };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPeerDepsForVersion(
  packageName: string,
  version: string
): Promise<Record<string, string>> {
  const encoded = packageName.replace('/', '%2F');
  const url = `${REGISTRY}/${encoded}/${version}`;

  const res = await fetch(url);
  if (!res.ok) return {};

  const data = (await res.json()) as Record<string, unknown>;
  return (data['peerDependencies'] as Record<string, string>) ?? {};
}
