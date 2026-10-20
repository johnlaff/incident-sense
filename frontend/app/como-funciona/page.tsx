"use client";

import { useMemo, useState } from "react";

import { useAula, useAulaLesson, type AulaLessonStep } from "@/components/aula";

import { Icons, type IconComponent } from "@/components/icons";
import { Meridian } from "@/components/ui";
import { BEATS, PIPELINE_STEPS } from "@/lib/pipeline";

const STEPS: { t: string; d: string; icon: IconComponent }[] = [
  {
    t: "Carregar",
    d: "Lê o incidente com categoria, subcategoria, empresa e tags.",
    icon: Icons.inbox,
  },
  {
    t: "Resumir",
    d: "A IA resume o incidente; a busca usa o resumo, não o texto original.",
    icon: Icons.summarize,
  },
  {
    t: "Transformar em números",
    d: "Resumo, categoria, subcategoria e empresa viram um vetor: números que representam o sentido.",
    icon: Icons.embed,
  },
  {
    t: "Buscar e conferir",
    d: "As tags dizem onde procurar, o vetor acha os parecidos e a IA descarta os que só parecem iguais.",
    icon: Icons.funnel,
  },
  {
    t: "Classificar",
    d: "Os casos aprovados viram contexto. Dúvida ou pedido (improcedente) não recebe sugestão.",
    icon: Icons.classify,
  },
  {
    t: "Sugerir",
    d: "Escreve a resolução citando as fontes; citação que não veio da busca é removida.",
    icon: Icons.lightbulb,
  },
  {
    t: "Publicar",
    d: "A sugestão entra nas notas de trabalho do incidente.",
    icon: Icons.insert,
  },
];
const N = STEPS.length;
const INSET = 100 / (2 * N);

// Captions for modo aula: the same words as the incident pipeline.
const RAG_LESSON: AulaLessonStep[] = PIPELINE_STEPS.map((step) => {
  const beat =
    BEATS.find((b) => b.step === step.key && b.layer === "vetor") ??
    BEATS.find((b) => b.step === step.key)!;
  return {
    title: step.title,
    caption: beat.caption,
    counter: `Etapa ${step.order} de 7`,
  };
});

/**
 * A sequence that stands still (complete) until someone presses
 * "Reproduzir", and goes step by step in modo aula.
 */
function useHowtoLesson(id: string, steps: AulaLessonStep[], fastMs: number) {
  const { aula } = useAula();
  // Static and complete until "Reproduzir"; then step by step in modo aula.
  const [plays, setPlays] = useState(0);
  const lesson = useAulaLesson({ id, steps, runKey: plays || null, fastMs });
  return {
    lesson,
    /** -1 before the first step, steps.length when everything shows. */
    idx:
      lesson.step < 0 && !lesson.playing
        ? steps.length
        : lesson.done && !aula
          ? steps.length
          : lesson.step,
    play: () => setPlays((n) => n + 1),
  };
}

