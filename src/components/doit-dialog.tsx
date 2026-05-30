"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Doit } from "@/lib/supabase/types";
import { ImageUploader } from "./image-uploader";
import {
  normalizeTag,
  SUGGESTED_TAGS,
  TagsField,
  type TagsFieldHandle,
} from "./tags-field";

type Mode =
  | { kind: "create"; date: string }
  | { kind: "edit"; doit: Doit };

type Props = {
  mode: Mode;
  /** Account-synced reusable tag library (DB). */
  customTags: string[];
  onCustomTagsChange: (next: string[]) => void;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    doit_date: string;
    emoji: string | null;
    memo: string | null;
    image_urls: string[];
    tags: string[];
  }) => Promise<void>;
  onUpdate: (input: {
    id: string;
    title: string;
    doit_date: string;
    emoji: string | null;
    memo: string | null;
    image_urls: string[];
    tags: string[];
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const SUGGESTED_EMOJI = [
  "📌", "✨", "🎉", "💡", "🍕", "☕", "🎬", "🎁",
  "🛍️", "🚗", "✈️", "🏥", "👥", "🎂", "🌧️", "❤️",
];

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function DoitDialog({
  mode,
  customTags,
  onCustomTagsChange,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const initialTitle = mode.kind === "edit" ? mode.doit.title : "";
  const initialDate = mode.kind === "edit" ? mode.doit.doit_date : mode.date;
  const initialEmoji = mode.kind === "edit" ? (mode.doit.emoji ?? "") : "";
  const initialMemo = mode.kind === "edit" ? (mode.doit.memo ?? "") : "";
  const initialImages =
    mode.kind === "edit" ? (mode.doit.image_urls ?? []) : [];
  const initialTags = mode.kind === "edit" ? (mode.doit.tags ?? []) : [];

  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(initialDate);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [memo, setMemo] = useState(initialMemo);
  const [images, setImages] = useState<string[]>(initialImages);
  const [tags, setTags] = useState<string[]>(initialTags);
  const tagsRef = useRef<TagsFieldHandle>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const emojiPopRef = useRef<HTMLDivElement | null>(null);

  // When editing an existing doit, fold any of its tags that aren't already in
  // the suggested/custom library back in so they appear as reusable chips.
  useEffect(() => {
    if (mode.kind !== "edit") return;
    const lc = (s: string) => s.toLowerCase();
    const presetTagSet = new Set(SUGGESTED_TAGS.map(lc));
    const known = new Set(customTags.map(lc));
    const missing: string[] = [];
    for (const t of mode.doit.tags ?? []) {
      const n = normalizeTag(t);
      if (n && !presetTagSet.has(lc(n)) && !known.has(lc(n))) {
        known.add(lc(n));
        missing.push(n);
      }
    }
    if (missing.length) {
      onCustomTagsChange([...customTags, ...missing].slice(-40));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    title !== initialTitle ||
    date !== initialDate ||
    emoji !== initialEmoji ||
    memo !== initialMemo ||
    !sameStringList(images, initialImages) ||
    !sameStringList(tags, initialTags);

  const canSave = !busy && title.trim().length > 0 && (mode.kind === "create" || dirty);

  function requestClose() {
    if (
      dirty &&
      !confirm("You have unsaved changes. They won't be saved if you close. Close anyway?")
    ) {
      return;
    }
    onClose();
  }

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
      if (e.key === "Escape") {
        if (showEmojiPicker) setShowEmojiPicker(false);
        else requestClose();
      }
    }
    function onClick(e: MouseEvent) {
      if (!showEmojiPicker) return;
      if (emojiPopRef.current && !emojiPopRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmojiPicker, dirty]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const finalTags = tagsRef.current?.flush() ?? tags;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        doit_date: date,
        emoji: emoji.trim() || null,
        memo: memo.trim() || null,
        image_urls: images,
        tags: finalTags,
      };
      if (mode.kind === "create") {
        await onCreate(payload);
      } else {
        await onUpdate({ id: mode.doit.id, ...payload });
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
      onClick={requestClose}
    >
      <div
        className="w-full max-w-md card-brut p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-5">
          {mode.kind === "create" ? "New doit" : "Doit"}
        </h2>
        <form onSubmit={submit} className="space-y-4">
          {/* Emoji + title */}
          <div>
            <label className="block text-sm font-bold mb-1.5">Emoji + title</label>
            <div className="flex gap-2 items-stretch relative">
              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                className="w-14 h-[46px] rounded-lg border-2 border-ink bg-white flex items-center justify-center text-2xl hover:bg-lime transition shrink-0"
                aria-label="Pick emoji"
              >
                {emoji || <span className="text-ink/40 text-base">＋</span>}
              </button>
              <input
                autoFocus
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lunch with a friend"
                className="input-brut flex-1"
                maxLength={200}
              />
              {showEmojiPicker && (
                <div
                  ref={emojiPopRef}
                  className="absolute left-0 top-[52px] z-10 w-full max-w-sm card-brut p-3 shadow-brut-lg"
                >
                  <div className="grid grid-cols-8 gap-1 mb-3">
                    {SUGGESTED_EMOJI.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setEmoji(e);
                          setShowEmojiPicker(false);
                        }}
                        className="h-9 text-xl rounded-md hover:bg-lime transition"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={emoji}
                      onChange={(e) => setEmoji(e.target.value)}
                      placeholder="Type or paste an emoji"
                      className="input-brut flex-1 text-sm"
                      maxLength={8}
                    />
                    {emoji && (
                      <button
                        type="button"
                        onClick={() => setEmoji("")}
                        className="btn-brut btn-ghost text-xs"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-bold mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-brut"
            />
          </div>

          {/* Memo */}
          <div>
            <label className="block text-sm font-bold mb-1.5">
              Memo <span className="font-normal text-ink/50">(optional)</span>
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="A quick line about it"
              rows={2}
              maxLength={500}
              className="input-brut resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-bold mb-1.5">
              Tags <span className="font-normal text-ink/50">(optional)</span>
            </label>
            <TagsField
              ref={tagsRef}
              tags={tags}
              onTagsChange={setTags}
              customTags={customTags}
              onCustomTagsChange={onCustomTagsChange}
            />
          </div>

          {/* Photos */}
          <div>
            <label className="block text-sm font-bold mb-1.5">
              Photos <span className="font-normal text-ink/50">(optional)</span>
            </label>
            <ImageUploader
              kind="doits"
              urls={images}
              onChange={setImages}
              max={8}
            />
          </div>

          {error && (
            <p className="text-sm font-bold text-coral border-2 border-coral bg-coral/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {mode.kind === "edit" && dirty && (
            <p className="text-xs font-bold text-ink/60">
              Unsaved changes — they won&apos;t be saved if you close.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
            <div>
              {mode.kind === "edit" && (
                <button
                  type="button"
                  onClick={() => onDelete(mode.doit.id)}
                  className="btn-brut btn-coral"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={requestClose} className="btn-brut btn-ghost">
                Cancel
              </button>
              <button type="submit" disabled={!canSave} className="btn-brut btn-primary">
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
