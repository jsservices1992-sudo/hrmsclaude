export type StorageProvider = "s3" | "vercel-blob" | "local-disk";

export function resolveStorageProvider(input: {
  requested?: string;
  production: boolean;
  s3Configured: boolean;
  blobConfigured: boolean;
}): { provider: StorageProvider | null; error: string | null } {
  const requested = input.requested?.trim();
  if (requested && !["s3", "vercel-blob", "local-disk"].includes(requested)) {
    return { provider: null, error: "STORAGE_PROVIDER must be s3, vercel-blob or local-disk." };
  }
  if (requested === "vercel-blob") {
    return input.blobConfigured
      ? { provider: "vercel-blob", error: null }
      : { provider: null, error: "Vercel Blob is selected but BLOB_READ_WRITE_TOKEN is missing. Connect a private Blob store to this deployment and redeploy." };
  }
  if (requested === "s3") {
    return input.s3Configured
      ? { provider: "s3", error: null }
      : { provider: null, error: "S3 is selected but its bucket and credentials are incomplete." };
  }
  if (requested !== "local-disk") {
    if (input.s3Configured) return { provider: "s3", error: null };
    if (input.blobConfigured) return { provider: "vercel-blob", error: null };
  }
  if (input.production) {
    return { provider: null, error: "No durable document store is selected and configured. Production cannot use local disk because documents would be lost on redeploy." };
  }
  return { provider: "local-disk", error: null };
}
