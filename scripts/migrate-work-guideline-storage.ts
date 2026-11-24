/**
 * Optional one-time copy of legacy Work Guideline private storage objects into
 * the Muxamil Supabase project's wg-private bucket. Run locally only; never
 * commit the source or destination service-role keys.
 */
import { createClient } from "@supabase/supabase-js";

const oldUrl = process.env.LEGACY_SUPABASE_URL;
const oldKey = process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY;
const newUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const newKey = process.env.SUPABASE_SECRET_KEY;
const oldBucket = process.env.LEGACY_WG_STORAGE_BUCKET || "muxamil-private";
const newBucket = process.env.SUPABASE_STORAGE_BUCKET || "wg-private";

if (!oldUrl || !oldKey || !newUrl || !newKey) {
  throw new Error("Set LEGACY_SUPABASE_URL, LEGACY_SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY first.");
}

const source = createClient(oldUrl, oldKey, { auth: { persistSession: false, autoRefreshToken: false } });
const target = createClient(newUrl, newKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureTargetBucket() {
  const { data, error } = await target.storage.getBucket(newBucket);
  if (!error && data) return;
  const { error: createError } = await target.storage.createBucket(newBucket, { public: false, fileSizeLimit: 52_428_800 });
  if (createError && !/already exists/i.test(createError.message)) throw createError;
}

async function copyFolder(prefix = ""): Promise<number> {
  let offset = 0;
  let copied = 0;
  while (true) {
    const { data, error } = await source.storage.from(oldBucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Could not list legacy storage at "${prefix}": ${error.message}`);
    if (!data?.length) break;

    for (const item of data) {
      const key = prefix ? `${prefix}/${item.name}` : item.name;
      const isFolder = !item.id && !item.metadata;
      if (isFolder) {
        copied += await copyFolder(key);
        continue;
      }
      const { data: blob, error: downloadError } = await source.storage.from(oldBucket).download(key);
      if (downloadError || !blob) throw new Error(`Could not download ${key}: ${downloadError?.message ?? "empty response"}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const contentType = blob.type || (item.metadata as { mimetype?: string } | null)?.mimetype || "application/octet-stream";
      const { error: uploadError } = await target.storage.from(newBucket).upload(key, bytes, {
        contentType,
        upsert: true,
      });
      if (uploadError) throw new Error(`Could not copy ${key}: ${uploadError.message}`);
      copied += 1;
      console.log(`Copied ${key}`);
    }
    offset += data.length;
    if (data.length < 100) break;
  }
  return copied;
}

async function main() {
  if (oldUrl === newUrl && oldBucket === newBucket) {
    console.log("Source and destination are the same bucket; nothing to copy.");
    return;
  }
  await ensureTargetBucket();
  const count = await copyFolder();
  console.log(`Storage migration complete: ${count} file(s) copied to ${newBucket}.`);
}

main().catch((error) => {
  console.error("Storage migration failed:", error);
  process.exitCode = 1;
});
