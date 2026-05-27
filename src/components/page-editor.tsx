"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import LinkExt from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteLog } from "@/app/actions/logs";
import { deletePage, savePage } from "@/app/actions/pages";
import {
  deleteImagesByUrl,
  diffRemoved,
  extractImageUrls,
  uploadImage,
} from "@/lib/supabase/upload";
import { Lightbox } from "./lightbox";

type Props = {
  templateId: string;
  logDate: string;
  title: string;
  color: string | null;
  emoji: string | null;
  tags: string[];
  hasLog: boolean;
  initialContent: unknown | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function PageEditor({
  templateId,
  logDate,
  title,
  color,
  emoji,
  tags,
  hasLog,
  initialContent,
}: Props) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Snapshot of image URLs as of the most recent successful save. Used to
  // detect which images got removed from the editor since then, so we can
  // clean them out of Storage.
  const savedImageUrlsRef = useRef<string[]>(extractImageUrls(initialContent));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({}),
      Placeholder.configure({
        placeholder: "What happened today? Write freely…",
      }),
      LinkExt.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: "cursor-zoom-in", title: "Click to view" },
      }),
    ],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "max-w-none focus:outline-none py-6",
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const imageFiles: File[] = [];
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) imageFiles.push(f);
          }
        }
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        void insertFiles(imageFiles);
        return true;
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imageFiles = Array.from(files).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (imageFiles.length === 0) return false;
        event.preventDefault();
        void insertFiles(imageFiles);
        return true;
      },
      // Click an image to view it full-size. We don't preventDefault, so the
      // node still gets selected underneath and can be deleted after closing.
      handleClickOn(_view, _pos, node) {
        if (node.type.name === "image" && typeof node.attrs.src === "string") {
          setViewer(node.attrs.src);
        }
        return false;
      },
    },
  });

  const insertFiles = useCallback(
    async (files: File[]) => {
      if (!editor) return;
      setUploading(true);
      try {
        for (const f of files) {
          const url = await uploadImage(f, "pages");
          editor.chain().focus().setImage({ src: url }).run();
        }
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [editor],
  );

  const scheduleSave = useCallback(() => {
    if (!editor) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    debounceRef.current = setTimeout(async () => {
      try {
        const json = editor.getJSON();
        await savePage({
          template_id: templateId,
          log_date: logDate,
          content: json,
          content_text: editor.getText(),
        });
        // After a successful save, prune Storage of any images that were in
        // the prior saved snapshot but not in this one.
        const nowUrls = extractImageUrls(json);
        const removed = diffRemoved(savedImageUrlsRef.current, nowUrls);
        savedImageUrlsRef.current = nowUrls;
        if (removed.length) void deleteImagesByUrl(removed);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 800);
  }, [editor, templateId, logDate]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", scheduleSave);
    return () => {
      editor.off("update", scheduleSave);
    };
  }, [editor, scheduleSave]);

  async function onRemoveLog() {
    if (!confirm(`Remove the "${title}" log on ${logDate} from the calendar? (Note stays)`))
      return;
    await deleteLog(templateId, logDate);
    router.replace("/");
  }

  async function onClearPage() {
    if (!confirm("Clear this day's note content?")) return;
    const orphans = savedImageUrlsRef.current.slice();
    await deletePage(templateId, logDate);
    editor?.commands.clearContent();
    savedImageUrlsRef.current = [];
    setSaveState("saved");
    if (orphans.length) void deleteImagesByUrl(orphans);
  }

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-8 pt-8 pb-24">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void insertFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <div className="card-brut p-6 sm:p-8">
        <div className="mb-3 flex items-center justify-between text-xs">
          <SaveBadge state={saveState} uploading={uploading} />
          <div className="flex gap-2">
            <button onClick={onClearPage} className="btn-brut btn-ghost text-xs">
              Clear page
            </button>
            {hasLog && (
              <button onClick={onRemoveLog} className="btn-brut btn-coral text-xs">
                Remove today
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span
            className="inline-block h-5 w-5 rounded-full border-2 border-ink"
            style={{ backgroundColor: color ?? "#ddfc69" }}
          />
          {emoji && (
            <span className="text-3xl sm:text-4xl leading-none" aria-hidden>
              {emoji}
            </span>
          )}
          <h1 className="font-display text-4xl sm:text-5xl leading-tight">{title}</h1>
        </div>
        {(tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(tags ?? []).map((t) => (
              <span
                key={t}
                className="text-xs font-bold rounded-full border-2 border-ink bg-lime px-2 py-0.5"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        <Toolbar editor={editor} onUploadClick={() => fileInputRef.current?.click()} />
        <EditorContent editor={editor} />
      </div>
      {viewer && <Lightbox src={viewer} onClose={() => setViewer(null)} />}
    </article>
  );
}

function SaveBadge({
  state,
  uploading,
}: {
  state: SaveState;
  uploading: boolean;
}) {
  if (uploading) {
    return (
      <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold border-2 border-ink bg-electric text-white">
        Uploading…
      </span>
    );
  }
  const text = {
    idle: " ",
    saving: "Saving…",
    saved: "Saved ✓",
    error: "Save failed",
  }[state];
  const cls = {
    idle: "text-ink/30",
    saving: "text-ink/60",
    saved: "text-ink bg-lime border-ink",
    error: "text-white bg-coral border-ink",
  }[state];
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold border-2 ${cls}`}
      style={state === "idle" || state === "saving" ? { borderColor: "transparent" } : {}}
    >
      {text}
    </span>
  );
}

type EditorLike = ReturnType<typeof useEditor>;
function Toolbar({
  editor,
  onUploadClick,
}: {
  editor: EditorLike;
  onUploadClick: () => void;
}) {
  if (!editor) return null;
  const btn =
    "rounded-md px-2 py-1 text-xs font-bold border-2 border-transparent hover:border-ink";
  const active = "bg-lime border-ink";
  return (
    <div className="my-4 flex flex-wrap gap-1 border-y-2 border-ink py-2">
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`${btn} ${editor.isActive("heading", { level: 1 }) ? active : ""}`}
      >
        H1
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`${btn} ${editor.isActive("heading", { level: 2 }) ? active : ""}`}
      >
        H2
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`${btn} ${editor.isActive("heading", { level: 3 }) ? active : ""}`}
      >
        H3
      </button>
      <span className="mx-1 w-px bg-ink/20" />
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`${btn} ${editor.isActive("bold") ? active : ""}`}
      >
        <b>B</b>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${btn} ${editor.isActive("italic") ? active : ""}`}
      >
        <i>I</i>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`${btn} ${editor.isActive("strike") ? active : ""}`}
      >
        <s>S</s>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`${btn} ${editor.isActive("code") ? active : ""}`}
      >
        {"</>"}
      </button>
      <span className="mx-1 w-px bg-ink/20" />
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${btn} ${editor.isActive("bulletList") ? active : ""}`}
      >
        • List
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${btn} ${editor.isActive("orderedList") ? active : ""}`}
      >
        1. List
      </button>
      <button
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={`${btn} ${editor.isActive("taskList") ? active : ""}`}
      >
        ☐ Tasks
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`${btn} ${editor.isActive("blockquote") ? active : ""}`}
      >
        “ Quote
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`${btn} ${editor.isActive("codeBlock") ? active : ""}`}
      >
        Code block
      </button>
      <button
        onClick={() => {
          const prev = editor.getAttributes("link").href ?? "";
          const url = prompt("Link URL", prev);
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().unsetLink().run();
          } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }
        }}
        className={`${btn} ${editor.isActive("link") ? active : ""}`}
      >
        🔗 Link
      </button>
      <button onClick={onUploadClick} className={btn} title="Insert image">
        🖼️ Image
      </button>
      <span className="mx-1 w-px bg-ink/20" />
      <button onClick={() => editor.chain().focus().undo().run()} className={btn}>
        ↶
      </button>
      <button onClick={() => editor.chain().focus().redo().run()} className={btn}>
        ↷
      </button>
    </div>
  );
}
