"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Tracker } from "@/lib/supabase/types";

type Mode = { kind: "create" } | { kind: "edit"; tracker: Tracker };

type Props = {
  mode: Mode;
  availableTags: string[];
  onClose: () => void;
  onCreate: (input: { name: string; tags: string[]; include_doits: boolean }) => Promise<void>;
  onUpdate: (input: {
    id: string;
    name: string;
    tags: string[];
    include_doits: boolean;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TrackerDialog({
  mode,
  availableTags,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [name, setName] = useState(mode.kind === "edit" ? mode.tracker.name : "");
  const [tags, setTags] = useState<string[]>(
    mode.kind === "edit" ? (mode.tracker.tags ?? []) : [],
  );
  const [includeDoits, setIncludeDoits] = useState(
    mode.kind === "edit" ? mode.tracker.include_doits : true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Tag chips: this tracker's own tags first, then the rest of the library.
  const lc = (s: string) => s.toLowerCase();
  const chips = Array.from(
    new Set([...tags, ...availableTags].map((t) => t.trim()).filter(Boolean)),
  );
  const selected = new Set(tags.map(lc));

  function toggleTag(t: string) {
    setTags((prev) =>
      prev.some((x) => lc(x) === lc(t)) ? prev.filter((x) => lc(x) !== lc(t)) : [...prev, t],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (tags.length === 0 && !includeDoits) {
      setError("Pick at least one tag, or include doits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        await onCreate({ name, tags, include_doits: includeDoits });
      } else {
        await onUpdate({ id: mode.tracker.id, name, tags, include_doits: includeDoits });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[1000] bg-ink/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-md card-brut p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl mb-1">
          {mode.kind === "create" ? "New graph" : "Edit graph"}
        </h2>
        <p className="text-sm text-ink/60 mb-5">
          An embeddable activity graph for the last 12 months.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold mb-1.5">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Workout streak"
              className="input-brut"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">
              Tags to include{" "}
              <span className="font-normal text-ink/50">
                (none = all routines)
              </span>
            </label>
            {chips.length === 0 ? (
              <p className="text-xs text-ink/50">
                No tags yet — add tags to your routines first, or just include doits below.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((t) => {
                  const on = selected.has(lc(t));
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`text-xs font-bold rounded-full border-2 border-ink px-2 py-0.5 transition ${
                        on ? "bg-lime" : "bg-white text-ink/60 hover:bg-paper"
                      }`}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDoits}
              onChange={(e) => setIncludeDoits(e.target.checked)}
              className="h-5 w-5 accent-electric border-2 border-ink"
            />
            <span className="text-sm font-bold">Include doits</span>
          </label>

          {error && (
            <p className="text-sm font-bold text-coral border-2 border-coral bg-coral/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
            <div>
              {mode.kind === "edit" && (
                <button
                  type="button"
                  onClick={() => onDelete(mode.tracker.id)}
                  className="btn-brut btn-coral"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="btn-brut btn-ghost">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn-brut btn-primary">
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
