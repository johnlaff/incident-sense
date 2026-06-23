"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  run: () => void;
}

/** Pure, testable command filter (substring over label + group + keywords). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((command) =>
    `${command.label} ${command.group} ${command.keywords ?? ""}`
      .toLowerCase()
      .includes(needle),
  );
}

export interface CommandPalette {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  results: Command[];
}

/** Headless ⌘K palette: global key handling + filtered results. UI lands later. */
export function useCommandPalette(commands: Command[]): CommandPalette {
  const [open, setOpenRaw] = useState(false);
  const [query, setQuery] = useState("");

  // Closing always clears the query — done here (and in the key handler) rather
  // than in an effect, to keep state updates out of effects.
  const setOpen = useCallback((value: boolean) => {
    setOpenRaw(value);
    if (!value) setQuery("");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpenRaw((value) => {
          const next = !value;
          if (!next) setQuery("");
          return next;
        });
      } else if (event.key === "Escape") {
        setOpenRaw(false);
        setQuery("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  return { open, setOpen, query, setQuery, results };
}
