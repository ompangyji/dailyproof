"use client";

import { useState } from "react";
import { mediaSrc } from "@/lib/supabase/upload";

type Props = {
  /** Stored URL (legacy public or /api/media proxy form). */
  src: string;
  alt?: string;
  /** Tailwind classes applied to the outer wrapper — size goes here. */
  className?: string;
  /** Extra classes for the inner <img> beyond the default object-cover. */
  imgClassName?: string;
  onClick?: () => void;
  title?: string;
};

/**
 * Drop-in replacement for <img src={mediaSrc(...)}>. Shows a paper-colored
 * skeleton with a spinner over the image slot until the browser fires
 * onLoad — the /api/media proxy can take a second or two per image, which
 * otherwise leaves a blank rectangle and makes the page feel frozen.
 */
export function MediaImage({
  src,
  alt = "",
  className = "",
  imgClassName = "",
  onClick,
  title,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const resolved = mediaSrc(src);

  return (
    <span className={`relative inline-block overflow-hidden ${className}`}>
      {!loaded && !errored && (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-paper"
        >
          <span
            className="brut-spinner"
            style={{ width: "0.9rem", height: "0.9rem", borderWidth: "2px" }}
          />
        </span>
      )}
      {errored && (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-paper text-[10px] font-bold text-ink/40"
        >
          ?
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={onClick}
        title={title}
        className={`block h-full w-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        } ${imgClassName}`}
      />
    </span>
  );
}
