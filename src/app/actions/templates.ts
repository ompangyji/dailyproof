"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extractImageUrls } from "@/lib/tiptap";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Normalize an array of raw tag strings: strip "#" and whitespace, dedupe, drop empties. */
function normalizeTags(raw: string[] | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const cleaned = r.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!cleaned) continue;
    const lc = cleaned.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(cleaned);
  }
  return out.slice(0, 20); // cap to keep things sane
}

function normalizeEmoji(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep just the first grapheme cluster (so "❤️🔥" becomes "❤️").
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
  return first?.segment ?? null;
}

export async function createTemplate(input: {
  title: string;
  color?: string | null;
  emoji?: string | null;
  tags?: string[];
}) {
  const { supabase, user } = await requireUser();
  const { data: maxRow } = await supabase
    .from("activity_templates")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("activity_templates")
    .insert({
      user_id: user.id,
      title: input.title.trim(),
      color: input.color ?? null,
      emoji: normalizeEmoji(input.emoji),
      tags: normalizeTags(input.tags),
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

export async function updateTemplate(input: {
  id: string;
  title?: string;
  color?: string | null;
  emoji?: string | null;
  tags?: string[];
}) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.color !== undefined) patch.color = input.color;
  if (input.emoji !== undefined) patch.emoji = normalizeEmoji(input.emoji);
  if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
  const { data, error } = await supabase
    .from("activity_templates")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

/**
 * Delete a template (which cascades pages + logs via FK).
 * Returns every storage image URL referenced by its pages so the caller can
 * fire-and-forget delete them from Storage.
 */
export async function deleteTemplate(id: string): Promise<{ image_urls: string[] }> {
  const { supabase } = await requireUser();

  const { data: pages } = await supabase
    .from("pages")
    .select("content")
    .eq("template_id", id);

  const urls = (pages ?? []).flatMap((p) => extractImageUrls(p.content));

  const { error } = await supabase.from("activity_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");

  return { image_urls: urls };
}
