function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

let cachedAllowlist: Set<string> | null = null;

export function getAllowedEmails(): Set<string> {
  if (cachedAllowlist) return cachedAllowlist;
  const raw = requireEnv('ALLOWED_EMAILS');
  cachedAllowlist = new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  if (cachedAllowlist.size === 0) {
    throw new Error('ALLOWED_EMAILS must contain at least one email');
  }
  return cachedAllowlist;
}

export function isEmailAllowlisted(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  return getAllowedEmails().has(email.trim().toLowerCase());
}
