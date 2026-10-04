"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

let openCount = 0;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Rendered as the prototype's serif <h3> and used as the accessible name. */
  title?: ReactNode;
  /** Accessible name when there is no visible title. */
  ariaLabel?: string;
  /** 640px instead of 440px (`.modal.wide`). */
  wide?: boolean;
  /** Show an × button in the corner. Default true when `title` is set. */
  showClose?: boolean;
  /** Pin to the top of the viewport (command palette). */
  top?: boolean;
  /** Extra class on the .modal panel (e.g. "flush" removes padding). */
  className?: string;
  /** Element to focus first; defaults to [autofocus] or the first focusable. */
  initialFocus?: React.RefObject<HTMLElement>;
  /** Disable Esc / scrim-click closing (e.g. while saving). */
  dismissible?: boolean;
}

/**
 * Accessible modal dialog (`.scrim` > `.modal`). Portals to <body>, traps Tab
 * focus, closes on Esc and scrim click, locks page scroll, and restores focus
 * to the trigger on close.
 */
export function Modal({ open, onClose, children, title, ariaLabel, wide, showClose, top, className, initialFocus, dismissible = true }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const downOnScrim = useRef(false);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.classList.add("modal-open");
    const t = requestAnimationFrame(() => {
      const el = panel.current;
      if (!el) return;
      const target =
        initialFocus?.current ||
        el.querySelector<HTMLElement>("[autofocus],[data-autofocus]") ||
        Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).find((x) => !x.classList.contains("mclose")) ||
        el;
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(t);
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.body.classList.remove("modal-open");
      if (prev && typeof prev.focus === "function" && document.contains(prev)) prev.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !mounted) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && dismissible) {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const withClose = showClose ?? !!title;

  return createPortal(
    <div
      className={top ? "scrim top no-print" : "scrim no-print"}
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (dismissible && downOnScrim.current && e.target === e.currentTarget) closeRef.current();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        className={["modal", wide && "wide", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
      >
        {withClose && (
          <button type="button" className="ibtn mclose" onClick={() => closeRef.current()} aria-label="Close dialog">
            <Icon name="x" />
          </button>
        )}
        {title && (
          <h3 id={titleId} style={withClose ? { paddingRight: 36 } : undefined}>
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
