async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const NOREPLY_RE = /^(?:(\d+)\+)?([^@\s]+)@users\.noreply\.github\.com$/i;

export async function authorAvatarUrl(email: string | undefined | null): Promise<string | null> {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const match = normalized.match(NOREPLY_RE);
  if (match) {
    const username = match[2];
    return `https://github.com/${username}.png?size=64`;
  }

  const hash = await sha256Hex(normalized);
  return `https://gravatar.com/avatar/${hash}?s=64&d=identicon`;
}
