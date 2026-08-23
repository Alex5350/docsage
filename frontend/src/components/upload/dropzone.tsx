"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { FileUpIcon, UploadCloudIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_TYPES } from "@/lib/providers";

const ACCEPT_ATTR = `${ACCEPTED_MIME_TYPES.join(",")},${ACCEPTED_EXTENSIONS.join(",")}`;

/**
 * Drag-and-drop target with a keyboard/click-accessible file-input fallback.
 * Invalid drops are still surfaced through `onFiles` so the page can explain
 * why a file was rejected.
 */
export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add files: drop documents here or press Enter to browse"
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        "ds-aurora group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        dragging
          ? "border-primary bg-accent"
          : "border-border hover:border-primary/50 hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "grid size-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary transition-transform",
          dragging ? "scale-110" : "group-hover:scale-105",
        )}
      >
        <UploadCloudIcon className="size-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold tracking-tight">
          {dragging ? "Drop to add documents" : "Drag & drop documents here"}
        </p>
        <p className="text-sm text-muted-foreground">
          or{" "}
          <span className="font-medium text-primary underline underline-offset-4">
            browse your files
          </span>{" "}
          — PDF, DOCX, XLSX, PNG, JPG, TXT, MD, CSV · up to 25 MB each
        </p>
      </div>
      <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
        <FileUpIcon className="size-3.5" aria-hidden />
        Extracted, enriched, and embedded on upload
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = ""; // allow re-selecting the same file
        }}
      />
    </div>
  );
}
