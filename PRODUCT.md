# Product

## Register

product

## Users

Two audiences, one interface:

- **Talk attendees** ("Depois do Deploy", TechWeek UFU, Uberlândia,
  2026-10-22) ranging from first-semester students to working professionals,
  watching a live demo projected on a screen, opening the site on their phones
  during the talk (lesson mode, `?aula=1`) and later exploring the repo
  themselves.
- **Technical recruiters and senior engineers** evaluating this as a portfolio
  piece.

Both step into the role of a **bank IT-operations analyst** ("sustentação") at
the fictional **Banco Meridiano**: grading a Change request before the deploy,
then triaging incidents after it (browsing open and resolved tickets, opening a
record, asking the AI assistant for a resolution and following up with
questions).

## Product Purpose

A clean-room **simulation of a bank's ITSM** (ServiceNow-like) that follows two
articles end to end:

- **Before the deploy** (Solange's article): an LLM judge grades each field of
  a Change against a versioned rubric, and only above 8.0 checks whether the
  parts tell the same story. The backend returns one verdict; a person approves.
- **After the deploy** (João's article): the analyst opens an incident and the
  embedded AI assistant runs a seven-step pipeline to a **grounded resolution
  suggestion** (RAG), published as a work note; follow-up questions are answered
  from the kept cases only.
- **The loop closes**: recurring groups of incidents become **Problems** (ITIL
  Problem Management), and the fix comes back as a Change.

The defining feature is **traceability**: every past incident or Problem the AI
cites is openable and inspectable, so the user can verify that the cited cases
are genuinely similar and that the suggestion was actually based on them.

Success = the audience *understands* RAG (retrieve, ground, post-filter,
classify, suggest) and the LLM-as-judge gates because they **used a believable
tool** and could **verify the sources**, not because they were told to trust a
black box.

## Brand Personality

Credible and didactic. Operations-grade and precise, but it explains itself
without dumbing down. Three words: **trustworthy, legible, traceable**. The voice
is calm and exact: the tone of a senior analyst walking a junior through a
ticket. UI copy is plain PT-BR; jargon sits behind "Ver detalhes técnicos".

## Anti-references

- The first build: a generic neon-on-near-black "AI dashboard" (scatter map +
  side panel), the exact "AI slop" look to escape.
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
color alone: always icon + label (colorblind-safe). Full keyboard navigation.
Every animation has a `prefers-reduced-motion` alternative (crossfade or instant).
