import "server-only";

/** The public store used by both client-token issuance and Blob cleanup. */
export function getBlobStoreConfig(): { token: string; origin: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  // @vercel/blob's read/write tokens encode the store in the fourth `_`
  // segment. Validate a single DNS label before constructing its public URL.
  const match =
    /^vercel_blob_rw_([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)_(\S+)$/.exec(
      token,
    );
  if (!match) throw new Error("Missing or invalid BLOB_READ_WRITE_TOKEN.");
  return {
    token,
    origin: `https://${match[1].toLowerCase()}.public.blob.vercel-storage.com`,
  };
}
