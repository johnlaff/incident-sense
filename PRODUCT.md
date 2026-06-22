# Product

## Register

product

## Users

Two audiences, one interface:

- **Workshop attendees** (IFTM, Uberlândia) ranging from first-semester students
  to working professionals, watching a live demo projected on a screen and later
  exploring the repo themselves.
- **Technical recruiters and senior engineers** evaluating this as a portfolio
  piece.

Both step into the role of a **bank IT-operations analyst** ("sustentação") at
the fictional **Banco Meridiano**, triaging incidents: browsing open and
resolved tickets, opening a record, and asking an AI copilot for a resolution.

## Product Purpose

A clean-room **simulation of a bank's ITSM** (ServiceNow-like) where the analyst
browses the full incident repertoire, opens a ticket, and asks an embedded AI
copilot for a **grounded resolution suggestion** (RAG). The defining feature is
**traceability**: every past incident the AI cites is openable and inspectable,
so the user can verify for themselves that the cited incidents are genuinely
similar and that the suggestion was actually based on their resolutions. A second
view treats recurring clusters as **recurring problems** (ITIL Problem
Management).

Success = the audience *understands* RAG (retrieve → ground → post-filter →
classify → suggest) because they **used a believable tool** and could **verify
the sources** — not because they were told to trust a black box.

## Brand Personality

Credible and didactic. Operations-grade and precise, but it explains itself
without dumbing down. Three words: **trustworthy, legible, traceable**. The voice
is calm and exact — the tone of a senior analyst walking a junior through a
ticket.

## Anti-references

- The current build: a generic neon-on-near-black "AI dashboard" (scatter map +
  side panel) — the exact "AI slop" look to escape.
- Opaque AI copilots that assert a fix and say "trust me" with no inspectable
  sources.
- Flashy data-viz that hides the actual workflow behind spectacle.
- Generic SaaS-cream and generic-SaaS-blue defaults.

## Design Principles

1. **Show your work.** Every AI claim links to an openable source record;
   transparency *is* the product, not a footnote.
2. **A believable tool, not a toy.** It must read like an ITSM an analyst
   actually uses all day, not a demo widget.
3. **Legible from the back row.** High contrast and generous, calm typography so
   it survives a projector and a beginner's first look.
4. **The workflow leads; the cleverness follows.** Incident triage is the
   primary surface; the ML is revealed in context, never as the headline.
5. **Didactic by default.** The under-the-hood pipeline is visible and animated,
   teaching the concept while the user works.

## Accessibility & Inclusion

WCAG 2.2 AA: body text ≥ 4.5:1, large/bold ≥ 3:1, including placeholders. Tuned
for projection (high contrast, large legible type). Status is never encoded by
color alone — always icon + label (colorblind-safe). Full keyboard navigation.
Every animation has a `prefers-reduced-motion` alternative (crossfade or instant).
