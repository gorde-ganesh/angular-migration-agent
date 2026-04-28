import semver from 'semver';

export function coerce(version: string): string {
  return semver.coerce(version)?.version ?? version;
}

export function majorGap(current: string, latest: string): number {
  const c = semver.coerce(current);
  const l = semver.coerce(latest);
  if (!c || !l) return 0;
  return l.major - c.major;
}

export function getMajorVersion(version: string): number {
  return semver.coerce(version)?.major ?? 0;
}

/**
 * Returns intermediate major versions between `from` and `to` (inclusive of to).
 * Angular recommends upgrading one major at a time.
 */
export function getIncrementalMajors(from: string, to: string): string[] {
  const fromMajor = getMajorVersion(from);
  const toMajor = getMajorVersion(to);
  const steps: string[] = [];
  for (let v = fromMajor + 1; v <= toMajor; v++) {
    steps.push(`${v}.0.0`);
  }
  return steps;
}

export function satisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(coerce(version), range);
  } catch {
    return false;
  }
}

export function gt(a: string, b: string): boolean {
  return semver.gt(coerce(a), coerce(b));
}
