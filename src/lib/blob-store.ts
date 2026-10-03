import "server-only";

/** The store used by client-token issuance, authorized reads and cleanup. */
export function getBlobStoreConfig(): {
  token: string;
  origin: string;
  access: "public" | "private";
} {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  // @vercel/blob's read/write tokens encode the store in the fourth `_`
  // segment. Validate a single DNS label before constructing its URL.
  const match =
    /^vercel_blob_rw_([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)_(\S+)$/.exec(
      token,
    );
  if (!match) throw new Error("Missing or invalid BLOB_READ_WRITE_TOKEN.");
  // Preserve existing public-store deployments; private stores must opt in.
  // Access is a store property, not a per-file privacy override.
  const access = process.env.BLOB_ACCESS?.trim() ?? "public";
  if (access !== "public" && access !== "private") {
    throw new Error("BLOB_ACCESS must be public or private.");
  }
  return {
    token,
    access,
    origin: `https://${match[1].toLowerCase()}.${access}.blob.vercel-storage.com`,
  };
}
