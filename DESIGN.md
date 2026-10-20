# Design

The visual system for incident-sense: a teaching workspace for a fictional bank
(Banco Meridiano) that shows, step by step, where an AI helps after a deploy and
where a person decides. All colors in OKLCH.

## Direction: "Pulseira de triagem"

The world comes from the Manchester triage wristband used in Brazilian
emergency rooms: every patient gets one solid color band, and anyone in the room
reads it at a glance. Here every record and every idea of the lesson gets one
color, one icon and one shape, always the same, on every screen. A student on a
phone and a room watching a projector must be able to tell an Incident from a
Problem, a machine step from a human decision, without reading a word.

Mode: **Operate** (an app the visitor uses to follow a task), with the lesson
start page (`/aula`) as its one guided surface. Ambition shows as strong
hierarchy, big numbers and a consistent concept language, not decoration.

Two rules carry the whole system:

1. **Violet is only for the machine.** AI steps, AI answers and the button that
   asks the AI. Nothing else uses violet.
2. **Ink is for the person.** Primary human actions (Resolver, Abrir, Ver) and
   the "Agora é com você" decision use deep ink, never a brand hue.

## Theme

Light content on a **deep ink frame**: the top bar, rail and phone tab bar are
`--shell` (navy ink), the workspace is a cool off-white. The dark frame gives the
app a recognizable silhouette on a projector and lets the concept chips in the
rail read as colored bands. Dark mode is fully supported (`[data-theme="dark"]`):
the frame goes deeper, surfaces become navy grays, concept colors get lighter at
similar chroma.

## Color

```
/* Surfaces and ink (light) */
--bg:            oklch(0.975 0.006 265)
--surface:       oklch(1 0 0)
--surface-2:     oklch(0.962 0.008 265)
--border:        oklch(0.905 0.009 265)
--border-strong: oklch(0.8 0.014 265)
--ink:           oklch(0.22 0.035 265)   /* headings, human actions */
--ink-body:      oklch(0.3 0.025 265)
--muted:         oklch(0.47 0.02 265)
--focus:         oklch(0.5 0.15 255)     /* 3px focus ring */

/* Frame */
--shell:       oklch(0.22 0.035 265)
--shell-2:     oklch(0.28 0.035 265)
--shell-ink:   oklch(0.97 0.005 265)
--shell-muted: oklch(0.76 0.02 265)
```

### Concept roles

Each concept has five tokens: `--c-X` (solid band), `--c-X-on` (text on the
band), `--c-X-tint` (soft surface), `--c-X-ink` (text on light surfaces),
`--c-X-line` (borders). Classes expose them as `--k*` (see `app/concepts.css`).

| Concept | Token | Hue (light) | Shape |
|---|---|---|---|
| Incidente (INC) | `--c-inc` | blue `0.5 0.15 255` | solid band with a snap dot, bolt icon |
| Problema (PRB) | `--c-prb` | gold `0.82 0.14 82`, dark text | solid band, converging-lines icon |
| Mudança (CHG) | `--c-chg` | teal `0.5 0.1 185` | solid band, branch icon |
| Caso parecido | `--c-inc` | blue, hollow | dashed hollow band |
| Etapa da IA | `--c-ai` | violet `0.5 0.19 295` | dashed violet circle, gear icon |
| Resposta da IA | `--c-ai` | violet tint | tinted block with a violet border, star icon |
| Decisão de uma pessoa | `--c-human` | ink | solid ink pill, person icon |
| Nota | `--score-*` | green / amber / red | big number plus band word |
| Portão | `--gate-*` | ink diamond, green or red verdict | diamond plus sim/não pill |

Scores: `--score-high` green 150, `--score-mid` amber 70, `--score-low` red 27,
each with a `-tint`. Status and priority badges keep their own tokens and stay
small, so they never compete with the bands. Color is never alone: every concept
also has its icon and shape, every score its band word.

## Typography

- **Atkinson Hyperlegible Next** (variable, via `next/font/google`) for all UI
  text, and **Atkinson Hyperlegible Mono** for record numbers and technical
  values. Chosen for the room: its 0/O, 1/l/I and rn/m are unambiguous on a
  projector at the back of a hall and on a cheap phone screen, which matters for
  numbers like INC0052233. Big scores use the sans (the mono comma is too wide).
- Fixed rem scale: 13 / 14 / 16 / 18 / 22 / 28 / 36, plus 48 for scores and 64
  for the one big number on a screen (`--fs-xs` to `--fs-score-xl`).
- Body 16px; ledes 18px; page titles 28px; headings weight 700.
- Prose capped at 60 to 64ch.

## Layout

App shell: ink top bar, ink rail (labelled from 921px, icon rail 768 to 920),
ink bottom tab bar below 768px. The rail starts with a "Roteiro da aula" link to
`/aula`. Each nav item carries its concept chip.

Screens sit in a centred container (`--page-max: 1360px`); `/aula` goes up to
1480px. Breakpoints: tab bar below 768, icon rail 768 to 920, labelled rail from
921, side-by-side panels from 1101, four-across lesson route from 1100.

Each step of a pipeline gets a short plain PT-BR headline and one line of
explanation. Technical detail (top-K, cosine, post-filter, dimensions, model
names, raw fields) lives behind a "Ver detalhes técnicos" disclosure (`.tech`).

Surfaces are flat: no decorative gradients, glows, side-stripe or top-accent
borders on rounded cards. Copy is PT-BR, plain, no em dashes, only the fictional
Banco Meridiano.

## Components

Shared concept components live in `components/concepts.tsx`:

- **RecordTag** (`.rtag`): the wristband for INC/PRB/CHG; `ghost` for a similar
  case; sizes `sm`, default, `lg`.
- **ConceptIcon** (`.cicon`), **ConceptLabel** (`.clabel`): icon chip and inline
  label per concept.
- **ScoreNumber** (`.score`): big number, optional max, band word.
- **GateMark** (`.gatemark`): diamond, rule, sim/não verdict.
- **TechDetails** (`.tech`): the "Ver detalhes técnicos" disclosure.
- **ConceptLegend** (`.legend`): the one legend, on `/aula`; Como funciona can reuse it.

Buttons: 40px, weight 700. `.btn-primary` is ink (human action), `.btn-ai` is
violet (asks the machine). Every interactive state is covered:
default, hover, focus-visible, active, disabled, loading.

## Motion

The motion system is unchanged and token based (`app/globals.css`):

- Durations `--dur-press` 100ms, `--dur-state` 200ms, `--dur-move` 320ms,
  `--dur-explain` 560ms, `--dur-count` 600ms.
- Curves `--ease-out`, `--ease-in-out`, `--ease-exit`, and the spring curves
  `--spring-calm` and `--spring-land` (CSS `linear()`).
- `--motion-scale` is 1, and 1.6 in modo aula (`[data-aula]`), so the lesson
  plays slower with captions.
- `prefers-reduced-motion: reduce` shortens moves to 160ms and removes counts
  and drawing animations.

New in this world: the `/aula` route line draws itself and the four stops
arrive in a short stagger; both are off under reduced motion.

## Accessibility

WCAG 2.2 AA. Body text at 4.5:1 or more in light and dark (checked per token).
3px focus ring on every interactive element. Concepts never rely on color alone.
Main phone actions (lesson CTAs, tab bar) are full width or 48px tall. No horizontal scroll from 360px up.
