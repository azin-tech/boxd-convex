import { useEffect, useRef, useState, type ReactNode } from "react";
import { notchedPath, rectPath } from "./box.js";
import { BoxMark } from "./NotchedPanel.js";

/* The boxd.sh hero controls, ported from boxd/website (BoxButton, InstallBar):
   on hover a control reveals the container notch in its bottom-left corner. */

function useNotch({ disabled = false, notch = 10 } = {}) {
  const [hovered, setHovered] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const r = 6;
  const show = hovered && !disabled && !!size && size.h > 24;
  return {
    ref,
    size,
    hovered: hovered && !disabled,
    clipPath:
      show && size
        ? `path('${notchedPath(size.w, size.h, r, notch)}')`
        : undefined,
    borderPath: size
      ? show
        ? notchedPath(size.w, size.h, r, notch, 0.5)
        : rectPath(size.w, size.h, r, 0.5)
      : null,
    hoverProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  };
}

function CopyGlyph({ copied }: { copied: boolean }) {
  return copied ? (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8.5L6.5 12L13 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** The primary control: "Get started" plus the install command; a click copies it. */
export function InstallBar({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const { ref, hovered, clipPath, hoverProps } = useNotch();

  function copy() {
    void navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <button
      type="button"
      className="installbar"
      onClick={copy}
      aria-label={`Get started: copy the install command, ${command}`}
    >
      <span
        ref={ref}
        className="installbar-ground"
        data-hover={hovered || undefined}
        style={{ clipPath }}
        {...hoverProps}
      >
        <span className="installbar-label">
          <BoxMark size={14} fill="#09090b" />
          Get started
        </span>
        <span className="installbar-cmd">
          <span aria-hidden="true">$</span>
          {command}
        </span>
        <span
          className="installbar-copy"
          data-copied={copied || undefined}
          aria-hidden="true"
        >
          <CopyGlyph copied={copied} />
        </span>
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Install command copied" : ""}
      </span>
    </button>
  );
}

/** The same bar with an action in the middle: "Get started | Boot a machine". */
export function StartBar({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { ref, hovered, clipPath, hoverProps } = useNotch({ disabled });
  return (
    <button
      type="button"
      className="installbar"
      onClick={onClick}
      disabled={disabled}
    >
      <span
        ref={ref}
        className="installbar-ground"
        data-hover={hovered || undefined}
        style={{ clipPath }}
        {...hoverProps}
      >
        <span className="installbar-label">
          <BoxMark size={14} fill="#09090b" />
          Get started
        </span>
        <span className="installbar-action">{children}</span>
      </span>
    </button>
  );
}

/** The install command on boxd.sh's secondary button (as Docs, GitHub). */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <GhostButton
      onClick={() => {
        void navigator.clipboard
          ?.writeText(command)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
    >
      <span className="copycommand">
        <span aria-hidden="true">$</span>
        {command}
        <CopyGlyph copied={copied} />
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Install command copied" : ""}
      </span>
    </GhostButton>
  );
}

/** The ghost button: a drawn zinc border that takes the notch on hover. */
export function GhostButton({
  children,
  onClick,
  href,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const { ref, size, hovered, clipPath, borderPath, hoverProps } = useNotch({
    disabled,
  });
  const ground = (
    <span
      ref={ref}
      className="ghostbutton-ground"
      data-hover={hovered || undefined}
      style={{ clipPath }}
      {...hoverProps}
    >
      {children}
      {borderPath && size && (
        <svg
          aria-hidden="true"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          <path d={borderPath} fill="none" strokeWidth="1" />
        </svg>
      )}
    </span>
  );
  return href ? (
    <a className="ghostbutton" href={href}>
      {ground}
    </a>
  ) : (
    <button
      type="button"
      className="ghostbutton"
      onClick={onClick}
      disabled={disabled}
    >
      {ground}
    </button>
  );
}
