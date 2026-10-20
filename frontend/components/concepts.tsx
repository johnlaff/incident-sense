// The lesson's visual language, declared once. Every concept a student meets
// (Incidente, Problema, Mudança, caso parecido, etapa da IA, resposta da IA,
// ação de uma pessoa, nota, portão) has one color, one icon and one shape.
// Styles live in app/concepts.css; tokens (--c-*) in app/globals.css.
import type { ReactNode } from "react";

import { Icons, type IconComponent } from "./icons";

export type ConceptKey =
  "inc" | "prb" | "chg" | "similar" | "ai-step" | "ai-out" | "human" | "score" | "gate";

export interface ConceptMeta {
  key: ConceptKey;
  icon: IconComponent;
  /** Name shown in the legend and on tags. */
  name: string;
  /** One plain line: what this thing is, for a first-semester student. */
  gloss: string;
  /** How to recognize it on screen. */
  look: string;
}

export const CONCEPTS: Record<ConceptKey, ConceptMeta> = {
  inc: {
    key: "inc",
    icon: Icons.incident,
    name: "Incidente",
    gloss: "Algo quebrou agora e alguém abriu um chamado.",
    look: "Pulseira azul com raio e número INC",
  },
  prb: {
    key: "prb",
    icon: Icons.problem,
    name: "Problema",
    gloss: "A causa por trás de incidentes que se repetem.",
    look: "Pulseira dourada com raízes e número PRB",
  },
  chg: {
    key: "chg",
    icon: Icons.changes,
    name: "Mudança",
    gloss: "Um pedido para alterar algo em produção, como um deploy.",
    look: "Pulseira verde-azulada com número CHG",
  },
  similar: {
    key: "similar",
    icon: Icons.similar,
    name: "Caso parecido",
    gloss: "Um incidente antigo, já resolvido, que se parece com o atual.",
    look: "Pulseira azul vazada, com a nota de semelhança",
  },
  "ai-step": {
    key: "ai-step",
    icon: Icons.aiStep,
    name: "Etapa da IA",
    gloss: "Um passo que a máquina executa sozinha.",
    look: "Contorno violeta tracejado com engrenagem",
  },
  "ai-out": {
    key: "ai-out",
    icon: Icons.aiSpark,
    name: "Resposta da IA",
    gloss: "O que a IA escreveu. É uma sugestão, não uma ordem.",
    look: "Bloco violeta com estrela",
  },
  human: {
    key: "human",
    icon: Icons.human,
    name: "Decisão de uma pessoa",
    gloss: "Quem revisa e decide é sempre uma pessoa analista.",
    look: "Botão preto com pessoa",
  },
  score: {
    key: "score",
    icon: Icons.score,
    name: "Nota",
    gloss: "Um número que mede algo: semelhança de 0 a 1 ou nota de 0 a 10.",
    look: "Número grande; verde passa, âmbar atenção, vermelho não passa",
  },
  gate: {
    key: "gate",
    icon: Icons.gate,
    name: "Portão",
    gloss: "Uma regra de sim ou não que deixa passar ou barra.",
    look: "Losango com sim ou não",
  },
};

/** Record kind from its number prefix (INC, PRB, CHG). */
export function conceptOf(number: string): "inc" | "prb" | "chg" {
  if (number.startsWith("PRB")) return "prb";
  if (number.startsWith("CHG")) return "chg";
  return "inc";
}

/**
 * The record's "pulseira" (wristband): concept color, icon and number.
 * `ghost` draws it hollow, for a similar past case shown as evidence.
 */
export function RecordTag({
  number,
  kind,
  ghost,
  size = "md",
  label,
}: {
  number: string;
  kind?: "inc" | "prb" | "chg";
  ghost?: boolean;
  size?: "sm" | "md" | "lg";
  /** Visually hidden prefix for screen readers, e.g. "Incidente". */
  label?: string;
}) {
  const k = kind ?? conceptOf(number);
  const Icon = CONCEPTS[k].icon;
  return (
    <span className={`rtag rtag-${k} rtag-${size}${ghost ? " rtag-ghost" : ""}`}>
      <Icon />
      <span className="sr-only">{label ?? CONCEPTS[k].name} </span>
      <span className="rtag-num">{number}</span>
    </span>
  );
}

/** A concept's icon in its shaped chip (square record, dashed AI step...). */
export function ConceptIcon({ concept, size }: { concept: ConceptKey; size?: number }) {
  const Icon = CONCEPTS[concept].icon;
  return (
    <span className={`cicon cicon-${concept}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}

/** Small inline label: icon + concept name in its color ("Etapa da IA"). */
export function ConceptLabel({
  concept,
  children,
}: {
  concept: ConceptKey;
  children?: ReactNode;
}) {
  const Icon = CONCEPTS[concept].icon;
  return (
    <span className={`clabel clabel-${concept}`}>
      <Icon />
      {children ?? CONCEPTS[concept].name}
    </span>
  );
}

export type ScoreBand = "high" | "mid" | "low";

export const BAND_WORD: Record<ScoreBand, string> = {
  high: "Passa",
  mid: "Atenção",
  low: "Não passa",
};

/**
 * A score set big, with its band word so color is never alone.
 * `max` is 10 for change grades, 1 for similarity.
 */
export function ScoreNumber({
  value,
  band,
  max,
  size = "lg",
  caption,
  decimals = 1,
}: {
  value: number;
  band: ScoreBand;
  max?: number;
  size?: "md" | "lg" | "xl";
  caption?: ReactNode;
  decimals?: number;
}) {
  const shown = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <span className={`score score-${band} score-${size}`}>
      <span className="score-num">
        {shown}
        {max != null ? <span className="score-max">/{max}</span> : null}
      </span>
      <span className="score-band">
        {band === "high" ? (
          <Icons.check sw={3} />
        ) : band === "low" ? (
          <Icons.close sw={3} />
        ) : (
          <Icons.alert />
        )}
        {caption ?? BAND_WORD[band]}
      </span>
    </span>
  );
}

/** The gate: a diamond with its rule, and the verdict when known. */
export function GateMark({
  rule,
  verdict,
}: {
  rule: ReactNode;
  verdict?: "pass" | "fail" | null;
}) {
  return (
    <span className={`gatemark${verdict ? ` gatemark-${verdict}` : ""}`}>
      <span className="gatemark-diamond" aria-hidden="true">
        {verdict === "pass" ? (
          <Icons.check sw={3} />
        ) : verdict === "fail" ? (
          <Icons.close sw={3} />
        ) : (
          <Icons.gate />
        )}
      </span>
      <span className="gatemark-rule">{rule}</span>
      {verdict ? (
        <span className="gatemark-verdict">
          {verdict === "pass" ? "Sim, passa" : "Não, barrado"}
        </span>
      ) : null}
    </span>
  );
}

/** Technical detail kept out of the way: one tap to open. */
export function TechDetails({
  children,
  summary = "Ver detalhes técnicos",
}: {
  children: ReactNode;
  summary?: string;
}) {
  return (
    <details className="tech">
      <summary>
        <Icons.chevronRight />
        {summary}
      </summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}

/** The legend: every concept with its look and a one-line meaning. */
export function ConceptLegend({ only }: { only?: ConceptKey[] }) {
  const keys = only ?? (Object.keys(CONCEPTS) as ConceptKey[]);
  return (
    <ul className="legend" aria-label="Legenda das cores e ícones">
      {keys.map((k) => {
        const c = CONCEPTS[k];
        return (
          <li key={k} className={`legend-item legend-${k}`}>
            <ConceptIcon concept={k} />
            <div>
              <b>{c.name}</b>
              <p>{c.gloss}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
