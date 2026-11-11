/** An error that says what failed, then why, keeping the error that made it fail as its cause. */
export function failure(what: string, cause: unknown): Error {
  const why = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${what}: ${why}`, { cause });
}
