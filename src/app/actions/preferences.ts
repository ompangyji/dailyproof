"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const MAX_COLORS = 24;
const MAX_TAGS = 40;

function normColors(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const c = raw.trim().toLowerCase();
    const hex = c.startsWith("#") ? c : `#${c}`;
    if (!HEX_RE.test(hex) || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out.slice(0, MAX_COLORS);
}

function normTags(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.slice(0, MAX_TAGS);
}

export async function updateCustomColors(colors: string[]) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, custom_colors: normColors(colors) }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function updateCustomTags(tags: string[]) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, custom_tags: normTags(tags) }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
