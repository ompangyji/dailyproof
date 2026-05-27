"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Doit } from "@/lib/supabase/types";
import { ImageUploader } from "./image-uploader";

type Mode =
  | { kind: "create"; date: string }
  | { kind: "edit"; doit: Doit };

type Props = {
  mode: Mode;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    doit_date: string;
    emoji: string | null;
    memo: string | null;
    image_urls: string[];
  }) => Promise<void>;
  onUpdate: (input: {
    id: string;
    title: string;
    doit_date: string;
    emoji: string | null;
    memo: string | null;
    image_urls: string[];
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const SUGGESTED_EMOJI = [
  "📌", "✨", "🎉", "💡", "🍕", "☕", "🎬", "🎁",
  "🛍️", "🚗", "✈️", "🏥", "👥", "🎂", "🌧️", "❤️",
];

export function DoitDialog({ mode, onClose, onCreate, onUpdate, onDelete }: Props) {
  const initialTitle = mode.kind === "edit" ? mode.doit.title : "";
  const initialDate = mode.kind === "edit" ? mode.doit.doit_date : mode.date;
  const initialEmoji = mode.kind === "edit" ? (mode.doit.emoji ?? "") : "";
  const initialMemo = mode.kind === "edit" ? (mode.doit.memo ?? "") : "";
  const initialImages =
    mode.kind === "edit" ? (mode.doit.image_urls ?? []) : [];

  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(initialDate);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [memo, setMemo] = useState(initialMemo);
  const [images, setImages] = useState<string[]>(initialImages);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const emojiPopRef = useRef<HTMLDivElement | null>(null);

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
        else onClose();
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
  }, [onClose, showEmojiPicker]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        doit_date: date,
        emoji: emoji.trim() || null,
        memo: memo.trim() || null,
        image_urls: images,
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
      onClick={onClose}
    >
      <div
        className="w-full max-w-md card-brut p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl mb-5">
          {mode.kind === "create" ? "New doit" : "Edit doit"}
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
