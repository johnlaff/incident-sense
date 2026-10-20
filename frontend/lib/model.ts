// View model — maps the backend API shapes onto the vocabulary the
// ServiceNow-faithful Design System screens speak (open/progress/hold/resolved,
// p1–p4, relative time, a synthesized activity stream, copilot results with
// clickable citations). Keeping this in one place means the screens never touch
// raw field names like cmdb_ci or assignment_group.

import type {
  Classification,
  IncidentDetail,
  IncidentSummary,
  SuggestResponse,
  WorkNote,
} from "./types";

// ----- State -----------------------------------------------------------------

export type DsState = "open" | "progress" | "hold" | "resolved";

export const STATE_LABEL: Record<DsState, string> = {
  open: "Aberto",
  progress: "Em andamento",
  hold: "Em espera",
  resolved: "Resolvido",
};

export const STATE_CLASS: Record<DsState, string> = {
  open: "s-open",
  progress: "s-progress",
  hold: "s-hold",
  resolved: "s-resolved",
};

/** Map a backend state string to the Design System's four-state vocabulary. */
export function dsState(state: string): DsState {
  switch (state) {
    case "New":
      return "open";
    case "In Progress":
      return "progress";
    case "On Hold":
      return "hold";
    case "Resolved":
    case "Closed":
      return "resolved";
    default:
      return "open";
  }
}

// ----- Priority / impact / urgency -------------------------------------------

export type PCode = "p1" | "p2" | "p3" | "p4";

export const PRIORITY_LABEL: Record<PCode, string> = {
  p1: "Crítica",
  p2: "Alta",
  p3: "Moderada",
  p4: "Baixa",
};

export function pCode(priority: number): PCode {
  const n = Math.min(4, Math.max(1, Math.round(priority)));
  return `p${n}` as PCode;
}

const IMPACT_LABEL: Record<number, string> = { 1: "Alto", 2: "Médio", 3: "Baixo" };
const URGENCY_LABEL: Record<number, string> = { 1: "Alta", 2: "Média", 3: "Baixa" };

export function impactLabel(n: number): string {
  return IMPACT_LABEL[n] ?? String(n);
}
export function urgencyLabel(n: number): string {
  return URGENCY_LABEL[n] ?? String(n);
}

// ----- Time ------------------------------------------------------------------

