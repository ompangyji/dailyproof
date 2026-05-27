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
