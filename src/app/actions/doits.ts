"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function normalizeEmoji(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
  return first?.segment ?? null;
}

function normalizeUrls(raw: string[] | undefined): string[] {
  if (!raw) return [];
  return raw
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && u.length < 2048)
    .slice(0, 30);
}

export async function createDoit(input: {
  title: string;
  doit_date: string;
  emoji?: string | null;
  memo?: string | null;
  image_urls?: string[];
}) {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("doits")
    .insert({
      user_id: user.id,
      title: input.title.trim(),
      doit_date: input.doit_date,
      emoji: normalizeEmoji(input.emoji),
      memo: input.memo?.trim() || null,
      image_urls: normalizeUrls(input.image_urls),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

export async function updateDoit(input: {
  id: string;
  title?: string;
  doit_date?: string;
  emoji?: string | null;
  memo?: string | null;
  image_urls?: string[];
}) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.doit_date !== undefined) patch.doit_date = input.doit_date;
  if (input.emoji !== undefined) patch.emoji = normalizeEmoji(input.emoji);
  if (input.memo !== undefined) patch.memo = input.memo?.trim() || null;
  if (input.image_urls !== undefined)
    patch.image_urls = normalizeUrls(input.image_urls);
  const { data, error } = await supabase
    .from("doits")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

export async function deleteDoit(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("doits").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}
