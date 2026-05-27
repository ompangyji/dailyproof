"use client";

import { useRef, useState } from "react";
import { uploadImage, type UploadKind } from "@/lib/supabase/upload";

type Props = {
  kind: UploadKind;
  urls: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

export function ImageUploader({ kind, urls, onChange, max = 12 }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const remaining = Math.max(0, max - urls.length);
      const slice = Array.from(files).slice(0, remaining);
      const uploaded: string[] = [];
      for (const f of slice) {
        const url = await uploadImage(f, kind);
        uploaded.push(url);
      }
      onChange([...urls, ...uploaded]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeAt(i: number) {
    const next = urls.slice();
    next.splice(i, 1);
    onChange(next);
  }

  const atMax = urls.length >= max;

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex gap-2 flex-wrap">
        {urls.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <span key={`${u}-${i}`} className="relative inline-block group">
            <img
              src={u}
              alt=""
              className="h-20 w-20 object-cover rounded-lg border-2 border-ink"
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label="Remove image"
              title="Remove"
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full border-2 border-ink bg-white text-xs leading-none font-bold opacity-0 group-hover:opacity-100 focus:opacity-100 transition flex items-center justify-center"
            >
              ×
            </button>
          </span>
        ))}
        {!atMax && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="h-20 w-20 rounded-lg border-2 border-dashed border-ink flex flex-col items-center justify-center gap-1 hover:bg-lime transition disabled:opacity-60"
            aria-label="Add photo"
          >
            <span className="text-2xl leading-none">＋</span>
            <span className="text-[10px] font-bold">
              {busy ? "Uploading…" : "Add photo"}
            </span>
          </button>
        )}
      </div>
      {atMax && (
        <p className="mt-2 text-xs text-ink/50">
          Max {max} images per item.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs font-bold text-coral border-2 border-coral bg-coral/10 rounded-lg px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}
