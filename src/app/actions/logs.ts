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

function todayISO() {
  // Local date in YYYY-MM-DD. Matches what the calendar shows the user.
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Toggle a log for the given template on today's date. Returns { added: boolean }. */
export async function toggleLogToday(template_id: string) {
  const { supabase, user } = await requireUser();
  const log_date = todayISO();

  const { data: existing } = await supabase
    .from("activity_logs")
    .select("id")
    .eq("template_id", template_id)
    .eq("log_date", log_date)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("activity_logs").delete().eq("id", existing.id);
    if (error) throw new Error(error.message);
    revalidatePath("/");
    return { added: false, log_date };
  }

  const { error } = await supabase.from("activity_logs").insert({
    user_id: user.id,
    template_id,
    log_date,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { added: true, log_date };
}

/** Delete a specific log (used from detail page). */
export async function deleteLog(template_id: string, log_date: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("activity_logs")
    .delete()
    .eq("template_id", template_id)
    .eq("log_date", log_date);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath(`/p/${template_id}/${log_date}`);
}
