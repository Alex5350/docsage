import {
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Maps a mime type to the icon used on document cards and lists. */
export function MimeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = (() => {
    if (mimeType === "application/pdf") return FileTextIcon;
    if (mimeType.includes("wordprocessingml")) return FileTypeIcon; // docx
    if (mimeType.includes("spreadsheetml") || mimeType === "text/csv") return FileSpreadsheetIcon;
    if (mimeType.startsWith("image/")) return FileImageIcon;
    if (mimeType.startsWith("text/")) return FileTextIcon;
    return FileIcon;
  })();
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** Short lowercase label for a mime type, e.g. `pdf`, `docx`. */
export function mimeLabel(mimeType: string): string {
  const known: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "image/png": "png",
    "image/jpeg": "jpg",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
  };
  return known[mimeType] ?? (mimeType.replace(/^[a-z]+\//, "").split(/[;+]/)[0] || "file");
}