/** "há 12min" / "há 3h" / "há 5 dias" / "há 2 meses" from an ISO timestamp. */
export function relTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `há ${mins}min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  const mo = Math.round(d / 30);
  return `há ${mo} ${mo === 1 ? "mês" : "meses"}`;
}

/**
 * "17 de mar." (or "17 de mar., 20:40" with the time). The demo data is a
 * fixed snapshot, so its timestamps read as dates: "há 7 meses" would only
 * say how old the snapshot is.
 */
export function dayDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function absDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ----- List row --------------------------------------------------------------

export interface IncidentRow {
  number: string;
  short: string;
  service: string;
  group: string;
  state: DsState;
  priority: PCode;
  openedAt: string;
  /** When it was opened, as a short date: "17 de mar." */
  opened: string;
  isResolved: boolean;
  category: string;
  tags: string[];
}

export function mapSummary(s: IncidentSummary): IncidentRow {
  return {
    number: s.number,
    short: s.short_description,
    service: s.cmdb_ci,
    group: s.assignment_group,
    state: dsState(s.state),
    priority: pCode(s.priority),
    openedAt: s.opened_at,
    opened: dayDate(s.opened_at),
    isResolved: s.is_resolved,
    category: s.category,
    tags: s.tags,
  };
}

// ----- Activity stream (synthesized from the record's timestamps) ------------

export type ActivityKind = "open" | "note" | "state" | "resolve";

export interface Actor {
  name: string;
  initials: string;
  ai?: boolean;
}

export interface ActivityItem {
  kind: ActivityKind;
  who: Actor;
  when: string;
  text: string;
}

const OBSERVER: Actor = { name: "Monitoração", initials: "OBS" };
const ANALYST: Actor = { name: "Analista", initials: "AN" };
export const AURORA: Actor = { name: "Assistente da IA", initials: "IA", ai: true };

/** A work note the platform published (the AI suggestion), as an activity item. */
export function noteActivity(note: WorkNote): ActivityItem {
  return {
    kind: "note",
    who: AURORA,
    when: relTime(note.created_at),
    text: `Sugestão publicada nas notas de trabalho. ${markdownToPlain(note.text)}`,
  };
}

function synthActivity(d: IncidentDetail): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      kind: "open",
      who: OBSERVER,
      when: dayDate(d.opened_at, true),
      text: "Incidente aberto a partir de monitoração ou contato de cliente.",
    },
  ];
  if (d.work_notes) {
    items.push({
      kind: "note",
      who: ANALYST,
      when: dayDate(d.opened_at, true),
      text: d.work_notes,
    });
  }
  (d.published_notes ?? []).forEach((note) => items.push(noteActivity(note)));
  if (d.resolved_at && d.resolution_notes) {
    items.push({
      kind: "resolve",
      who: ANALYST,
      when: dayDate(d.resolved_at, true),
      text: d.resolution_notes,
    });
  }
  return items;
}

// ----- Full record -----------------------------------------------------------

export interface IncidentRecord extends IncidentRow {
  title: string;
  description: string;
  subcategory: string;
  empresa: string;
  impact: string;
  urgency: string;
  resolutionNotes: string | null;
  closeCode: string | null;
  workNotes: string | null;
  resolvedAt: string | null;
  clusterId: number | null;
  clusterLabel: string | null;
  isOutlier: boolean | null;
  publishedNotes: WorkNote[];
  activity: ActivityItem[];
}

export function mapDetail(d: IncidentDetail): IncidentRecord {
  const state = dsState(d.state);
  return {
    number: d.number,
    short: d.short_description,
    service: d.cmdb_ci,
    group: d.assignment_group,
    state,
    priority: pCode(d.priority),
    openedAt: d.opened_at,
    opened: dayDate(d.opened_at, true),
    isResolved: state === "resolved",
    category: d.category,
    tags: d.tags,
    title: d.short_description,
    description: d.description,
    subcategory: d.subcategory,
    empresa: d.empresa ?? "Banco Meridiano",
    impact: impactLabel(d.impact),
    urgency: urgencyLabel(d.urgency),
    resolutionNotes: d.resolution_notes,
    closeCode: d.close_code,
    workNotes: d.work_notes,
    resolvedAt: d.resolved_at,
    clusterId: d.cluster_id,
    clusterLabel: d.cluster_label,
    isOutlier: d.is_outlier,
    publishedNotes: d.published_notes ?? [],
    activity: synthActivity(d),
  };
}

// ----- Cluster colors --------------------------------------------------------

// Categorical colors (not status), one per cluster id, in this fixed order.
// Nine tones for the nine groups, told apart by hue and lightness: no purple
// near the AI violet (no hue between 262 and 335), every hue 26 degrees or more
// from the concept hues (Incidente 255, Problema 68, Change 178), so a group
// never reads as a record type, and every dot at 3:1 or more against the
// card and the group tint in both themes. l/c is the light theme, dl/dc the
// dark one. Outliers are grey.
export interface ClusterTone {
  h: number;
  l: number;
  c: number;
  dl: number;
  dc: number;
}

export const CLUSTER_TONES: readonly ClusterTone[] = [
  { h: 350, l: 0.66, c: 0.21, dl: 0.61, dc: 0.2 }, // pink
  { h: 145, l: 0.36, c: 0.1, dl: 0.61, dc: 0.19 }, // deep green
  { h: 100, l: 0.6, c: 0.12, dl: 0.67, dc: 0.11 }, // olive
  { h: 25, l: 0.58, c: 0.21, dl: 0.73, dc: 0.16 }, // red
  { h: 220, l: 0.48, c: 0.07, dl: 0.57, dc: 0.09 }, // slate
  { h: 140, l: 0.5, c: 0.16, dl: 0.87, dc: 0.11 }, // green / pale green
  { h: 350, l: 0.56, c: 0.08, dl: 0.83, dc: 0.08 }, // dusty rose
  { h: 340, l: 0.46, c: 0.19, dl: 0.75, dc: 0.2 }, // magenta
  { h: 40, l: 0.36, c: 0.1, dl: 0.59, dc: 0.16 }, // brown
];

export const CLUSTER_HUES = CLUSTER_TONES.map((t) => t.h);

export function clusterTone(clusterId: number): ClusterTone {
  const n = CLUSTER_TONES.length;
  return CLUSTER_TONES[((clusterId % n) + n) % n];
}

export function clusterColor(clusterId: number, isOutlier = false): string {
  if (isOutlier || clusterId < 0) return "oklch(0.62 0.012 285)";
  const t = clusterTone(clusterId);
  return `oklch(${t.l} ${t.c} ${t.h})`;
}

// ----- Copilot result (maps SuggestResponse → Aurora's chat output) ----------

const INLINE_CITE = /\b(?:INC|PRB)\d{4,}\b/;

// A line that opens a new step: an ordered marker (1. / 1)), a bullet (- / *)
// or a bold lead-in (**Ação**) the model uses for each action.
const STEP_LINE = /^\s*(?:\d+[.)]\s|[-*]\s|\*\*)/;

/** Put a blank line before each step so markdown renders a legible, "loose"
 * list instead of one cramped paragraph.
 *
 * Models sometimes separate the diagnosis and the action items with single
 * newlines; CommonMark then collapses them into a single block. Promoting those
 * boundaries to blank lines makes each step its own paragraph / list item —
 * independent of how disciplined the model was about spacing.
 */
export function normalizeSuggestionSpacing(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (STEP_LINE.test(line) && prev !== undefined && prev.trim() !== "") {
      out.push("");
    }
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A line whose content starts with a bold lead-in (**Ação** …) — how the model
// writes an action when it forgets to number the list.
const BOLD_LEAD = /^\*\*.+?\*\*/;

/** Number the action steps when the model wrote them as bold paragraphs.
 *
 * The suggestion is far more readable as an ordered list, but the model is not
 * perfectly consistent about emitting "1." / "2." markers. When it already did,
 * we leave it alone; otherwise we promote each bold-led action line to a
 * numbered item, giving the same clean, scannable layout every time.
 */
export function enforceNumberedSteps(md: string): string {
  const lines = md.split("\n");
  if (lines.some((l) => /^\s*\d+[.)]\s/.test(l))) return md; // already numbered
  // The first non-empty line is the diagnosis sentence — never an action, even
  // if the model bolded it. Only bold-led lines *after* it are numbered.
  const firstContent = lines.findIndex((l) => l.trim() !== "");
  const isAction = (l: string, i: number): boolean =>
    i > firstContent && BOLD_LEAD.test(l.trim());
  if (lines.filter(isAction).length < 2) return md; // not a multi-step list
  let n = 0;
  return lines.map((l, i) => (isAction(l, i) ? `${++n}. ${l.trim()}` : l)).join("\n");
}

/** Prepare the suggestion markdown for rendering.
 *
 * The backend already returns simple markdown with bracketed [INC…] citations.
 * We normalize the spacing and numbering for legibility, and — when it grounded
 * the answer but cited nothing inline — append the referenced incidents as a
 * closing "Fundamentado em …" line so the sources stay visible and clickable.
 */
export function buildSuggestionMarkdown(text: string, referenced: string[]): string {
  const body = enforceNumberedSteps(normalizeSuggestionSpacing(text.trim()));
  if (INLINE_CITE.test(body) || referenced.length === 0) return body;
  const cites = referenced.map((id) => `[${id}]`);
  const joined =
    cites.length === 1
      ? cites[0]
      : `${cites.slice(0, -1).join(", ")} e ${cites[cites.length - 1]}`;
  return `${body}\n\nFundamentado em ${joined}.`;
}

/** Strip light markdown to plain text for the "insert / copy" resolution notes. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface CopilotCandidate {
  id: string;
  desc: string;
  sim: number;
  keep: boolean;
  reason: string | null;
  resolution: string | null;
}

export interface CopilotResult {
  verdict: Classification;
  summary: string;
  neighbors: number;
  candidates: CopilotCandidate[];
  /** Suggestion as simple markdown (bold, lists, [INC…] citations), or null. */
  suggestion: string | null;
  referenced: string[];
  noBase: boolean;
}

export function mapSuggest(res: SuggestResponse): CopilotResult {
  const candidates: CopilotCandidate[] = res.candidates.map((c) => ({
    id: c.number,
    desc: c.short_description,
    sim: c.similarity,
    keep: c.survived_postfilter,
    reason: c.postfilter_reason ?? null,
    resolution: c.resolution_notes ?? null,
  }));
  const procedente = res.classification === "PROCEDENTE";
  const suggestion =
    procedente && res.suggestion
      ? buildSuggestionMarkdown(res.suggestion, [
          ...res.referenced_incidents,
          ...(res.referenced_problems ?? []),
        ])
      : null;
  return {
    verdict: res.classification,
    summary: `“${res.summarized_query}”`,
    neighbors: candidates.length,
    candidates,
    suggestion,
    referenced: res.referenced_incidents,
    // "No base yet" only when there is genuinely no usable suggestion — a parsed
    // suggestion (even one whose citations are inline) should never be dropped.
    noBase: procedente && suggestion === null,
  };
}
