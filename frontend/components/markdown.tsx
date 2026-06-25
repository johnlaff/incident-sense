"use client";

// Renders the Aurora suggestion (LLM markdown) the way every modern AI chat
// does — via react-markdown + remark-gfm — while keeping the project's signature
// feature: the [INC…] citations stay first-class, clickable buttons that peek the
// cited incident. A tiny remark plugin rewrites bare/bracketed INC numbers into
// internal "#INC…" links, which the `a` renderer turns into citation buttons.

import type { Root, RootContent } from "mdast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const CITE_TOKEN = /\[?(INC\d{4,})\]?/g;

/** Split a text value into text + citation-link mdast nodes. */
function splitCitations(value: string): RootContent[] {
  const out: RootContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CITE_TOKEN.lastIndex = 0;
  while ((match = CITE_TOKEN.exec(value)) !== null) {
    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    out.push({
      type: "link",
      url: `#${match[1]}`,
      children: [{ type: "text", value: match[1] }],
    });
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out.length ? out : [{ type: "text", value }];
}

/** remark plugin: expand INC tokens inside any text node into citation links. */
function remarkCitations() {
  const walk = (node: { children?: RootContent[] }): void => {
    if (!Array.isArray(node.children)) return;
    const next: RootContent[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        next.push(...splitCitations(child.value));
      } else {
        walk(child as { children?: RootContent[] });
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: Root): void => walk(tree);
}

export function SuggestionMarkdown({
  source,
  onCite,
  flashCite,
}: {
  source: string;
  onCite: (n: string) => void;
  flashCite: string | null;
}) {
  const components: Components = {
    a({ href, children }) {
      const cite = /^#(INC\d{4,})$/.exec(href ?? "");
      if (cite) {
        const n = cite[1];
        return (
          <button
            type="button"
            className={`cite${flashCite === n ? " flash" : ""}`}
            onClick={() => onCite(n)}
            aria-label={`Abrir incidente citado ${n}`}
          >
            {n}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCitations]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
