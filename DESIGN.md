# Design

The visual system for incident-sense: a teaching workspace for a fictional bank
(Banco Meridiano) that shows, step by step, where an AI helps after a deploy and
where a person decides. All colors in OKLCH. Tokens live in
`frontend/app/globals.css`; shell overrides in `frontend/app/shell.css`; concept
classes in `frontend/app/concepts.css`; concept components in
`frontend/components/concepts.tsx`.

## Direction: "Claro"

A light, calm workspace in the line of the products known for clean interfaces
(Vercel/Geist, Linear, Stripe, Resend docs, Cal.com): a near-white frame,
white cards for grouped content, 1px hairlines instead of shadows, ink text,
one accent color used sparingly.

Mode: **Operate**. Ambition shows as precision and restraint: clear hierarchy,
big tabular numbers, short copy, and one signature move.

Two rules carry the whole system:

1. **Violet is only for the machine.** AI steps, AI answers and the button that
   asks the AI. It is the only accent; nothing else uses violet.
2. **Ink is for the person.** Primary human actions (Resolver, Abrir, Ver) and
   the "Agora é com você" decision use ink, never a hue.

Signature move, **o fio**: sequences are drawn as a 1px line with small
stations (the AI pipeline on an incident, the lesson route on `/aula`, the
lifecycle row on `/como-funciona`). Violet line for the machine, ink for the
human path. No boxes around steps.

Anti-reference: the previous "Pulseira de triagem" look (dark ink frame, solid
colored wristband chips). Concepts are now a colored icon or dot plus a faint
tint, with the text staying dark.

## Theme

- **Light (default).** Frame `--bg` near white; on desktop the content sits
  straight on the frame and only grouped content gets a white card (no sheet
  under the cards, so a card never sits inside another card). On a phone the
  body is white and the bottom tab bar is white with a hairline.
- **Dark** (`[data-theme="dark"]` and `prefers-color-scheme`): near-black neutral
  frame, surfaces a few steps lighter, hairline borders, concept colors lighter
  at similar chroma.

## Color

```
/* Neutrals (light) */
--bg:            oklch(0.982 0.002 265)   /* frame */
--surface:       oklch(1 0 0)             /* cards, phone body */
--surface-2:     oklch(0.968 0.003 265)   /* wells, active nav */
--border:        oklch(0.92 0.004 265)
--border-strong: oklch(0.855 0.006 265)
--ink:           oklch(0.2 0.012 265)     /* headings, human actions */
--ink-body:      oklch(0.33 0.012 265)
--muted:         oklch(0.49 0.012 265)
--focus:         oklch(0.56 0.17 250)     /* 2px focus ring, 2px offset */
--primary:       oklch(0.2 0.012 265)     /* ink */
/* Shell tokens (--shell, --shell-ink, --shell-muted...) map to the frame. */
```

### Concept roles

Each concept has five tokens: `--c-X` (the color, for dots and icons),
`--c-X-on` (text on a solid fill), `--c-X-tint` (faint surface), `--c-X-ink`
(colored text on light surfaces), `--c-X-line` (borders). Classes expose them
as `--k*` (see `app/concepts.css`).

| Concept | Token | Hue (light) | Shape |
|---|---|---|---|
| Incidente (INC) | `--c-inc` | blue `0.56 0.17 255` | bolt icon + mono number, faint tint chip |
| Problema (PRB) | `--c-prb` | amber `0.74 0.15 68` | converging-lines icon, dashed chip when cited |
| Mudança (CHG) | `--c-chg` | teal `0.6 0.11 178` | branch icon |
| Caso parecido | `--c-inc` | blue, hollow | ghost chip, dashed border |
| Etapa da IA | `--c-ai` | violet `0.54 0.21 290` | dashed violet circle on the violet fio |
| Resposta da IA | `--c-ai` | violet tint | tinted block, violet border, star icon |
| Decisão de uma pessoa | `--c-human` | ink | ink circle with person icon |
| Nota | `--score-*` | green 152 / amber 62 / red 27 | big tabular number + subtle band badge |
| Portão | `--gate-*` | diamond, green or red verdict | diamond + sim/não badge |

