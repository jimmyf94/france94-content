import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a repo-relative path when `process.cwd()` is the repo root or `web/`
 * (Next.js dev from `web/`).
 */
export function resolveRepoRelative(primaryRel: string): string {
  const fromCwd = path.resolve(process.cwd(), primaryRel);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(process.cwd(), '..', primaryRel);
}
