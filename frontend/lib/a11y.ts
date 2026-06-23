"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * Make a non-button clickable element (a styled row, chip, or map point)
 * keyboard-operable: focusable, and activated by Enter/Space like a button.
 * Spread onto the element alongside its visual class.
 */
export function activate(fn: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn();
      }
    },
  };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Focus management for a modal dialog: move focus inside on open, keep Tab /
 * Shift+Tab cycling within it, and restore focus to the opener on close.
 * Attach the returned ref to the dialog container (give it tabIndex={-1} so it
 * can hold focus when it has no focusable children yet).
 */
export function useFocusTrap<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? node).focus();

    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [active]);
  return ref;
}
