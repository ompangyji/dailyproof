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

function normTags(raw: string[] | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const cleaned = r.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, 40);
}

export async function createTracker(input: {
  name: string;
  tags?: string[];
  include_doits?: boolean;
}) {
  const { supabase, user } = await requireUser();
  const { data: maxRow } = await supabase
    .from("trackers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("trackers")
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      tags: normTags(input.tags),
      include_doits: !!input.include_doits,
      sort_order: nextOrder,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

export async function updateTracker(input: {
  id: string;
  name?: string;
  tags?: string[];
  include_doits?: boolean;
  enabled?: boolean;
}) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.tags !== undefined) patch.tags = normTags(input.tags);
  if (input.include_doits !== undefined) patch.include_doits = input.include_doits;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  const { data, error } = await supabase
    .from("trackers")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

export async function deleteTracker(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("trackers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}
