import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated media proxy. Streams an object from the private `media`
 * bucket using the caller's session, so Storage RLS ("media: read own")
 * is the access gate — an anonymous or non-owner request fails the
 * download and gets a 404. Stable URLs (no signed-URL expiry) so they work
 * inside Tiptap content too.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const objectPath = path.map(decodeURIComponent).join("/");

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("media").download(objectPath);
  if (error || !data) {
    return new NextResponse("Not found", { status: 404 });
  }

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
