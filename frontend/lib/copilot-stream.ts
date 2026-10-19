// Copilot SSE protocol v1 — types and runtime validator.
// Mirrors the shared contract at contracts/copilot-stream/README.md; keep the
// two in sync (the pytest suite reads the same fixtures on the backend side).

export type CopilotLocale = "pt-BR" | "en";
export type CopilotPhase =
  "policy" | "classify" | "rewrite" | "retrieve" | "answer" | "validate";
export type CopilotPhaseStatus = "started" | "completed";
export type CopilotVerdict = "PROCEDENTE" | "IMPROCEDENTE";
export type CopilotAnswerKind =
  "general_explanation" | "grounded_answer" | "no_evidence" | "refusal";
export type CopilotGrounding = "cited" | "no_historical_evidence" | "not_required";

export interface CopilotRetrievalCandidate {
  number: string;
  short_description: string;
  similarity: number;
  survived_postfilter: boolean;
  postfilter_reason: string | null;
}

export interface CopilotIncidentClassification {
  verdict: CopilotVerdict;
  justification: string;
}

interface CopilotAnswerBlockBase {
  text: string;
  citations: string[];
}

export interface CopilotExplanationBlock extends CopilotAnswerBlockBase {
  type: "explanation";
}

export interface CopilotDiagnosisBlock extends CopilotAnswerBlockBase {
  type: "diagnosis";
}

export interface CopilotActionBlock extends CopilotAnswerBlockBase {
  type: "action";
}

export interface CopilotCaveatBlock extends CopilotAnswerBlockBase {
  type: "caveat";
}

export interface CopilotQuestionBlock extends CopilotAnswerBlockBase {
  type: "question";
}

export type CopilotAnswerBlock =
  | CopilotExplanationBlock
  | CopilotDiagnosisBlock
  | CopilotActionBlock
  | CopilotCaveatBlock
  | CopilotQuestionBlock;

export interface CopilotAnswer {
  kind: CopilotAnswerKind;
  locale: CopilotLocale;
  incident_classification: CopilotIncidentClassification;
  grounding: CopilotGrounding;
  blocks: CopilotAnswerBlock[];
}

export interface CopilotTelemetryEntry {
  call: string;
  model: string | null;
  provider: string | null;
  generation_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

interface CopilotEnvelope {
  protocol_version: "1";
  turn_id: string;
  sequence: number;
}

export interface TurnAcceptedEvent extends CopilotEnvelope {
  type: "turn.accepted";
  incident_number: string;
  locale: CopilotLocale;
  model_requested: string;
}

export interface PhaseChangedEvent extends CopilotEnvelope {
  type: "phase.changed";
  phase: CopilotPhase;
  status: CopilotPhaseStatus;
  duration_ms: number | null;
}

export interface RetrievalCompletedEvent extends CopilotEnvelope {
  type: "retrieval.completed";
  query: string;
  candidates: CopilotRetrievalCandidate[];
}

export interface AnswerCompletedEvent extends CopilotEnvelope {
  type: "answer.completed";
  answer: CopilotAnswer;
  sources: string[];
  telemetry: CopilotTelemetryEntry[];
}

export interface TurnFailedEvent extends CopilotEnvelope {
  type: "turn.failed";
  code: string;
  message: string;
  retryable: boolean;
  retry_after_ms: number | null;
}

export interface TurnCancelledEvent extends CopilotEnvelope {
  type: "turn.cancelled";
  reason: string;
}

export type CopilotStreamEvent =
  | TurnAcceptedEvent
  | PhaseChangedEvent
  | RetrievalCompletedEvent
  | AnswerCompletedEvent
  | TurnFailedEvent
  | TurnCancelledEvent;

const TERMINAL_TYPES: ReadonlySet<CopilotStreamEvent["type"]> = new Set([
  "answer.completed",
  "turn.failed",
  "turn.cancelled",
]);

export type StreamErrorCode =
  | "unknown_protocol_version"
  | "unknown_event_type"
  | "invalid_event"
  | "out_of_order_sequence"
  | "duplicate_sequence"
  | "missing_terminal"
  | "event_after_terminal";

export class StreamContractError extends Error {
  readonly code: StreamErrorCode;

