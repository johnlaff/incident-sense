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
  rel: string;
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
    rel: relTime(s.opened_at),
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

function synthActivity(d: IncidentDetail): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      kind: "open",
      who: OBSERVER,
      when: relTime(d.opened_at),
      text: "Incidente aberto a partir de monitoração ou contato de cliente.",
    },
  ];
  if (d.work_notes) {
    items.push({
      kind: "note",
      who: ANALYST,
      when: relTime(d.opened_at),
      text: d.work_notes,
    });
  }
  if (d.resolved_at && d.resolution_notes) {
    items.push({
      kind: "resolve",
      who: ANALYST,
      when: relTime(d.resolved_at),
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
  impact: string;
  urgency: string;
  resolutionNotes: string | null;
  closeCode: string | null;
  workNotes: string | null;
  resolvedAt: string | null;
  clusterId: number | null;
  clusterLabel: string | null;
  isOutlier: boolean | null;
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
    rel: relTime(d.opened_at),
    isResolved: state === "resolved",
    category: d.category,
    tags: d.tags,
    title: d.short_description,
    description: d.description,
    subcategory: d.subcategory,
    impact: impactLabel(d.impact),
    urgency: urgencyLabel(d.urgency),
    resolutionNotes: d.resolution_notes,
    closeCode: d.close_code,
    workNotes: d.work_notes,
    resolvedAt: d.resolved_at,
    clusterId: d.cluster_id,
    clusterLabel: d.cluster_label,
    isOutlier: d.is_outlier,
    activity: synthActivity(d),
  };
}

// ----- Cluster colors --------------------------------------------------------

// Categorical hues (not status) — one per cluster id, cycled. Outliers are grey.
const CLUSTER_HUES = [285, 230, 195, 160, 330, 20, 110, 60, 255, 95, 45, 300, 175, 15];

export function clusterColor(clusterId: number, isOutlier = false): string {
  if (isOutlier || clusterId < 0) return "oklch(0.62 0.012 285)";
  return `oklch(0.62 0.13 ${CLUSTER_HUES[clusterId % CLUSTER_HUES.length]})`;
}

// ----- Copilot result (maps SuggestResponse → Aurora's chat output) ----------

export type SuggestionSegment = { text: string } | { cite: string };

/** Split a suggestion string into text + clickable [INC…] citation segments. */
export function parseSuggestion(text: string, referenced: string[]): SuggestionSegment[] {
  const segments: SuggestionSegment[] = [];
  const re = /\[?(INC\d{4,})\]?/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ cite: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });

  // No inline citations but we have grounding incidents → append them as sources.
  const hasCite = segments.some((s) => "cite" in s);
  if (!hasCite && referenced.length > 0) {
    segments.push({ text: " Fundamentado em " });
    referenced.forEach((id, i) => {
      segments.push({ cite: id });
      if (i < referenced.length - 1) {
        segments.push({ text: i === referenced.length - 2 ? " e " : ", " });
      }
    });
    segments.push({ text: "." });
  }
  return segments;
}

/** Flatten suggestion segments back to plain text (with [INC…]) for copy/insert. */
export function segmentsToPlain(segments: SuggestionSegment[]): string {
  return segments.map((s) => ("cite" in s ? `[${s.cite}]` : s.text)).join("");
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
  suggestion: SuggestionSegment[] | null;
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
      ? parseSuggestion(res.suggestion, res.referenced_incidents)
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
