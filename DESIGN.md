# Design

The visual system for incident-sense: a credible, didactic bank-ITSM workspace.
Light, high-contrast, ServiceNow-recognizable in structure, modern in legibility.
All colors in OKLCH.

## Theme

**Light, not dark.** Real ITSM tools are light; light survives a projector and a
beginner's first look, and it is the deliberate break from the previous
"neon-on-near-black AI dashboard". Density and calm, not spectacle.

Color strategy: **Restrained** — tinted-neutral surfaces + one brand accent.
The brand color is **indigo-violet**, chosen deliberately *off* the status hues
(it must never be confused with red=critical, amber=warning, green=resolved).
It carries primary actions, current selection, links, and the AI copilot's
identity — nothing decorative.

## Color

```
/* Surfaces — cool, barely-tinted toward the brand */
--bg:          oklch(0.985 0.003 285);  /* app shell (top bar, side nav) */
--surface:     oklch(1.000 0.000 0);    /* content: tables, forms, cards */
--surface-2:   oklch(0.974 0.004 285);  /* hover / zebra / raised */
--border:      oklch(0.920 0.004 285);
--border-strong:oklch(0.860 0.005 285);

/* Ink — high contrast for projection */
--ink:         oklch(0.255 0.012 285);  /* headings */
--ink-body:    oklch(0.320 0.011 285);  /* body  ~9:1 on white */
--muted:       oklch(0.500 0.010 285);  /* secondary ~5.6:1; placeholders too */

/* Brand / primary (indigo-violet) */
--primary:        oklch(0.480 0.160 285);  /* button bg; white text ~6:1 */
--primary-hover:  oklch(0.420 0.160 285);
--primary-tint:   oklch(0.960 0.020 285);  /* selected row, AI surfaces */
--primary-ink:    oklch(0.400 0.150 285);  /* brand text on white/tint */

/* Status — encoded with icon + label too, never color alone */
--p1: oklch(0.545 0.205 27);   /* critical  */
--p2: oklch(0.620 0.170 45);   /* high      */
--p3: oklch(0.680 0.135 75);   /* moderate  */
--p4: oklch(0.560 0.020 285);  /* low/slate */

--state-open:    oklch(0.560 0.130 240);  /* New / Open */
--state-progress:oklch(0.600 0.140 55);   /* In Progress */
--state-hold:    oklch(0.560 0.020 285);  /* On Hold */
--state-resolved:oklch(0.560 0.130 150);  /* Resolved */
--state-closed:  oklch(0.450 0.010 285);  /* Closed */

--success: oklch(0.560 0.130 150);
--warning: oklch(0.680 0.135 75);
--danger:  oklch(0.545 0.205 27);
--info:    oklch(0.560 0.130 240);
```

Badges/pills: background = the hue at ~0.96 L (tint), text = the hue near ~0.40 L
(a darker shade of the same hue), never gray text on a colored tint.

## Typography

- **One family: Inter** (variable) for headings, labels, buttons, body, data —
  product UIs don't need display/body pairing.
- **Mono: JetBrains Mono / `ui-monospace`** for incident numbers, IDs, scores,
  and code-like values (gives the tool its "system" texture).
- **Fixed rem scale** (no fluid clamps): 12 / 13 / 14 / 16 / 18 / 20 / 24 / 30.
  Base body 14px (dense tool), prose 16px. Scale ratio ~1.2.
- Prose capped at 65–75ch; tables may run dense.
- Headings: weight 600, letter-spacing −0.01em (not tighter). `text-wrap: balance`.

## Layout

Modeled on **ServiceNow's Agent / Service Operations Workspace** (verified
against real screenshots): a neutral app frame with a list, a record, and a
contextual AI panel.

App shell: **fixed left nav + top bar + content**.

- Left nav: Incidentes · Recorrências · Como funciona (icons + labels; collapses
  to icons < lg).
- **Incident list** (`/incidentes`): dense ServiceNow-style table under a
  condition/filter bar (state segmented control · service · search); columns
  Number · Short description · Service · State · Priority · Opened.
- **Incident detail** (`/incidentes/[number]`): the Agent-Workspace three-zone
  shape — a sectioned two-column **record form** (read-only) in the center with a
  tabbed area (Detalhes · Atividade), and the **AI copilot docked on the right**
  (the "Agent Assist" slot), collapsing below the record < lg.

Responsive is structural (collapse nav, stack the copilot, table → cards on
mobile), never fluid typography. Semantic z-index scale: base → sticky header →
dropdown → drawer → modal → toast.

### Fidelity to ServiceNow (and the brand)

The **structure, interactions and density** are faithful to ServiceNow (list +
record + contextual AI panel; sectioned two-column form; tabbed activity stream;
colored status). The **chrome stays neutral** (white/gray) exactly like the real
Workspace; the indigo brand accent is reserved for primary/selected/links/AI —
realistic, since enterprises theme their ServiceNow accent. It reads as "Banco
Meridiano's ServiceNow", not a generic SaaS dashboard.

## Components (each needs default/hover/focus/active/disabled/loading/error)

- **DataTable** — dense rows, sticky header, sortable columns, zebra on hover,
  keyboard row nav, skeleton rows while loading, teaching empty state.
- **Filters** — state (Abertos/Resolvidos/Todos) segmented control; service +
  search. Reflected in the URL (shareable).
- **StatusBadge / PriorityBadge** — icon + label + tint; never color alone.
- **IncidentRecord** — ServiceNow-style sectioned form (read-only fields).
- **ActivityStream** — chronological work notes / state changes.
- **Copilot** — chat-style panel: the analyst asks "sugerir resolução", the AI
  streams the answer with **clickable citation chips** that open the cited
  incident; the suggestion is an **editable draft** ("assist, not override").
- **PipelineTrace** — the under-the-hood steps (resumir → embed → buscar →
  filtrar → classificar → sugerir) animate inline as the copilot works, and get
  a fuller dedicated treatment on the "Como funciona" page.
- **ClusterMap** (reused, retitled) — the WebGL recurrence view, reframed as
  "Recorrências / Problemas".

## Motion

- 150–250 ms, ease-out (quart/expo). Motion conveys **state**: row hover, panel
  open, the pipeline advancing one step, a citation pulsing when opened.
- The cluster reveal stays (it's a deliberate *moment* on its own page), toned to
  ~700 ms. No site-wide page-load choreography elsewhere.
- Every animation has a `prefers-reduced-motion: reduce` crossfade/instant path.

## Accessibility

WCAG 2.2 AA. Body ≥ 4.5:1 (verified against the ramp above). Focus-visible rings
on every interactive element. Status by icon+label. Full keyboard paths. Tested
in-browser via screenshots.
