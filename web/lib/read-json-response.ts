/** Parse fetch Response JSON; surface empty bodies and HTML error pages clearly. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response from server (${res.status} ${res.statusText}). Check API logs and env vars (e.g. SUPABASE_URL in repo-root .env).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.trim().slice(0, 280);
    throw new Error(
      `Expected JSON but got ${res.status} ${res.statusText}: ${snippet}${text.length > 280 ? '…' : ''}`,
    );
  }
}
