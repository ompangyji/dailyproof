import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageEditor } from "@/components/page-editor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ templateId: string; date: string }> };

export default async function DetailPage({ params }: Props) {
  const { templateId, date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: template } = await supabase
    .from("activity_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) notFound();

  const { data: log } = await supabase
    .from("activity_logs")
    .select("id")
    .eq("template_id", templateId)
    .eq("log_date", date)
    .maybeSingle();

  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("template_id", templateId)
    .eq("log_date", date)
    .maybeSingle();

  return (
    <main className="min-h-screen">
      <header className="border-b-2 border-ink bg-paper">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 sm:px-6 py-3">
          <Link href="/" className="btn-brut btn-ghost text-sm">
            ← Calendar
          </Link>
          <span className="font-display text-base">{date}</span>
        </div>
      </header>
      <PageEditor
        templateId={template.id}
        logDate={date}
        title={template.title}
        color={template.color}
        emoji={template.emoji}
        tags={template.tags ?? []}
        hasLog={!!log}
        initialContent={page?.content ?? null}
      />
    </main>
  );
}
