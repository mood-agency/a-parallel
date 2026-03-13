/**
 * @deprecated Auth mode distinction removed — always multi-user with Better Auth.
 * This file is kept as a stub for any transient imports during migration.
 */

/** @deprecated Always returns 'multi'. */
export function getAuthMode(): string {
  return 'multi';
}

/** @deprecated No-op. */
export function resolveAuthMode(_value: string | undefined): string {
  return 'multi';
}

/** @deprecated No-op — SQLite is now allowed for all modes. */
export function validateAuthDbCompat(): void {
  // no-op
}
