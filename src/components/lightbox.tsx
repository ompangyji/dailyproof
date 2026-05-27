"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Full-screen image viewer. Click the backdrop / × or press Esc to close. */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] bg-ink/80 flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded-lg border-2 border-paper shadow-brut-lg"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 h-10 w-10 rounded-full border-2 border-ink bg-white text-lg font-bold flex items-center justify-center hover:bg-coral hover:text-white transition"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
