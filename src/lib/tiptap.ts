/**
 * Normalize a stored image reference to a loadable URL served through our
 * authenticated proxy (`/api/media/...`). New uploads are already stored in
 * this form; legacy values that point at the old public Storage URL are
 * rewritten on the fly so they keep working after the bucket goes private.
 */
export function mediaSrc(stored: string): string {
  if (!stored) return stored;
  if (stored.startsWith("/api/media/")) return stored;
  const pub = "/storage/v1/object/public/media/";
  const i = stored.indexOf(pub);
  if (i >= 0) return `/api/media/${stored.slice(i + pub.length)}`;
  return stored;
}

/** Deep-clone a Tiptap JSON doc, mapping every <img src> through `map`. */
export function remapImageSrcs(content: unknown, map: (src: string) => string): unknown {
  function walk(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const n = node as {
      type?: string;
      attrs?: { src?: unknown };
      content?: unknown[];
    };
    const out: Record<string, unknown> = { ...(node as Record<string, unknown>) };
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      out.attrs = { ...n.attrs, src: map(n.attrs.src) };
    }
    if (Array.isArray(n.content)) out.content = n.content.map(walk);
    return out;
  }
  return walk(content);
}

/** Walk a Tiptap JSON doc and pull out every <img src>. Pure, no client deps. */
export function extractImageUrls(content: unknown): string[] {
  const urls: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      attrs?: { src?: unknown };
      content?: unknown[];
    };
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      urls.push(n.attrs.src);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(content);
  return urls;
}
