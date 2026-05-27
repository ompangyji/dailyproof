"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const STEP = 0.5;

function filenameFromUrl(u: string): string {
  try {
    const name = new URL(u).pathname.split("/").pop();
    return name ? decodeURIComponent(name) : "image";
  } catch {
    return "image";
  }
}

/**
 * Full-screen image viewer with zoom (buttons / wheel / click) + pan + download.
 * Click the backdrop or press Esc to close.
 */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);

  const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = clamp(Math.round((s + delta) * 100) / 100);
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Esc to close, +/-/0 for zoom.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(-STEP);
      else if (e.key === "0") reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomBy, reset]);

  // Wheel to zoom (native, non-passive so we can preventDefault page scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : -STEP);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  async function download() {
    try {
      const res = await fetch(src, { mode: "cors" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromUrl(src);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    movedRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (scale > 1) setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
    if (scale > 1) setOffset({ x: d.ox + dx, y: d.oy + dy });
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
    // A click without movement cycles zoom: 1 → 2 → 3 → … → max → back to 1.
    if (!movedRef.current) {
      setScale((s) => {
        const next = s >= MAX_SCALE ? MIN_SCALE : clamp(Math.floor(s) + 1);
        if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
        return next;
      });
    }
  }

  const ctrlBtn =
    "h-10 w-10 rounded-full border-2 border-ink bg-white text-lg font-bold flex items-center justify-center hover:bg-lime transition disabled:opacity-40 disabled:hover:bg-white";

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[1100] bg-ink/80 flex items-center justify-center p-4 sm:p-8 overflow-hidden"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: dragging ? "none" : "transform 0.15s ease",
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          touchAction: "none",
        }}
        className="max-h-full max-w-full object-contain rounded-lg border-2 border-paper shadow-brut-lg select-none"
      />

      {/* Controls */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomBy(-STEP)}
          disabled={scale <= MIN_SCALE}
          aria-label="Zoom out"
          title="Zoom out (−)"
          className={ctrlBtn}
        >
          −
        </button>
        <span className="min-w-[3.25rem] text-center text-sm font-bold text-paper select-none">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(STEP)}
          disabled={scale >= MAX_SCALE}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className={ctrlBtn}
        >
          +
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
          aria-label="Reset zoom"
          title="Reset (0)"
          className={`${ctrlBtn} text-xs`}
        >
          1:1
        </button>
        <button
          type="button"
          onClick={download}
          aria-label="Download image"
          title="Download"
          className={ctrlBtn}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className={`${ctrlBtn} hover:bg-coral hover:text-white`}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
