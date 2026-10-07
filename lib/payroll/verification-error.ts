/** Drizzle wraps driver errors in `cause`. Return only a safe code, never
 * SQL, connection details or submitted notification text. */
export function verificationErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string" && /^[A-Z0-9_]{3,40}$/.test(record.code)) return record.code;
    current = record.cause;
  }
  return "UNKNOWN";
}

export function verificationErrorMessage(code: string): string {
  if (code === "42703" || code === "42P01") {
    return "Verification could not be completed because this database needs an application migration. Contact your administrator.";
  }
  if (code === "23505" || code === "23P01") {
    return "A rate already exists for this period. Refresh the rates and verify the existing company row.";
  }
  return "Verification could not be completed. Refresh the rates to check their status, then retry. If it persists, share the reference below with support.";
}
