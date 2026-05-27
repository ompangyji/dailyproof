import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  ActivityLog,
  ActivityTemplate,
  Doit,
} from "@/lib/supabase/types";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: templates }, { data: logs }, { data: doits }, { data: prefs }] =
    await Promise.all([
      supabase
        .from("activity_templates")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("activity_logs")
        .select("*")
        .order("log_date", { ascending: true }),
      supabase
        .from("doits")
        .select("*")
        .order("doit_date", { ascending: true }),
      supabase
        .from("user_preferences")
        .select("custom_colors, custom_tags")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  return (
    <main className="min-h-screen">
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl sm:text-3xl">DailyProof</span>
            <span className="font-tag text-electric text-lg -rotate-3 hidden sm:inline">
              gm!
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden sm:inline text-ink/60">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn-brut">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <Dashboard
        initialTemplates={(templates ?? []) as ActivityTemplate[]}
        initialLogs={(logs ?? []) as ActivityLog[]}
        initialDoits={(doits ?? []) as Doit[]}
        initialCustomColors={prefs?.custom_colors ?? []}
        initialCustomTags={prefs?.custom_tags ?? []}
      />
    </main>
  );
}