  constructor(code: StreamErrorCode, message: string) {
    super(message);
    this.name = "StreamContractError";
    this.code = code;
  }
}

/**
 * Reassembles raw SSE chunks (which may split mid-line or carry several
 * events per chunk) and returns the `data:` payload of each event, in order.
 * `event:`/`id:` lines are diagnostic only and are ignored here.
 */
export function decodeSseStream(chunks: string[]): string[] {
  const buffer = chunks.join("");
  const rawEvents = buffer.split("\n\n").filter((block) => block.trim().length > 0);

  return rawEvents.map((block) => {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    return dataLines.join("\n");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The contract says absent optional fields read as null ("campos ausentes
// ficam nulos") — normalize before validating so both readers agree.
function absentToNull(value: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (value[key] === undefined) value[key] = null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

const LOCALES: readonly CopilotLocale[] = ["pt-BR", "en"];
const PHASES: readonly CopilotPhase[] = [
  "policy",
  "classify",
  "rewrite",
  "retrieve",
  "answer",
  "validate",
];
const PHASE_STATUSES: readonly CopilotPhaseStatus[] = ["started", "completed"];
const VERDICTS: readonly CopilotVerdict[] = ["PROCEDENTE", "IMPROCEDENTE"];
const ANSWER_KINDS: readonly CopilotAnswerKind[] = [
  "general_explanation",
  "grounded_answer",
  "no_evidence",
  "refusal",
];
const GROUNDINGS: readonly CopilotGrounding[] = [
  "cited",
  "no_historical_evidence",
  "not_required",
];
const BLOCK_TYPES: readonly CopilotAnswerBlock["type"][] = [
  "explanation",
  "diagnosis",
  "action",
  "caveat",
  "question",
];
const BLOCK_TYPES_REQUIRING_CITATION: ReadonlySet<CopilotAnswerBlock["type"]> = new Set([
  "diagnosis",
  "action",
]);

function isCopilotAnswerBlock(value: unknown): value is CopilotAnswerBlock {
  if (!isRecord(value)) return false;
  if (
    !isString(value.type) ||
    !BLOCK_TYPES.includes(value.type as CopilotAnswerBlock["type"])
  ) {
    return false;
  }
  if (value.citations === undefined) value.citations = [];
  if (!isString(value.text) || !isStringArray(value.citations)) return false;
  if (
    BLOCK_TYPES_REQUIRING_CITATION.has(value.type as CopilotAnswerBlock["type"]) &&
    value.citations.length === 0
  ) {
    return false;
  }
  return true;
}

function isCopilotAnswer(value: unknown): value is CopilotAnswer {
  if (!isRecord(value)) return false;
  if (!isString(value.kind) || !ANSWER_KINDS.includes(value.kind as CopilotAnswerKind))
    return false;
  if (!isString(value.locale) || !LOCALES.includes(value.locale as CopilotLocale))
    return false;
  if (!isRecord(value.incident_classification)) return false;
  const classification = value.incident_classification;
  if (
    !isString(classification.verdict) ||
    !VERDICTS.includes(classification.verdict as CopilotVerdict) ||
    !isString(classification.justification)
  ) {
    return false;
  }
  if (
    !isString(value.grounding) ||
    !GROUNDINGS.includes(value.grounding as CopilotGrounding)
  ) {
    return false;
  }
  if (!Array.isArray(value.blocks) || !value.blocks.every(isCopilotAnswerBlock))
    return false;
  return true;
}

function isCopilotTelemetryEntry(value: unknown): value is CopilotTelemetryEntry {
  if (!isRecord(value)) return false;
  absentToNull(value, [
    "model",
    "provider",
    "generation_id",
    "input_tokens",
    "output_tokens",
    "cost_usd",
  ]);
  return (
    isString(value.call) &&
    isNullableString(value.model) &&
    isNullableString(value.provider) &&
    isNullableString(value.generation_id) &&
    isNullableNumber(value.input_tokens) &&
    isNullableNumber(value.output_tokens) &&
    isNullableNumber(value.cost_usd)
  );
}

function isCopilotRetrievalCandidate(value: unknown): value is CopilotRetrievalCandidate {
  if (!isRecord(value)) return false;
  absentToNull(value, ["postfilter_reason"]);
  return (
    isString(value.number) &&
    isString(value.short_description) &&
    typeof value.similarity === "number" &&
    typeof value.survived_postfilter === "boolean" &&
    isNullableString(value.postfilter_reason)
  );
}

/** Validates the envelope shared by every event, without checking the payload. */
function hasValidEnvelope(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CopilotEnvelope {
  return (
    value.protocol_version === "1" &&
    isString(value.turn_id) &&
    UUID_PATTERN.test(value.turn_id) &&
    typeof value.sequence === "number" &&
    Number.isInteger(value.sequence) &&
    value.sequence >= 1
  );
}

/** Builds a fully-typed event from a payload whose shape has already been checked, per `type`. */
function toCopilotStreamEvent(
  value: Record<string, unknown> & CopilotEnvelope,
): CopilotStreamEvent | null {
  switch (value.type) {
    case "turn.accepted": {
      if (
        isString(value.incident_number) &&
        isString(value.locale) &&
        LOCALES.includes(value.locale as CopilotLocale) &&
        isString(value.model_requested)
      ) {
        return value as unknown as TurnAcceptedEvent;
      }
      return null;
    }
    case "phase.changed": {
      absentToNull(value, ["duration_ms"]);
      if (
        isString(value.phase) &&
        PHASES.includes(value.phase as CopilotPhase) &&
        isString(value.status) &&
        PHASE_STATUSES.includes(value.status as CopilotPhaseStatus) &&
        isNullableNumber(value.duration_ms) &&
        // duration_ms is reported exactly when the phase has completed.
        (value.status === "completed"
          ? value.duration_ms !== null
          : value.duration_ms === null)
      ) {
        return value as unknown as PhaseChangedEvent;
      }
      return null;
    }
    case "retrieval.completed": {
      if (
        isString(value.query) &&
        Array.isArray(value.candidates) &&
        value.candidates.every(isCopilotRetrievalCandidate)
      ) {
        return value as unknown as RetrievalCompletedEvent;
      }
      return null;
    }
    case "answer.completed": {
      if (
        isCopilotAnswer(value.answer) &&
        isStringArray(value.sources) &&
        Array.isArray(value.telemetry) &&
        value.telemetry.every(isCopilotTelemetryEntry)
      ) {
        return value as unknown as AnswerCompletedEvent;
      }
      return null;
    }
    case "turn.failed": {
      absentToNull(value, ["retry_after_ms"]);
      if (
        isString(value.code) &&
        isString(value.message) &&
        typeof value.retryable === "boolean" &&
        isNullableNumber(value.retry_after_ms)
      ) {
        return value as unknown as TurnFailedEvent;
      }
      return null;
    }
    case "turn.cancelled": {
      if (isString(value.reason)) {
        return value as unknown as TurnCancelledEvent;
      }
      return null;
    }
    default:
      return null;
  }
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  "turn.accepted",
  "phase.changed",
  "retrieval.completed",
  "answer.completed",
  "turn.failed",
  "turn.cancelled",
]);

/**
 * Decodes and validates a full SSE stream against the copilot protocol v1
 * contract. Throws `StreamContractError` on the first violation encountered,
 * walking events in arrival order per `contracts/copilot-stream/README.md`.
 */
export function parseCopilotStream(chunks: string[]): CopilotStreamEvent[] {
  const rawPayloads = decodeSseStream(chunks);
  const events: CopilotStreamEvent[] = [];

  let streamTurnId: string | null = null;
  let previousSequence: number | null = null;
  let terminalSeen = false;

  for (const rawPayload of rawPayloads) {
    if (terminalSeen) {
      throw new StreamContractError(
        "event_after_terminal",
        "Event received after the terminal event.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new StreamContractError("invalid_event", "Event payload is not valid JSON.");
    }

    if (!isRecord(parsed)) {
      throw new StreamContractError(
        "invalid_event",
        "Event payload must be a JSON object.",
      );
    }

    if (parsed.protocol_version !== "1") {
      throw new StreamContractError(
        "unknown_protocol_version",
        `Unsupported protocol_version: ${JSON.stringify(parsed.protocol_version)}.`,
      );
    }

    if (!isString(parsed.type) || !EVENT_TYPES.has(parsed.type)) {
      throw new StreamContractError(
        "unknown_event_type",
        `Unknown event type: ${JSON.stringify(parsed.type)}.`,
      );
    }

    if (!hasValidEnvelope(parsed)) {
      throw new StreamContractError("invalid_event", "Event envelope is malformed.");
    }

    const event = toCopilotStreamEvent(parsed);
    if (event === null) {
      throw new StreamContractError(
        "invalid_event",
        `Payload for ${parsed.type} violates the schema.`,
      );
    }

    if (streamTurnId === null) {
      streamTurnId = event.turn_id;
    } else if (event.turn_id !== streamTurnId) {
      throw new StreamContractError("invalid_event", "turn_id changed mid-stream.");
    }

    if (previousSequence === null) {
      if (event.sequence !== 1) {
        throw new StreamContractError(
          "out_of_order_sequence",
          "First event sequence must be 1.",
        );
      }
    } else {
      if (event.sequence === previousSequence) {
        throw new StreamContractError(
          "duplicate_sequence",
          `Duplicate sequence: ${event.sequence}.`,
        );
      }
      if (event.sequence < previousSequence) {
        throw new StreamContractError(
          "out_of_order_sequence",
          `Sequence ${event.sequence} arrived after ${previousSequence}.`,
        );
      }
    }
    previousSequence = event.sequence;

    events.push(event);

    if (TERMINAL_TYPES.has(event.type)) {
      terminalSeen = true;
    }
  }

  if (!terminalSeen) {
    throw new StreamContractError(
      "missing_terminal",
      "Stream ended without a terminal event.",
    );
  }

  return events;
}