function Rag() {
  const { idx, play } = useHowtoLesson("como-rag", RAG_LESSON, 760);

  const finished = idx >= N;
  const fillPct = (Math.max(0, Math.min(idx, N - 1)) / (N - 1)) * 100;
  const showComet = idx >= 0 && !finished;

  return (
    <div className="howto-section">
      <div className="howto-head">
        <div>
          <h2>Como a Aurora sugere uma resolução</h2>
          <p className="hs-sub">
            A técnica se chama RAG, geração aumentada por recuperação: em vez de responder
            de memória, a IA primeiro busca casos reais já resolvidos e escreve a partir
            deles. São sete etapas.
          </p>
        </div>
        <button className="btn btn-outline btn-sm howto-replay" onClick={play}>
          <Icons.replay />
          Reproduzir
        </button>
      </div>
      <div className="rag">
        <div className="rag-inner">
          <div className="rag-track" style={{ left: `${INSET}%`, right: `${INSET}%` }}>
            <div
              className="rag-track-fill"
              style={{ "--p": fillPct / 100 } as React.CSSProperties}
            />
            {showComet ? (
              <div
                className="rag-comet"
                style={{ "--p": fillPct / 100 } as React.CSSProperties}
              />
            ) : null}
          </div>
          <div className="rag-stages">
            {STEPS.map((s, i) => {
              const done = i < idx || finished;
              const active = i === idx;
              return (
                <div
                  key={i}
                  className={`rag-stage${active ? " active" : ""}${done ? " done" : ""}`}
                >
                  <div className="rag-dot">
                    {done ? <Icons.check sw={3} /> : <s.icon />}
                  </div>
                  <div className="rag-label">
                    <span className="rag-num">{`0${i + 1} `}</span>
                    {s.t}
                  </div>
                  <div className="rag-desc">{s.d}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="rag-io">
        <div className="rag-io-card">
          <span className="rag-io-k">Entrada</span>O incidente, descrito em linguagem
          natural.
        </div>
        <Icons.arrowRight className="rag-io-arrow" />
        <div className="rag-io-card out">
          <span className="rag-io-k">Saída</span>Uma sugestão com citações{" "}
          <span className="mono">[INC…]</span> que você pode abrir e conferir.
        </div>
      </div>
    </div>
  );
}

const CSTEPS: { t: string; d: string; icon: IconComponent }[] = [
  {
    t: "Cada incidente vira um ponto",
    d: "O resumo de cada incidente vira um ponto no mapa. No começo, tudo está espalhado.",
    icon: Icons.dot,
  },
  {
    t: "Medimos a semelhança",
    d: "Quanto mais parecidos dois incidentes, mais perto um do outro eles ficam.",
    icon: Icons.vectorSearch,
  },
  {
    t: "Agrupamos os mais próximos",
    d: "Nuvens de pontos próximos viram um grupo. Cada grupo é uma recorrência: um padrão que se repete.",
    icon: Icons.recurrences,
  },
  {
    t: "Separamos os casos isolados",
    d: "Pontos sem vizinhos suficientes ficam de fora, em cinza. São casos únicos, não um padrão.",
    icon: Icons.funnel,
  },
];
const CN = CSTEPS.length;

function rand(seed: number): number {
  const x = Math.sin(seed * 991.7) * 43758.5;
  return x - Math.floor(x);
}

// Round positions to a fixed precision so the SSR and client strings match
// exactly (Math.sin can differ at the last ULP between the Node and browser
// engines, which would otherwise trip a hydration mismatch).
function pctOf(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}
function fix(v: number): string {
  return v.toFixed(4);
}

interface MiniPoint {
  id: number;
  color: string;
  out?: boolean;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

function buildMini(): {
  pts: MiniPoint[];
  cents: { x: number; y: number; color: string; label: string }[];
} {
  const cents = [
    { x: 0.24, y: 0.42, color: "oklch(0.6 0.13 285)", label: "Timeout no Pix" },
    { x: 0.55, y: 0.68, color: "oklch(0.62 0.12 160)", label: "Boleto" },
    { x: 0.78, y: 0.34, color: "oklch(0.63 0.12 330)", label: "Cartão" },
  ];
  const pts: MiniPoint[] = [];
  let id = 0;
  cents.forEach((c) => {
    for (let i = 0; i < 7; i++) {
      const a = rand(id + 1) * Math.PI * 2;
      const r = 0.03 + rand(id + 5) * 0.08;
      pts.push({
        id: id++,
        color: c.color,
        tx: c.x + Math.cos(a) * r,
        ty: c.y + Math.sin(a) * r,
        sx: 0.12 + rand(id + 3) * 0.76,
        sy: 0.16 + rand(id + 9) * 0.68,
      });
    }
  });
  for (let i = 0; i < 4; i++) {
    pts.push({
      id: id++,
      color: "oklch(0.62 0.01 285)",
      out: true,
      tx: 0.1 + rand(id + 7) * 0.8,
      ty: 0.16 + rand(id + 11) * 0.68,
      sx: 0.12 + rand(id + 13) * 0.76,
      sy: 0.16 + rand(id + 17) * 0.68,
    });
  }
  return { pts, cents };
}

const CLUSTER_LESSON: AulaLessonStep[] = [
  {
    title: "Pontos",
    caption: "Cada incidente vira um ponto. No começo, tudo está espalhado.",
  },
  {
    title: "Semelhança",
    caption: "Quanto mais parecidos dois incidentes, mais perto eles ficam.",
  },
  {
    title: "Grupos",
    caption: "Pontos próximos viram um grupo: uma recorrência, um padrão que se repete.",
  },
  {
    title: "Isolados",
    caption:
      "Pontos sem vizinhos ficam de fora, em cinza. São casos únicos, não um padrão.",
  },
];

function Clustering() {
  const mini = useMemo(() => buildMini(), []);
  const { idx: step, play } = useHowtoLesson("como-clusters", CLUSTER_LESSON, 1150);

  const grouped = step >= 2;
  const separated = step >= 3;
  const done = step >= CN;
  const statusText =
    step < 0
      ? ""
      : step === 0
        ? "Cada incidente é um ponto"
        : step === 1
          ? "Comparando a semelhança…"
          : step === 2
            ? "Formando os grupos…"
            : "3 grupos e 4 casos isolados";

  return (
    <div className="howto-section">
      <div className="howto-head">
        <div>
          <h2>Como encontramos as recorrências</h2>
          <p className="hs-sub">
            Os mesmos números que medem semelhança também revelam grupos. Veja, passo a
            passo, como incidentes parecidos se juntam num padrão e como os casos isolados
            ficam de fora.
          </p>
        </div>
        <button className="btn btn-outline btn-sm howto-replay" onClick={play}>
          <Icons.replay />
          Reproduzir
        </button>
      </div>
      <div className="cluster-explain">
        <div className="mini-cluster">
          {mini.pts.map((p) => {
            const color = p.out
              ? "oklch(0.6 0.012 285)"
              : grouped
                ? p.color
                : "oklch(0.64 0.015 285)";
            return (
              <span
                key={p.id}
                className="mc-point"
                style={
                  {
                    "--x": fix(grouped ? p.tx : p.sx),
                    "--y": fix(grouped ? p.ty : p.sy),
                    "--s": p.out ? 0.75 : 1,
                    background: color,
                    opacity: p.out && separated ? 0.4 : 1,
                    transitionDelay: `${(p.id % 6) * 34}ms`,
                  } as React.CSSProperties
                }
              />
            );
          })}
          {mini.cents.map((c, i) => (
            <div
              key={`l${i}`}
              className={`mc-label${separated ? "" : " hide"}`}
              style={{ left: pctOf(c.x), top: `${(c.y * 100 - 14).toFixed(2)}%` }}
            >
              {c.label}
            </div>
          ))}
          <div className="mc-status">{statusText}</div>
        </div>
        <div className="cluster-steps">
          {CSTEPS.map((s, i) => {
            const active = i === step;
            const sdone = i < step || done;
            return (
              <div
                key={i}
                className={`cstep${active ? " active" : ""}${sdone ? " done" : ""}`}
              >
                <div className="cstep-dot">
                  {sdone ? <Icons.check sw={3} /> : <s.icon />}
                </div>
                <div className="cstep-main">
                  <div className="cstep-t">
                    <span className="cstep-n">{`0${i + 1}`}</span>
                    {s.t}
                  </div>
                  <div className="cstep-d">{s.d}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="cluster-legend">
        <span className="cl-it">
          <span className="cl-sw" style={{ background: "oklch(0.6 0.13 285)" }} />
          Cada cor é um grupo (uma recorrência)
        </span>
        <span className="cl-it">
          <span className="cl-sw" style={{ background: "oklch(0.6 0.012 285)" }} />
          Cinza: caso isolado, fica de fora
        </span>
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="howto">
      <div className="page-head">
        <h1>Como funciona</h1>
      </div>
      <p className="page-lede howto-lead">
        O Incident Sense procura incidentes parecidos que já foram resolvidos, descarta os
        que não se encaixam e só então escreve uma sugestão. Toda sugestão cita as fontes,
        para você conferir.
      </p>
      <Rag />
      <Clustering />
      <footer className="howto-foot">
        <Meridian ticks={28} />
        <p>
          O Banco Meridiano é fictício e os dados são sintéticos. A IA sugere e mostra as
          fontes; quem decide e responde pela resolução é a pessoa analista.
        </p>
      </footer>
    </div>
  );
}
