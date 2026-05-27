"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
} from "@/app/actions/templates";
import { toggleLogToday } from "@/app/actions/logs";
import { createDoit, deleteDoit, updateDoit } from "@/app/actions/doits";
import { deleteImagesByUrl, diffRemoved, mediaSrc } from "@/lib/supabase/upload";
import type {
  ActivityLog,
  ActivityTemplate,
  Doit,
} from "@/lib/supabase/types";
import { TemplateDialog } from "./template-dialog";
import { DoitDialog } from "./doit-dialog";

const DEFAULT_COLOR = "#ddfc69";

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 10);
}

type TemplateDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; template: ActivityTemplate };

type DoitDialogState =
  | { kind: "closed" }
  | { kind: "create"; date: string }
  | { kind: "edit"; doit: Doit };

export function Dashboard({
  initialTemplates,
  initialLogs,
  initialDoits,
}: {
  initialTemplates: ActivityTemplate[];
  initialLogs: ActivityLog[];
  initialDoits: Doit[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ActivityTemplate[]>(initialTemplates);
  const [logs, setLogs] = useState<ActivityLog[]>(initialLogs);
  const [doits, setDoits] = useState<Doit[]>(initialDoits);
  const [tplDialog, setTplDialog] = useState<TemplateDialogState>({ kind: "closed" });
  const [doitDialog, setDoitDialog] = useState<DoitDialogState>({ kind: "closed" });
  const [busyToggle, setBusyToggle] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const templateById = useMemo(() => {
    const m = new Map<string, ActivityTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const today = todayISO();
  const loggedTodayTemplateIds = useMemo(
    () => new Set(logs.filter((l) => l.log_date === today).map((l) => l.template_id)),
    [logs, today],
  );

  const todayDoits = useMemo(
    () => doits.filter((d) => d.doit_date === today),
    [doits, today],
  );

  const events = useMemo(() => {
    const routineEvents = logs
      .map((l) => {
        const t = templateById.get(l.template_id);
        if (!t) return null;
        const prefix = t.emoji ? `${t.emoji} ` : "";
        return {
          id: `routine__${l.template_id}__${l.log_date}`,
          title: `${prefix}${t.title}`,
          start: l.log_date,
          allDay: true,
          backgroundColor: t.color ?? DEFAULT_COLOR,
          borderColor: "#0a0a0a",
          textColor: "#0a0a0a",
          extendedProps: {
            kind: "routine" as const,
            templateId: l.template_id,
            date: l.log_date,
          },
        };
      })
      .filter(Boolean);

    const doitEvents = doits.map((d) => {
      const prefix = d.emoji ? `${d.emoji} ` : "";
      return {
        id: `doit__${d.id}`,
        title: `${prefix}${d.title}`,
        start: d.doit_date,
        allDay: true,
        // doit은 색이 없으니 흰 배경 + 검정 점선 보더로 구분
        backgroundColor: "#ffffff",
        borderColor: "#0a0a0a",
        textColor: "#0a0a0a",
        classNames: ["doit-event"],
        extendedProps: {
          kind: "doit" as const,
          doitId: d.id,
        },
      };
    });

    return [...routineEvents, ...doitEvents] as Array<{
      id: string;
      title: string;
      start: string;
      allDay: boolean;
      backgroundColor: string;
      borderColor: string;
      textColor: string;
      classNames?: string[];
      extendedProps:
        | { kind: "routine"; templateId: string; date: string }
        | { kind: "doit"; doitId: string };
    }>;
  }, [logs, templateById, doits]);

  async function onToggleRoutine(template_id: string) {
    setBusyToggle(template_id);
    const wasLogged = loggedTodayTemplateIds.has(template_id);
    if (wasLogged) {
      setLogs((prev) =>
        prev.filter((l) => !(l.template_id === template_id && l.log_date === today)),
      );
    } else {
      const optimistic: ActivityLog = {
        id: `tmp-${crypto.randomUUID()}`,
        user_id: "",
        template_id,
        log_date: today,
        created_at: new Date().toISOString(),
      };
      setLogs((prev) => [...prev, optimistic]);
    }
    startTransition(async () => {
      try {
        await toggleLogToday(template_id, today);
        // No router.refresh() here: the optimistic state above already reflects
        // the change, and toggleLogToday's revalidatePath keeps the cache fresh.
        // Refreshing would re-fetch the whole page (getUser + 3 queries) for
        // nothing — a wasted network round-trip on every toggle.
      } catch (e) {
        alert((e as Error).message);
        if (wasLogged) {
          setLogs((prev) => [
            ...prev,
            {
              id: `revert-${crypto.randomUUID()}`,
              user_id: "",
              template_id,
              log_date: today,
              created_at: new Date().toISOString(),
            },
          ]);
        } else {
          setLogs((prev) =>
            prev.filter((l) => !(l.template_id === template_id && l.log_date === today)),
          );
        }
      } finally {
        setBusyToggle(null);
      }
    });
  }

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-8">
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,dayGridWeek",
        }}
        height="auto"
        locale="en"
        buttonText={{ today: "Today", month: "Month", week: "Week" }}
        events={events}
        dayMaxEventRows
        eventClick={(arg) => {
          const props = arg.event.extendedProps as
            | { kind: "routine"; templateId: string; date: string }
            | { kind: "doit"; doitId: string };
          if (props.kind === "routine") {
            router.push(`/p/${props.templateId}/${props.date}`);
          } else {
            const d = doits.find((x) => x.id === props.doitId);
            if (d) setDoitDialog({ kind: "edit", doit: d });
          }
        }}
      />

      {/* Routines */}
      <div className="card-brut p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl">Routines</h2>
            <p className="text-sm text-ink/60 mt-1">
              Tap to toggle for today ({today})
            </p>
          </div>
          <button
            onClick={() => setTplDialog({ kind: "create" })}
            className="btn-brut btn-primary"
          >
            <span className="text-lg leading-none">＋</span> New routine
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="rounded-chunk border-2 border-dashed border-ink/40 py-10 text-center">
            <p className="font-display text-xl mb-1">Nothing here yet</p>
            <p className="text-sm text-ink/60">
              Click &quot;+ New routine&quot; to add your first one
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => {
              const active = loggedTodayTemplateIds.has(t.id);
              const color = t.color ?? DEFAULT_COLOR;
              return (
                <li
                  key={t.id}
                  className="flex items-stretch gap-0 rounded-chunk border-2 border-ink bg-white overflow-hidden shadow-brut"
                >
                  <button
                    onClick={() => onToggleRoutine(t.id)}
                    disabled={busyToggle === t.id}
                    className="flex-1 flex flex-col gap-1.5 px-4 py-3 text-left transition disabled:opacity-60"
                    style={active ? { backgroundColor: color } : {}}
                    aria-pressed={active}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-md border-2 border-ink shrink-0"
                        style={{ backgroundColor: active ? "#0a0a0a" : color }}
                      >
                        {active && (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 fill-lime">
                            <path d="M6.173 11.207 2.96 7.994l1.06-1.06 2.153 2.152 5.807-5.808 1.06 1.06z" />
                          </svg>
                        )}
                      </span>
                      {t.emoji && (
                        <span className="text-lg leading-none shrink-0" aria-hidden>
                          {t.emoji}
                        </span>
                      )}
                      <span className="font-bold truncate">{t.title}</span>
                    </div>
                    {(t.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 pl-9">
                        {(t.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] font-bold rounded-full border border-ink/40 px-1.5 py-0.5 bg-white/60"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => setTplDialog({ kind: "edit", template: t })}
                    className="px-3 border-l-2 border-ink hover:bg-paper"
                    title="Edit"
                    aria-label="Edit"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793zM12.379 4.793 3.5 13.672V16.5h2.828l8.879-8.879-2.828-2.828z" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Doits — one-off moments */}
      <div className="card-brut p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl">Doits</h2>
            <p className="text-sm text-ink/60 mt-1">
              One-off moments for today ({today})
            </p>
          </div>
          <button
            onClick={() => setDoitDialog({ kind: "create", date: today })}
            className="btn-brut btn-primary"
          >
            <span className="text-lg leading-none">＋</span> New doit
          </button>
        </div>

        {todayDoits.length === 0 ? (
          <div className="rounded-chunk border-2 border-dashed border-ink/40 py-10 text-center">
            <p className="font-display text-xl mb-1">Nothing for today yet</p>
            <p className="text-sm text-ink/60">
              Click &quot;+ New doit&quot; to jot down what you did
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {todayDoits.map((d) => (
              <li
                key={d.id}
                className="flex items-stretch gap-0 rounded-chunk border-2 border-ink bg-white overflow-hidden shadow-brut"
              >
                <button
                  onClick={() => setDoitDialog({ kind: "edit", doit: d })}
                  className="flex-1 flex flex-col gap-2 px-4 py-3 text-left transition hover:bg-paper"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {d.emoji && (
                      <span className="text-lg leading-none shrink-0" aria-hidden>
                        {d.emoji}
                      </span>
                    )}
                    <span className="font-bold truncate">{d.title}</span>
                  </div>
                  {d.memo && (
                    <p className="text-xs text-ink/60 line-clamp-2">{d.memo}</p>
                  )}
                  {(d.image_urls?.length ?? 0) > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto">
                      {d.image_urls.slice(0, 4).map((u, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${u}-${i}`}
                          src={mediaSrc(u)}
                          alt=""
                          className="h-14 w-14 object-cover rounded-md border-2 border-ink shrink-0"
                        />
                      ))}
                      {d.image_urls.length > 4 && (
                        <span className="h-14 w-14 rounded-md border-2 border-ink bg-paper flex items-center justify-center text-xs font-bold shrink-0">
                          +{d.image_urls.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tplDialog.kind !== "closed" && (
        <TemplateDialog
          mode={tplDialog}
          onClose={() => setTplDialog({ kind: "closed" })}
          onCreate={async (input) => {
            const created = await createTemplate(input);
            setTemplates((prev) => [...prev, created as ActivityTemplate]);
            setTplDialog({ kind: "closed" });
          }}
          onUpdate={async (input) => {
            const updated = await updateTemplate(input);
            setTemplates((prev) =>
              prev.map((t) => (t.id === input.id ? (updated as ActivityTemplate) : t)),
            );
            setTplDialog({ kind: "closed" });
          }}
          onDelete={async (id) => {
            if (!confirm("This routine and all its calendar logs + notes will be deleted. Continue?"))
              return;
            const { image_urls } = await deleteTemplate(id);
            setTemplates((prev) => prev.filter((t) => t.id !== id));
            setLogs((prev) => prev.filter((l) => l.template_id !== id));
            setTplDialog({ kind: "closed" });
            if (image_urls.length) void deleteImagesByUrl(image_urls);
          }}
        />
      )}

      {doitDialog.kind !== "closed" && (
        <DoitDialog
          mode={doitDialog}
          onClose={() => setDoitDialog({ kind: "closed" })}
          onCreate={async (input) => {
            const created = await createDoit(input);
            setDoits((prev) => [...prev, created as Doit]);
            setDoitDialog({ kind: "closed" });
          }}
          onUpdate={async (input) => {
            const prevDoit = doits.find((d) => d.id === input.id);
            const removed = diffRemoved(
              prevDoit?.image_urls ?? [],
              input.image_urls,
            );
            const updated = await updateDoit(input);
            setDoits((prev) =>
              prev.map((d) => (d.id === input.id ? (updated as Doit) : d)),
            );
            setDoitDialog({ kind: "closed" });
            if (removed.length) void deleteImagesByUrl(removed);
          }}
          onDelete={async (id) => {
            if (!confirm("Delete this doit?")) return;
            const prevDoit = doits.find((d) => d.id === id);
            await deleteDoit(id);
            setDoits((prev) => prev.filter((d) => d.id !== id));
            setDoitDialog({ kind: "closed" });
            if (prevDoit?.image_urls?.length) {
              void deleteImagesByUrl(prevDoit.image_urls);
            }
          }}
        />
      )}
    </section>
  );
}
