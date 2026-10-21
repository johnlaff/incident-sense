"use client";

// The way into the assistant chat: a labelled button that floats over the
// record. It stays on screen whatever else is visible (the purple
// "Analisar com a IA" opens the analysis tab, not the chat, so the two never
// stand in for each other). On a phone it slides down while the reader
// scrolls down, and comes back on the way up, at the end of the page, or as
// soon as the scrolling stops.

import { useEffect, useState } from "react";

import { Icons } from "./icons";

/** How long a phone scroll must rest before the button comes back. */
export const TUCK_REST_MS = 900;

export interface TuckInput {
  y: number;
  lastY: number;
  atEnd: boolean;
  phone: boolean;
}

/** Pure step of the tuck rule, for tests. */
export function nextTucked(
  prev: boolean,
  { y, lastY, atEnd, phone }: TuckInput,
): boolean {
  if (!phone || atEnd || y < 80) return false;
  if (y > lastY + 4) return true;
  if (y < lastY - 4) return false;
  return prev;
}

function useTucked(): [boolean, () => void] {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767.98px)");
    let lastY = window.scrollY;
    let rest: ReturnType<typeof setTimeout> | undefined;
    function onScroll() {
      const y = window.scrollY;
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
      setTucked((prev) => nextTucked(prev, { y, lastY, atEnd, phone: phone.matches }));
      lastY = y;
      clearTimeout(rest);
      rest = setTimeout(() => setTucked(false), TUCK_REST_MS);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(rest);
    };
  }, []);
  return [tucked, () => setTucked(false)];
}

export function AssistantFab({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const [tucked, untuck] = useTucked();
  const state = open ? " hidden" : tucked ? " tucked" : "";
  return (
    <button
      type="button"
      className={`cop-fab${state}`}
      onClick={onOpen}
      onFocus={untuck}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Abre o assistente da IA: ele sugere uma resolução e explica de onde ela veio"
    >
      <Icons.aiSpark />
      <span className="cop-fab-t">Perguntar à IA</span>
    </button>
  );
}
