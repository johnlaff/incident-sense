"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icons, type IconComponent } from "@/components/icons";
import { Meridian } from "@/components/ui";
import { usePrefersReducedMotion } from "@/lib/motion";

const STEPS: { t: string; d: string; icon: IconComponent }[] = [
  {
    t: "Resumir consulta",
    d: "Reduz o chamado a um resumo curto e neutro.",
    icon: Icons.summarize,
  },
  {
    t: "Vetorizar",
    d: "Converte o resumo num vetor que captura o significado.",
    icon: Icons.embed,
  },
  {
    t: "Buscar vizinhos",
    d: "Recupera incidentes resolvidos de vetor próximo.",
    icon: Icons.vectorSearch,
  },
  {
    t: "Pós-filtro",
    d: "Um LLM relê e descarta o que não casa de fato.",
    icon: Icons.funnel,
  },
  {
    t: "Classificar",
    d: "Decide se há base: PROCEDENTE ou IMPROCEDENTE.",
    icon: Icons.classify,
  },
  { t: "Sugerir", d: "Redige a resolução citando as fontes.", icon: Icons.lightbulb },
];
const N = STEPS.length;
const INSET = 100 / (2 * N);

function Rag() {
  const reduced = usePrefersReducedMotion();
  const [idx, setIdx] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    clear();
    if (reduced) {
      setIdx(N);
      return clear;
    }
    setIdx(-1);
    let i = 0;
    const step = () => {
      setIdx(i);
      i++;
      if (i <= N) timers.current.push(setTimeout(step, 760));
    };
    timers.current.push(setTimeout(step, 320));
    return clear;
  }, [reduced]);

  function play() {
    clear();
    if (reduced) {
      setIdx(N);
      return;
    }
    setIdx(-1);
    let i = 0;
    const step = () => {
      setIdx(i);
      i++;
      if (i <= N) timers.current.push(setTimeout(step, 760));
    };
    timers.current.push(setTimeout(step, 320));
  }

  const finished = idx >= N;
  const fillPct = (Math.max(0, Math.min(idx, N - 1)) / (N - 1)) * 100;
  const showComet = idx >= 0 && !finished;

  return (
    <div className="howto-section">
      <div className="howto-head">
        <div>
          <h2>Como o copiloto sugere uma resolução</h2>
          <div className="hs-sub">
            É um pipeline de RAG (Geração Aumentada por Recuperação). Cada chamado novo
            passa por seis etapas, e a resposta sempre sai de casos reais que já foram
            resolvidos.
          </div>
        </div>
        <button className="btn btn-outline btn-sm howto-replay" onClick={play}>
          <Icons.replay />
          Reproduzir
        </button>
      </div>
      <div className="rag">
        <div className="rag-inner">
          <div className="rag-track" style={{ left: `${INSET}%`, right: `${INSET}%` }}>
            <div className="rag-track-fill" style={{ width: `${fillPct}%` }} />
            {showComet ? (
              <div className="rag-comet" style={{ left: `${fillPct}%` }} />
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
          <span className="rag-io-k">Entra</span>o chamado em linguagem natural
        </div>
        <Icons.arrowRight className="rag-io-arrow" />
        <div className="rag-io-card out">
          <span className="rag-io-k">Sai</span>uma sugestão com citações{" "}
          <span className="mono">[INC…]</span> rastreáveis
        </div>
      </div>
    </div>
  );
}

const CSTEPS: { t: string; d: string; icon: IconComponent }[] = [
  {
    t: "Cada incidente vira um ponto",
    d: "Pegamos o resumo de cada chamado e o transformamos num ponto. Tudo começa espalhado.",
    icon: Icons.dot,
  },
  {
    t: "Medimos a semelhança",
    d: "A IA compara os pontos. Quanto mais parecido o problema, mais perto um do outro eles ficam.",
    icon: Icons.vectorSearch,
  },
  {
    t: "Agrupamos os mais próximos",
    d: "Nuvens de pontos próximos viram um grupo. Cada grupo é uma causa raiz que se repete.",
    icon: Icons.recurrences,
  },
  {
    t: "Separamos os casos isolados",
    d: "Pontos sem vizinhos suficientes ficam de fora, em cinza. São casos únicos, não uma recorrência.",
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

function Clustering() {
  const reduced = usePrefersReducedMotion();
  const mini = useMemo(() => buildMini(), []);
  const [step, setStep] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    clear();
    if (reduced) {
      setStep(CN);
      return clear;
    }
    setStep(-1);
    let i = 0;
    const tick = () => {
      setStep(i);
      i++;
      if (i <= CN) timers.current.push(setTimeout(tick, 1150));
    };
    timers.current.push(setTimeout(tick, 380));
    return clear;
  }, [reduced]);

  function play() {
    clear();
    if (reduced) {
      setStep(CN);
      return;
    }
    setStep(-1);
    let i = 0;
    const tick = () => {
      setStep(i);
      i++;
      if (i <= CN) timers.current.push(setTimeout(tick, 1150));
    };
    timers.current.push(setTimeout(tick, 380));
  }

  const grouped = step >= 2;
  const separated = step >= 3;
  const done = step >= CN;
  const statusText =
    step < 0
      ? ""
      : step === 0
        ? "Cada chamado é um ponto"
        : step === 1
          ? "Comparando a semelhança…"
          : step === 2
            ? "Formando os grupos…"
            : "3 grupos encontrados · 4 casos isolados";

  return (
    <div className="howto-section">
      <div className="howto-head">
        <div>
          <h2>Como agrupamos as recorrências</h2>
          <div className="hs-sub">
            Os mesmos números que medem semelhança também revelam grupos. Veja, passo a
            passo, como chamados parecidos se juntam numa causa raiz — e como os casos
            isolados ficam de fora.
          </div>
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
                style={{
                  left: pctOf(grouped ? p.tx : p.sx),
                  top: pctOf(grouped ? p.ty : p.sy),
                  width: p.out ? 9 : 12,
                  height: p.out ? 9 : 12,
                  background: color,
                  opacity: p.out && separated ? 0.4 : 1,
                  transitionDelay: `${(p.id % 6) * 34}ms`,
                }}
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
          Cada cor é um grupo (uma causa raiz)
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
        <span className="count">RAG fundamentado + clustering</span>
      </div>
      <p className="howto-lead" style={{ marginTop: -8 }}>
        O Incident Sense busca incidentes parecidos que já foram resolvidos, descarta o
        que não encaixa e então escreve uma sugestão. Ela vem sempre com a fonte citada,
        para você conferir.
      </p>
      <Rag />
      <Clustering />
      <Meridian ticks={28} style={{ marginTop: 32, maxWidth: 360 }} />
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10 }}>
        Banco Meridiano, dados sintéticos. O copiloto ajuda e mostra as fontes; a decisão
        e a responsabilidade continuam com a pessoa analista.
      </p>
    </div>
  );
}
