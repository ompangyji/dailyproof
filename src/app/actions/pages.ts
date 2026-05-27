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

export async function savePage(input: {
  template_id: string;
  log_date: string;
  content: unknown;
  content_text: string;
}) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("pages")
    .upsert({
      template_id: input.template_id,
      log_date: input.log_date,
      user_id: user.id,
      content: input.content,
      content_text: input.content_text,
    });
  if (error) throw new Error(error.message);
  revalidatePath(`/p/${input.template_id}/${input.log_date}`);
}

export async function deletePage(template_id: string, log_date: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("pages")
    .delete()
    .eq("template_id", template_id)
    .eq("log_date", log_date);
  if (error) throw new Error(error.message);
  revalidatePath(`/p/${template_id}/${log_date}`);
}
