"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActivityTemplate } from "@/lib/supabase/types";

type Mode =
  | { kind: "create" }
  | { kind: "edit"; template: ActivityTemplate };

type Props = {
  mode: Mode;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    color: string;
    emoji: string | null;
    tags: string[];
  }) => Promise<void>;
  onUpdate: (input: {
    id: string;
    title: string;
    color: string;
    emoji: string | null;
    tags: string[];
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const PALETTE = [
  "#ddfc69", // lime
  "#0b99ff", // electric blue
  "#ff6638", // coral
  "#ebd22f", // sun yellow
  "#a78bfa", // violet
  "#0a0a0a", // ink
  "#fbbf24", // amber
  "#34d399", // mint
  "#f472b6", // pink
  "#fb7185", // rose
  "#60a5fa", // sky
  "#fdba74", // peach
];

// 팝업에서 보여줄 확장 팔레트 (메인 12개 + 추가 톤들)
const EXTENDED_PALETTE = [
  "#fef3c7", "#fde68a", "#fcd34d", "#f59e0b", "#d97706", "#92400e",
  "#fee2e2", "#fecaca", "#f87171", "#ef4444", "#dc2626", "#7f1d1d",
  "#fce7f3", "#fbcfe8", "#f9a8d4", "#ec4899", "#db2777", "#831843",
  "#ede9fe", "#ddd6fe", "#c4b5fd", "#8b5cf6", "#7c3aed", "#4c1d95",
  "#dbeafe", "#bfdbfe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a",
  "#d1fae5", "#a7f3d0", "#6ee7b7", "#10b981", "#047857", "#064e3b",
  "#f5f5f5", "#d4d4d4", "#a3a3a3", "#525252", "#262626", "#0a0a0a",
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_RE.test(v)) return null;
  return (v.startsWith("#") ? v : `#${v}`).toLowerCase();
}

const CUSTOM_COLORS_KEY = "dailyproof:customColors";
const MAX_CUSTOM = 24;

function loadCustomColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_COLORS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c): c is string => typeof c === "string" && !!normalizeHex(c));
  } catch {
    return [];
  }
}

function saveCustomColors(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list));
  } catch {
    // quota or privacy mode — ignore
  }
}

const SUGGESTED_EMOJI = [
  "📚", "💪", "🏃", "🧘", "📝", "💻", "🎨", "🎵",
  "📷", "🎮", "🍎", "💧", "☕", "🛏️", "🌱", "🐕",
  "✨", "🔥", "⭐", "💎", "🎯", "🚀", "💡", "✅",
];

const SUGGESTED_TAGS = [
  "workout", "study", "reading", "work", "hobby", "health", "morning", "evening",
];

