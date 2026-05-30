"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

export const SUGGESTED_TAGS = [
  "workout",
  "study",
  "reading",
  "work",
  "hobby",
  "health",
  "morning",
  "evening",
];

const MAX_TAGS = 20;
const MAX_CUSTOM_TAGS = 40;

export function normalizeTag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return cleaned || null;
}

export type TagsFieldHandle = {
  /** Drain unflushed input text into tags and return the merged list. */
  flush: () => string[];
};

type Props = {
  tags: string[];
  onTagsChange: (next: string[]) => void;
  /** Account-synced reusable tag library (DB). */
  customTags: string[];
  onCustomTagsChange: (next: string[]) => void;
  placeholder?: string;
};

export const TagsField = forwardRef<TagsFieldHandle, Props>(function TagsField(
  {
    tags,
    onTagsChange,
    customTags,
    onCustomTagsChange,
    placeholder = "#workout, #health — press Enter or comma",
  },
  ref,
) {
  const [tagInput, setTagInput] = useState("");

  function addTag(raw: string) {
    const n = normalizeTag(raw);
    if (!n) return;
    if (tags.some((t) => t.toLowerCase() === n.toLowerCase())) return;
    if (tags.length >= MAX_TAGS) return;
    onTagsChange([...tags, n]);
  }

  function removeTag(t: string) {
    onTagsChange(tags.filter((x) => x !== t));
  }

  function addCustomTag(raw: string) {
    const n = normalizeTag(raw);
    if (!n) return;
    const lc = n.toLowerCase();
    if (SUGGESTED_TAGS.some((p) => p.toLowerCase() === lc)) return;
    if (customTags.some((x) => x.toLowerCase() === lc)) return;
    onCustomTagsChange([...customTags, n].slice(-MAX_CUSTOM_TAGS));
  }

  function removeCustomTag(t: string) {
    const lc = t.toLowerCase();
    onCustomTagsChange(customTags.filter((x) => x.toLowerCase() !== lc));
  }

  function commitTagInput() {
    if (!tagInput.trim()) return;
    tagInput.split(/[,\s]+/).forEach((piece) => {
      addTag(piece);
      addCustomTag(piece);
    });
    setTagInput("");
  }

  // Drain unflushed text. We can't rely on the existing onTagsChange callback
  // here because React batches setTags from commitTagInput; the parent's
  // submit handler reads stale state. So we return the merged list directly
  // for the parent to use synchronously.
  useImperativeHandle(
    ref,
    () => ({
      flush(): string[] {
        if (!tagInput.trim()) return tags;
        const merged = [...tags];
        tagInput.split(/[,\s]+/).forEach((piece) => {
          const n = normalizeTag(piece);
          if (!n) return;
          if (merged.some((t) => t.toLowerCase() === n.toLowerCase())) return;
          if (merged.length >= MAX_TAGS) return;
          merged.push(n);
          addCustomTag(n);
        });
        onTagsChange(merged);
        setTagInput("");
        return merged;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagInput, tags, customTags],
  );

  const lcs = (s: string) => s.toLowerCase();
  const selected = new Set(tags.map(lcs));
  const items = [
    ...SUGGESTED_TAGS.map((t) => ({ tag: t, custom: false })),
    ...customTags
      .filter((t) => !SUGGESTED_TAGS.some((p) => lcs(p) === lcs(t)))
      .map((t) => ({ tag: t, custom: true })),
  ].filter(({ tag }) => !selected.has(lcs(tag)));

  const chipCls =
    "text-xs font-bold rounded-full border-2 border-ink/30 px-2 py-0.5 hover:border-ink hover:bg-lime transition text-ink/60 hover:text-ink";

  return (
    <div>
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
            onTagsChange(tags.slice(0, -1));
          }
        }}
        onBlur={commitTagInput}
        placeholder={placeholder}
        className="input-brut"
        maxLength={50}
      />
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map(({ tag, custom }) =>
            custom ? (
              <span key={tag} className="relative group inline-flex">
                <button
                  type="button"
                  onClick={() => addTag(tag)}
                  className={chipCls}
                >
                  +#{tag}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustomTag(tag);
                  }}
                  aria-label={`Remove ${tag} from list`}
                  title="Remove from list"
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full border-2 border-ink bg-white text-[10px] leading-none font-bold opacity-0 group-hover:opacity-100 focus:opacity-100 transition flex items-center justify-center"
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className={chipCls}
              >
                +#{tag}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
});
