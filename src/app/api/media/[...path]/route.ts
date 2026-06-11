import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/log";
import { requestIdFrom } from "@/lib/request-id";

/**
 * Authenticated media proxy. Streams an object from the private `media`
 * bucket using the caller's session, so Storage RLS ("media: read own")
 * is the access gate — an anonymous or non-owner request fails the
 * download and gets a 404. Stable URLs (no signed-URL expiry) so they work
 * inside Tiptap content too.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const log = createLogger({ request_id: requestIdFrom(req), route: "/api/media" });
  const { path } = await params;
  const objectPath = path.map(decodeURIComponent).join("/");

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("media").download(objectPath);
  if (error || !data) {
    log.warn("media download failed", { object_path: objectPath, status: 404 });
    return new NextResponse("Not found", { status: 404 });
  }

  log.info("media served", {
    object_path: objectPath,
    content_type: data.type,
    bytes: data.size,
    status: 200,
  });

  const buf = await data.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      // Private: the owner's browser may cache, shared/CDN caches must not.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
