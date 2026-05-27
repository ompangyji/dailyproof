"use client";

import { createClient } from "./client";

export type UploadKind = "doits" | "pages";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB / image — tweak if needed.

/**
 * Upload one image to the `media` bucket under {userId}/{kind}/{uuid}.{ext}
 * and return its public URL.
 */
export async function uploadImage(file: File, kind: UploadKind): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`);
  }

  const supabase = createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error("Not signed in.");

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().slice(0, 5);
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "jpg";
  const path = `${user.id}/${kind}/${crypto.randomUUID()}.${safeExt}`;

  const { error: upErr } = await supabase.storage
    .from("media")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
  if (upErr) throw new Error(upErr.message);

  // Bucket is private; reference the file through the authenticated proxy.
  return `/api/media/${path}`;
}

/** Resolve the storage object path from either a proxy URL or a legacy public URL. */
function storagePathFromUrl(url: string): string | null {
  const proxy = "/api/media/";
  const pub = "/storage/v1/object/public/media/";
  let rest: string | null = null;
  if (url.startsWith(proxy)) rest = url.slice(proxy.length);
  else {
    const pi = url.indexOf(proxy);
    if (pi >= 0) rest = url.slice(pi + proxy.length);
    else {
      const ui = url.indexOf(pub);
      if (ui >= 0) rest = url.slice(ui + pub.length);
    }
  }
  if (!rest) return null;
  return rest.split("?")[0]; // strip any query string
}

/** Best-effort delete; ignores errors (e.g. if file is already gone). */
export async function deleteImageByUrl(url: string): Promise<void> {
  const path = storagePathFromUrl(url);
  if (!path) return;
  const supabase = createClient();
  await supabase.storage.from("media").remove([path]);
}

/** Fire-and-forget: delete every URL we own; swallows per-file failures. */
export async function deleteImagesByUrl(urls: Iterable<string>): Promise<void> {
  await Promise.all(
    Array.from(urls).map((u) => deleteImageByUrl(u).catch(() => {})),
  );
}

export { extractImageUrls, mediaSrc, remapImageSrcs } from "../tiptap";

/** Returns the elements of `before` that are not in `after`. */
export function diffRemoved(before: string[], after: string[]): string[] {
  const next = new Set(after);
  return before.filter((u) => !next.has(u));
}