Badges are "subtle": faint tint, dark colored text, pill 20 to 24px. Solid
color only where it is the one thing that matters on the screen. Color is never
alone: every concept has its icon and shape, every score its band word.

## Typography

- **Inter** (variable, `next/font`) for all UI text, with `cv05` and `cv11`;
  **JetBrains Mono** only for record numbers and technical values, in muted or
  concept ink, never in a colored block.
- Weights 400 / 500 / 600. Headings 600 with negative tracking (about -0.02em).
- Scale (`--fs-*`): 13 / 14 / 16 / 18 / 21 / 30 / 40, plus 48 and 64 for scores.
- Body 16px, line height 1.5; ledes 18px; prose capped at 60 to 64ch.

## Layout

App shell: light top bar and sidebar on the frame color; labelled sidebar from
921px, icon rail 768 to 920, bottom tab bar below 768. Desktop content sits on
the frame with 32px padding (48px from 1280). Phone gutter 16px. Touch screens
get 44px targets (buttons, selects, tabs; small pills get an invisible 44px
hit area). Labels never end in "...": shorten the word or let it wrap; names
like PIX-Core stay whole (`keepWhole` in `lib/text.ts`).
`--page-max` 1360px; `/aula` up to 1480px.

Copy rule: **one short headline per block, at most one short sentence, then
visuals, numbers or lists.** Everything technical (top-K, cosine, post-filter,
dimensions, model names, raw fields) lives behind "Ver detalhes técnicos"
(`.tech`). Long record text (Change fields) folds to five lines on a phone with
"Ler tudo". Copy is PT-BR, no em dashes, only the fictional Banco Meridiano.

Chips grow with their text and never wrap onto a second line (`white-space:
nowrap`, `min-width: max-content`); a row of chips wraps as a row.

## Components

Shared concept components in `components/concepts.tsx`:

- **RecordTag** (`.rtag`): icon + mono number for INC/PRB/CHG; `ghost` for a
  similar case; sizes `sm`, default, `lg`.
- **ConceptIcon** (`.cicon`), **ConceptLabel** (`.clabel`): icon and inline
  label per concept.
- **ScoreNumber** (`.score`): big number, optional max, band badge.
- **GateMark** (`.gatemark`): diamond, rule, sim/não badge.
- **TechDetails** (`.tech`): the "Ver detalhes técnicos" disclosure.
- **ConceptLegend** (`.legend`): the legend on `/aula`.

Buttons: 38px, weight 500, radius 8px. `.btn-primary` is ink (human action),
`.btn-ai` is violet (asks the machine), `.btn-outline` and `.btn-ghost` for the
rest. Every state is covered: default, hover, focus-visible, active, disabled,
loading. Cards: white, 1px border, radius 10 to 12px, no shadow unless they
float.

## Motion

Token based (`app/globals.css`):

- Durations `--dur-press` 100ms, `--dur-state` 200ms, `--dur-move` 320ms,
  `--dur-explain` 560ms, `--dur-count` 600ms.
- Curves `--ease-out`, `--ease-in-out`, `--ease-exit`, `--spring-calm` and
  `--spring-land` (cubic-bezier curves that never pass the target; the names
  are kept from the earlier `linear()` springs).
- Entrances: opacity plus a small rise. The "wow" is kept to the fio drawing
  itself and the numbers that count.
- `--motion-scale` is 1, and 1.6 in modo aula (`[data-aula]`).
- `prefers-reduced-motion: reduce` shortens moves and removes counts and drawing.

## Accessibility

WCAG 2.2 AA. Body text at 4.5:1 or more in light and dark. 2px focus ring with
offset on every interactive element. Concepts never rely on color alone.
Citation chips get an invisible taller hit area on touch. No horizontal scroll
from 360px up.
