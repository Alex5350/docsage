import { cn } from "@/lib/utils";

/**
 * DocSage mark: layered document pages with a spark of insight, on a teal
 * gradient tile. Inline SVG so it inherits size/color from its container.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="DocSage"
      className={cn("size-8", className)}
    >
      <defs>
        <linearGradient id="ds-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#ds-logo-grad)" />
      {/* back page */}
      <path
        d="M13.5 6.5h7.6a1.5 1.5 0 0 1 1.06.44l3.9 3.9a1.5 1.5 0 0 1 .44 1.06V25a1.5 1.5 0 0 1-1.5 1.5h-11.5A1.5 1.5 0 0 1 12 25V8a1.5 1.5 0 0 1 1.5-1.5Z"
        fill="#ffffff"
        opacity="0.35"
      />
      {/* front page with folded corner */}
      <path
        d="M9.5 5.5h8.88a1.5 1.5 0 0 1 1.06.44l4.12 4.12a1.5 1.5 0 0 1 .44 1.06V24a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 24V7a1.5 1.5 0 0 1 1.5-1.5Z"
        fill="#ffffff"
      />
      <path d="M18 5.8V9.5a1.5 1.5 0 0 0 1.5 1.5h3.7L18 5.8Z" fill="#0f766e" opacity="0.5" />
      {/* text lines */}
      <rect x="11" y="14" width="9" height="1.6" rx="0.8" fill="#0f766e" opacity="0.65" />
      <rect x="11" y="17.6" width="6.5" height="1.6" rx="0.8" fill="#0f766e" opacity="0.45" />
      {/* spark */}
      <path
        d="M22.6 13.2l.83 2.07 2.07.83-2.07.83-.83 2.07-.83-2.07-2.07-.83 2.07-.83.83-2.07Z"
        fill="#fbbf24"
      />
    </svg>
  );
}
