"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
} from "@/app/actions/templates";
import { updateCustomColors, updateCustomTags } from "@/app/actions/preferences";
import { toggleLogToday } from "@/app/actions/logs";
import { createDoit, deleteDoit, updateDoit } from "@/app/actions/doits";
import { createTracker, deleteTracker, updateTracker } from "@/app/actions/trackers";
import { deleteImagesByUrl, diffRemoved } from "@/lib/supabase/upload";
import { MediaImage } from "./media-image";
import type {
  ActivityLog,
  ActivityTemplate,
  Doit,
  Tracker,
} from "@/lib/supabase/types";
import { TemplateDialog } from "./template-dialog";
import { DoitDialog } from "./doit-dialog";
import { TrackerDialog } from "./tracker-dialog";

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

type TrackerDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; tracker: Tracker };

export function Dashboard({
  initialTemplates,
  initialLogs,
  initialDoits,
  initialCustomColors,
  initialCustomTags,
  initialTrackers,
}: {
  initialTemplates: ActivityTemplate[];
  initialLogs: ActivityLog[];
  initialDoits: Doit[];
  initialCustomColors: string[];
  initialCustomTags: string[];
  initialTrackers: Tracker[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ActivityTemplate[]>(initialTemplates);
  const [logs, setLogs] = useState<ActivityLog[]>(initialLogs);
  const [doits, setDoits] = useState<Doit[]>(initialDoits);
  // Custom color/tag library, synced to the account (DB) so it follows the
  // user across devices instead of living in localStorage.
  const [customColors, setCustomColors] = useState<string[]>(initialCustomColors);
  const [customTags, setCustomTags] = useState<string[]>(initialCustomTags);
  const [trackers, setTrackers] = useState<Tracker[]>(initialTrackers);

  // One-time migration: if the account library is empty but this browser has a
  // localStorage library from the old version, push it up to the account.
  useEffect(() => {
    try {
      const readArr = (k: string): string[] => {
        const raw = window.localStorage.getItem(k);
        if (!raw) return [];
        const a = JSON.parse(raw);
        return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
      };
      if (initialCustomColors.length === 0) {
        const ls = readArr("dailyproof:customColors");
        if (ls.length) {
          setCustomColors(ls);
          void updateCustomColors(ls);
        }
      }
      if (initialCustomTags.length === 0) {
        const ls = readArr("dailyproof:customTags");
        if (ls.length) {
          setCustomTags(ls);
          void updateCustomTags(ls);
        }
      }
    } catch {
      // ignore (privacy mode / malformed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistCustomColors(next: string[]) {
    setCustomColors(next);
    void updateCustomColors(next);
  }
  function persistCustomTags(next: string[]) {
    setCustomTags(next);
    void updateCustomTags(next);
  }
  const [tplDialog, setTplDialog] = useState<TemplateDialogState>({ kind: "closed" });
  const [doitDialog, setDoitDialog] = useState<DoitDialogState>({ kind: "closed" });
  const [trackerDialog, setTrackerDialog] = useState<TrackerDialogState>({ kind: "closed" });
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

  // Tags offered when configuring a shareable graph: the account library plus
  // any tags already used by routines or doits.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of customTags) {
      const v = t.trim();
      if (v) set.add(v);
    }
    for (const tpl of templates) {
      for (const tag of tpl.tags ?? []) {
        const v = tag.trim();
        if (v) set.add(v);
      }
    }
    for (const d of doits) {
      for (const tag of d.tags ?? []) {
        const v = tag.trim();
        if (v) set.add(v);
      }
    }
    return Array.from(set);
  }, [customTags, templates, doits]);

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
                  {(d.tags?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(d.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] font-bold rounded-full border border-ink/40 px-1.5 py-0.5 bg-white/60"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {d.memo && (
                    <p className="text-xs text-ink/60 line-clamp-2">{d.memo}</p>
                  )}
                  {(d.image_urls?.length ?? 0) > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto">
                      {d.image_urls.slice(0, 4).map((u, i) => (
                        <MediaImage
                          key={`${u}-${i}`}
                          src={u}
                          className="h-14 w-14 rounded-md border-2 border-ink shrink-0"
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

      {/* Shareable graphs — embeddable "grass" for other sites */}
      <div className="card-brut p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl">Shareable graphs</h2>
            <p className="text-sm text-ink/60 mt-1">
              Embed your activity grass anywhere via an image link
            </p>
          </div>
          <button
            onClick={() => setTrackerDialog({ kind: "create" })}
            className="btn-brut btn-primary"
          >
            <span className="text-lg leading-none">＋</span> New graph
          </button>
        </div>

        {trackers.length === 0 ? (
          <div className="rounded-chunk border-2 border-dashed border-ink/40 py-10 text-center">
            <p className="font-display text-xl mb-1">No graphs yet</p>
            <p className="text-sm text-ink/60">
              Click &quot;+ New graph&quot; to create an embeddable activity graph
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {trackers.map((t) => (
              <GraphCard
                key={t.id}
                tracker={t}
                onEdit={() => setTrackerDialog({ kind: "edit", tracker: t })}
                onToggleEnabled={async () => {
                  const updated = await updateTracker({ id: t.id, enabled: !t.enabled });
                  setTrackers((prev) =>
                    prev.map((x) => (x.id === t.id ? (updated as Tracker) : x)),
                  );
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {tplDialog.kind !== "closed" && (
        <TemplateDialog
          mode={tplDialog}
          customColors={customColors}
          customTags={customTags}
          onCustomColorsChange={persistCustomColors}
          onCustomTagsChange={persistCustomTags}
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
          customTags={customTags}
          onCustomTagsChange={persistCustomTags}
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

      {trackerDialog.kind !== "closed" && (
        <TrackerDialog
          mode={trackerDialog}
          availableTags={availableTags}
          onClose={() => setTrackerDialog({ kind: "closed" })}
          onCreate={async (input) => {
            const created = await createTracker(input);
            setTrackers((prev) => [...prev, created as Tracker]);
            setTrackerDialog({ kind: "closed" });
          }}
          onUpdate={async (input) => {
            const updated = await updateTracker(input);
            setTrackers((prev) =>
              prev.map((t) => (t.id === input.id ? (updated as Tracker) : t)),
            );
            setTrackerDialog({ kind: "closed" });
          }}
          onDelete={async (id) => {
            if (!confirm("Delete this graph? The embed link will stop working.")) return;
            await deleteTracker(id);
            setTrackers((prev) => prev.filter((t) => t.id !== id));
            setTrackerDialog({ kind: "closed" });
          }}
        />
      )}
    </section>
  );
}

function GraphCard({
  tracker,
  onEdit,
  onToggleEnabled,
}: {
  tracker: Tracker;
  onEdit: () => void;
  onToggleEnabled: () => Promise<void>;
}) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  async function handleToggle() {
    if (toggling) return;
    setToggling(true);
    try {
      await onToggleEnabled();
    } finally {
      setToggling(false);
    }
  }

  const url = `${origin}/api/grass/${tracker.token}`;
  const snippets = [
    { key: "md", label: "Markdown", hint: "README, Notion", value: `![${tracker.name}](${url})` },
    { key: "html", label: "HTML", hint: "websites", value: `<img src="${url}" alt="${tracker.name}" />` },
    { key: "url", label: "URL", hint: "raw image link", value: url },
  ];

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <li className="rounded-chunk border-2 border-ink bg-white overflow-hidden shadow-brut">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b-2 border-ink bg-paper flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold truncate">{tracker.name}</span>
          {!tracker.enabled && (
            <span className="text-[11px] font-bold rounded-full border-2 border-ink bg-white px-2 py-0.5">
              Disabled
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="btn-brut btn-ghost text-xs"
          >
            {toggling ? (
              <>
                <span
                  className="brut-spinner"
                  style={{ width: "0.85rem", height: "0.85rem", borderWidth: "2px" }}
                  aria-hidden
                />
                Saving…
              </>
            ) : tracker.enabled ? (
              "Disable"
            ) : (
              "Enable"
            )}
          </button>
          <button onClick={onEdit} className="btn-brut btn-ghost text-xs">
            Edit
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* How it's configured */}
        <div className="space-y-1.5 text-sm">
          <div className="flex gap-2 flex-wrap items-center">
            <span className="font-bold text-ink/50 w-14 shrink-0">Tags</span>
            {(tracker.tags?.length ?? 0) === 0 ? (
              <span className="text-ink/70">All routines</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {tracker.tags.map((t) => (
                  <span
                    key={t}
                    className="text-xs font-bold rounded-full border-2 border-ink bg-lime px-2 py-0.5"
                  >
                    #{t}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <span className="font-bold text-ink/50 w-14 shrink-0">Doits</span>
            <span className="text-ink/70">
              {tracker.include_doits ? "Included" : "Not included"}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="font-bold text-ink/50 w-14 shrink-0">Range</span>
            <span className="text-ink/70">Last 12 months</span>
          </div>
        </div>

        {/* How to use it elsewhere */}
        <div className="space-y-2 border-t-2 border-ink/10 pt-3">
          <p className="text-sm font-bold">Use it on another site</p>
          <p className="text-xs text-ink/60">
            Paste one of these wherever an image is allowed — it updates automatically.
          </p>
          {!tracker.enabled && (
            <p className="text-xs font-bold text-coral">
              This graph is disabled — the link won&apos;t render until you enable it.
            </p>
          )}
          {snippets.map((s) => (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">
                  {s.label} <span className="font-normal text-ink/40">· {s.hint}</span>
                </span>
                <button
                  type="button"
                  onClick={() => copy(s.value, s.key)}
                  className="btn-brut btn-ghost text-[11px] py-0.5"
                >
                  {copied === s.key ? "Copied!" : "Copy"}
                </button>
              </div>
              <code className="block text-[11px] text-ink/70 bg-paper border-2 border-ink/15 rounded-md px-2 py-1.5 break-all">
                {s.value}
              </code>
            </div>
          ))}

          <details className="text-xs text-ink/60">
            <summary className="cursor-pointer font-bold">Customize</summary>
            <div className="mt-1.5 space-y-1.5">
              <p>Append query params to the URL:</p>
              <code className="block text-[11px] text-ink/70 bg-paper border-2 border-ink/15 rounded-md px-2 py-1.5 break-all">
                ?theme=dark&amp;color=ddfc69&amp;bg=0d1117&amp;radius=3&amp;hideLegend=1
              </code>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><b>theme</b>: light | dark</li>
                <li><b>color</b>: hex without # (grass color)</li>
                <li><b>bg</b>: hex background</li>
                <li><b>radius</b>: 0–6 (cell roundness)</li>
                <li><b>hideTitle</b> / <b>hideLegend</b>: 1 to hide</li>
              </ul>
              <p>
                Raw data for custom rendering: add <b>?format=json</b>
              </p>
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
