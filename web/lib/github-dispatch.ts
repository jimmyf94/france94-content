export type GithubDispatchResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function resolveGhRepository(): string | null {
  const explicit = process.env.GH_REPOSITORY?.trim();
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (owner && slug) return `${owner}/${slug}`;
  return null;
}

export function isGithubDispatchConfigured(): boolean {
  return Boolean(process.env.GH_DISPATCH_TOKEN?.trim() && resolveGhRepository());
}

export async function dispatchGithubWorkflow(
  workflowFile: string,
  inputs?: Record<string, string>,
): Promise<GithubDispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: 'GH_DISPATCH_TOKEN is not configured (fine-scoped PAT with actions:write)',
    };
  }

  const repo = resolveGhRepository();
  if (!repo) {
    return {
      ok: false,
      status: 503,
      error: 'GH_REPOSITORY is not configured (owner/repo)',
    };
  }

  const ref = process.env.GH_DISPATCH_REF?.trim() || 'main';
  const dispatchRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref,
        ...(inputs ? { inputs } : {}),
      }),
    },
  );

  if (!dispatchRes.ok) {
    const body = await dispatchRes.text().catch(() => '');
    console.error(`[github-dispatch] ${workflowFile} failed`, dispatchRes.status, body);
    return {
      ok: false,
      status: 502,
      error: `GitHub dispatch failed (${dispatchRes.status})`,
    };
  }

  return { ok: true };
}