export function TemplateDialog({ mode, onClose, onCreate, onUpdate, onDelete }: Props) {
  const initialTitle = mode.kind === "edit" ? mode.template.title : "";
  const initialColor =
    mode.kind === "edit" ? (mode.template.color ?? PALETTE[0]) : PALETTE[0];
  const initialEmoji = mode.kind === "edit" ? (mode.template.emoji ?? "") : "";
  const initialTags = mode.kind === "edit" ? (mode.template.tags ?? []) : [];

  const [title, setTitle] = useState(initialTitle);
  const [color, setColor] = useState(initialColor);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const [hexError, setHexError] = useState<string | null>(null);
  const [customColors, setCustomColors] = useState<string[]>([]);

  // Hydrate persisted custom colors. Also include the template's current color
  // if it isn't already in PALETTE or customColors — so editing an old template
  // doesn't lose its color from the row.
  useEffect(() => {
    const stored = loadCustomColors();
    const lc = (s: string) => s.toLowerCase();
    const presetSet = new Set(PALETTE.map(lc));
    const known = new Set([...presetSet, ...stored.map(lc)]);
    const initial = [...stored];
    if (mode.kind === "edit") {
      const c = mode.template.color;
      if (c && !known.has(lc(c))) initial.unshift(c.toLowerCase());
    }
    setCustomColors(initial.slice(0, MAX_CUSTOM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addCustomColor(c: string) {
    const norm = normalizeHex(c);
    if (!norm) return;
    const lc = (s: string) => s.toLowerCase();
    if (PALETTE.some((p) => lc(p) === norm)) {
      setColor(norm);
      return;
    }
    setCustomColors((prev) => {
      if (prev.some((x) => lc(x) === norm)) {
        // bump to end so it's near the + button
        const without = prev.filter((x) => lc(x) !== norm);
        const next = [...without, norm].slice(-MAX_CUSTOM);
        saveCustomColors(next);
        return next;
      }
      const next = [...prev, norm].slice(-MAX_CUSTOM);
      saveCustomColors(next);
      return next;
    });
    setColor(norm);
  }

  function removeCustomColor(c: string) {
    const lc = c.toLowerCase();
    setCustomColors((prev) => {
      const next = prev.filter((x) => x.toLowerCase() !== lc);
      saveCustomColors(next);
      return next;
    });
    if (color.toLowerCase() === lc) {
      setColor(PALETTE[0]);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const emojiPopRef = useRef<HTMLDivElement | null>(null);
  const colorPopRef = useRef<HTMLDivElement | null>(null);

  // Portal needs DOM — wait one tick after mount before rendering.
  useEffect(() => setMounted(true), []);

  // Lock background scroll while the modal is open so the page doesn't shift.
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
        else if (showColorPicker) setShowColorPicker(false);
        else onClose();
      }
    }
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        showEmojiPicker &&
        emojiPopRef.current &&
        !emojiPopRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showColorPicker &&
        colorPopRef.current &&
        !colorPopRef.current.contains(target)
      ) {
        setShowColorPicker(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose, showEmojiPicker, showColorPicker]);

  function applyHex() {
    const normalized = normalizeHex(hexInput);
    if (!normalized) {
      setHexError("Invalid hex code. Example: #ddfc69");
      return;
    }
    addCustomColor(normalized);
    setHexInput("");
    setHexError(null);
    setShowColorPicker(false);
  }

  function addTag(raw: string) {
    const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!cleaned) return;
    if (tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) return;
    if (tags.length >= 20) return;
    setTags((prev) => [...prev, cleaned]);
  }

  function commitTagInput() {
    if (!tagInput.trim()) return;
    // Allow comma-separated paste like "운동,건강,#오늘"
    tagInput.split(/[,\s]+/).forEach((piece) => addTag(piece));
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Name is required.");
      return;
    }
    // Drain any unconfirmed text in the tag input before saving.
    const draftTags = [...tags];
    if (tagInput.trim()) {
      tagInput.split(/[,\s]+/).forEach((piece) => {
        const cleaned = piece.trim().replace(/^#+/, "").replace(/\s+/g, "");
        if (cleaned && !draftTags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
          draftTags.push(cleaned);
        }
      });
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        color,
        emoji: emoji.trim() || null,
        tags: draftTags,
      };
      if (mode.kind === "create") {
        await onCreate(payload);
      } else {
        await onUpdate({ id: mode.template.id, ...payload });
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
          {mode.kind === "create" ? "New routine" : "Edit routine"}
        </h2>
        <form onSubmit={submit} className="space-y-4">
          {/* Emoji + name */}
          <div>
            <label className="block text-sm font-bold mb-1.5">Emoji + name</label>
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
                placeholder="e.g. Workout, Read, Journal"
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
                  <p className="text-[11px] text-ink/50 mt-2">
                    Tip: Windows <kbd className="font-mono">Win+.</kbd> / macOS{" "}
                    <kbd className="font-mono">Ctrl+Cmd+Space</kbd>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-bold mb-1.5">Tags</label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-lime px-2 py-0.5 text-xs font-bold"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="hover:bg-ink hover:text-lime rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] leading-none"
                      aria-label={`Remove tag ${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitTagInput();
                } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                  setTags((prev) => prev.slice(0, -1));
                }
              }}
              onBlur={commitTagInput}
              placeholder="#workout, #health — press Enter or comma"
              className="input-brut"
              maxLength={50}
            />
            {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addTag(s)}
                    className="text-xs font-bold rounded-full border-2 border-ink/30 px-2 py-0.5 hover:border-ink hover:bg-lime transition text-ink/60 hover:text-ink"
                  >
                    +#{s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-bold mb-1.5">Color</label>
            <div className="relative">
              <div className="flex gap-2 flex-wrap items-center">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-9 w-9 rounded-full border-2 border-ink transition ${
                      color.toLowerCase() === c.toLowerCase()
                        ? "shadow-brut-sm scale-110"
                        : ""
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
                {customColors.map((c) => (
                  <span key={c} className="relative group inline-flex">
                    <button
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-9 w-9 rounded-full border-2 border-ink transition ${
                        color.toLowerCase() === c.toLowerCase()
                          ? "shadow-brut-sm scale-110"
                          : ""
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomColor(c);
                      }}
                      aria-label={`Remove ${c}`}
                      title="Remove"
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full border-2 border-ink bg-white text-[10px] leading-none font-bold opacity-0 group-hover:opacity-100 focus:opacity-100 transition flex items-center justify-center"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setHexInput("");
                    setHexError(null);
                    setShowColorPicker((v) => !v);
                  }}
                  aria-label="Add color"
                  title="Add color"
                  className={`h-9 w-9 rounded-full border-2 border-dashed border-ink bg-white flex items-center justify-center font-bold text-lg leading-none transition ${
                    showColorPicker ? "shadow-brut-sm scale-110 border-solid" : ""
                  }`}
                >
                  ＋
                </button>
                <span
                  className="ml-1 text-xs font-mono font-bold rounded border-2 border-ink px-2 py-1 bg-white"
                  title="Current color"
                >
                  {color.toUpperCase()}
                </span>
              </div>

              {showColorPicker && (
                <div
                  ref={colorPopRef}
                  className="absolute left-0 top-12 z-20 w-full max-w-sm card-brut p-4 shadow-brut-lg"
                >
                  <p className="text-xs font-bold mb-2 text-ink/70">Pick from palette</p>
                  <div className="grid grid-cols-6 gap-1.5 mb-4">
                    {EXTENDED_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          addCustomColor(c);
                          setShowColorPicker(false);
                        }}
                        className={`h-8 w-8 rounded-md border-2 border-ink transition hover:scale-110 ${
                          color.toLowerCase() === c.toLowerCase()
                            ? "shadow-brut-sm scale-110"
                            : ""
                        }`}
                        style={{ backgroundColor: c }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                  <p className="text-xs font-bold mb-2 text-ink/70">Or enter a hex code</p>
                  <div className="flex gap-2 items-stretch">
                    <span
                      className="w-10 rounded-lg border-2 border-ink shrink-0"
                      style={{
                        backgroundColor: normalizeHex(hexInput) ?? "transparent",
                        backgroundImage: normalizeHex(hexInput)
                          ? undefined
                          : "repeating-linear-gradient(45deg, #eee, #eee 4px, #fff 4px, #fff 8px)",
                      }}
                      aria-hidden
                    />
                    <input
                      type="text"
                      value={hexInput}
                      onChange={(e) => {
                        setHexInput(e.target.value);
                        if (hexError) setHexError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyHex();
                        }
                      }}
                      placeholder="#ddfc69"
                      className="input-brut flex-1 font-mono text-sm uppercase"
                      maxLength={7}
                    />
                    <button
                      type="button"
                      onClick={applyHex}
                      className="btn-brut btn-primary text-sm"
                    >
                      Apply
                    </button>
                  </div>
                  {hexError && (
                    <p className="mt-2 text-xs font-bold text-coral">{hexError}</p>
                  )}
                </div>
              )}
            </div>
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
                  onClick={() => onDelete(mode.template.id)}
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
