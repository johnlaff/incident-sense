"use client";

// Layer 2 made visible: every candidate the vector search returned slides from
// the left edge to its real cosine similarity on a 0,50 to 1,00 ruler, with
// the floor (0,80) drawn as a line. A slider re-applies layer 2 at another
// floor to the same candidates, labeled as a simulation. "O que é 0,84?"
// draws the cosine as the angle between two arrows.

import { useId, useMemo, useState, type CSSProperties } from "react";

import { Icons } from "./icons";
import { OUTCOME_LABEL, formatSim, type RetrievalRow } from "@/lib/pipeline";
import {
  RULER_TICKS,
  cosineAngle,
  laneCount,
  rulerDots,
  rulerX,
  simulatePass,
  snapThreshold,
} from "@/lib/ruler";

type Style = CSSProperties & Record<`--${string}`, string | number>;

export function SimilarityRuler({
  incidents,
  problems,
  floor,
  compact = false,
  onOpen,
}: {
  incidents: RetrievalRow[];
  problems: RetrievalRow[];
  floor: number;
  /** Aurora panel: no simulation, smaller type. */
  compact?: boolean;
  onOpen?: (number: string, el?: HTMLElement) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [simOn, setSimOn] = useState(false);
  const [simAt, setSimAt] = useState(floor);
  const all = useMemo(() => [...incidents, ...problems], [incidents, problems]);
  const threshold = simOn ? simAt : floor;
  const pickedRow = all.find((r) => r.number === picked) ?? null;
  const rangeId = useId();

  const tracks = [
    { key: "inc", label: "Incidentes resolvidos", rows: incidents },
    { key: "prb", label: "Problemas", rows: problems },
  ].filter((t) => t.rows.length);

  if (!all.length) {
    return (
      <p className="ruler-empty">A busca por vetor não devolveu nenhum candidato.</p>
    );
  }

  const realPassed = all.filter((r) => r.sim >= floor).length;
  const simPassed = simulatePass(all, simAt);

  return (
    <div className={`ruler${compact ? " is-compact" : ""}${simOn ? " is-sim" : ""}`}>
      <div
        className="ruler-axis"
        style={{ "--fx": rulerX(floor), "--sx": rulerX(simAt) } as Style}
      >
        <div className="ruler-plot">
          <div className="ruler-out" aria-hidden="true" />
          <div className="ruler-floor" aria-hidden="true">
            <span className="ruler-out-label">fica de fora</span>
            <span className="ruler-floor-label">
              <b className="mono">{formatSim(floor)}</b> limiar
            </span>
          </div>
          {simOn ? (
            <div className="ruler-simline" aria-hidden="true">
              <span className="mono">{formatSim(simAt)}</span>
            </div>
          ) : null}

          {tracks.map((t) => {
            const dots = rulerDots(t.rows, threshold);
            const lanes = Math.max(1, laneCount(dots));
            return (
              <div
                className="ruler-track"
                key={t.key}
                style={{ "--lanes": lanes } as Style}
              >
                <div className="ruler-track-label">
                  {t.label}
                  <span className="mono">
                    {" "}
                    {dots.filter((d) => d.passed).length} de {dots.length}
                  </span>
                </div>
                <div className="ruler-lanes">
                  <span className="ruler-line" aria-hidden="true" />
                  {dots.map((d) => {
                    const row = t.rows.find((r) => r.number === d.number);
                    return (
                      <button
                        type="button"
                        key={d.number}
                        className={`ruler-dot ${d.passed ? "is-pass" : "is-fail"}${
                          picked === d.number ? " is-picked" : ""
                        }`}
                        style={{ "--x": d.x, "--lane": d.lane, "--o": d.order } as Style}
                        aria-pressed={picked === d.number}
                        aria-label={`${d.number}, similaridade ${formatSim(d.sim)}, ${
                          d.passed ? "passou" : "abaixo do limiar"
                        }${row ? `: ${row.desc}` : ""}`}
                        onClick={() =>
                          setPicked((p) => (p === d.number ? null : d.number))
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="ruler-ticks" aria-hidden="true">
            {RULER_TICKS.map((t) => (
              <span key={t} className="mono" style={{ "--x": rulerX(t) } as Style}>
                {formatSim(t)}
              </span>
            ))}
          </div>
        </div>

        {!compact && simOn ? (
          <input
            id={rangeId}
            className="ruler-range"
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={simAt}
            onChange={(e) => setSimAt(snapThreshold(Number(e.target.value)))}
            aria-label="Limiar simulado da camada 2"
            aria-valuetext={formatSim(simAt)}
          />
        ) : null}
      </div>

      <div className="ruler-legend">
        <span className="ruler-key">
          <span className="ruler-swatch is-pass" aria-hidden="true" />
          passou: {formatSim(threshold)} ou mais
        </span>
        <span className="ruler-key">
          <span className="ruler-swatch is-fail" aria-hidden="true" />
          abaixo do limiar
        </span>
        {all.some((r) => r.sim < 0.5) ? (
          <span className="ruler-key">abaixo de 0,50: na borda esquerda</span>
        ) : null}
        <span className="ruler-key ruler-hint">Toque num ponto para ver o caso.</span>
      </div>

      {pickedRow ? (
        <div className="ruler-pick" role="status">
          <span className="mono ruler-pick-num">{pickedRow.number}</span>
          <span className="ruler-pick-desc">{pickedRow.desc}</span>
          <span className="ruler-pick-meta">
            <b className="mono">{formatSim(pickedRow.sim)}</b>
            {" · "}
            {pickedRow.outcome === "abaixo"
              ? "abaixo do limiar"
              : `passou; na camada 3: ${OUTCOME_LABEL[pickedRow.outcome]}`}
          </span>
          {pickedRow.kind === "incidente" && onOpen ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => onOpen(pickedRow.number, e.currentTarget)}
            >
              <Icons.external />
              Abrir
            </button>
          ) : null}
        </div>
      ) : null}

      {!compact ? (
        <div className="ruler-sim">
          <button
            type="button"
            className={`btn btn-outline btn-sm${simOn ? " is-on" : ""}`}
            aria-pressed={simOn}
            aria-controls={simOn ? rangeId : undefined}
            onClick={() => {
              setSimOn((on) => !on);
              setSimAt(floor);
            }}
          >
            <Icons.ruler />
            {simOn ? "Fechar a simulação" : "Mexer no limiar"}
          </button>
          {simOn ? (
            <p className="ruler-sim-note" aria-live="polite">
              <b>Simulação: só a camada 2.</b> Com {formatSim(simAt)}, {simPassed} de{" "}
              {all.length} passariam. No real, com {formatSim(floor)}, {realPassed}{" "}
              passaram. As camadas 1 e 3 não rodam de novo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "O que é 0,84?": the cosine as the angle between two arrows. */
export function CosineAngle({ sim, floor }: { sim: number; floor: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const angle = cosineAngle(sim);
  const floorAngle = cosineAngle(floor);
  const label = formatSim(sim);
  // Draw from an origin at the bottom left; angles grow counterclockwise.
  const ox = 24;
  const oy = 128;
  const len = 150;
  const wedge = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return `M${ox} ${oy} L${ox + len} ${oy} A${len} ${len} 0 0 0 ${ox + len * Math.cos(r)} ${
      oy - len * Math.sin(r)
    } Z`;
  };
  return (
    <div className="cosine">
      <button
        type="button"
        className="btn btn-ghost btn-sm cosine-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        O que é {label}?
        <Icons.chevronDown />
      </button>
      {open ? (
        <figure className="cosine-fig" id={id}>
          <svg
            viewBox="0 0 200 140"
            role="img"
            aria-label={`Duas setas separadas por ${Math.round(angle)} graus`}
          >
            <path className="cosine-fan" d={wedge(floorAngle)} />
            <line className="cosine-ref" x1={ox} y1={oy} x2={ox + len} y2={oy} />
            <g
              className="cosine-arm"
              style={
                { "--a": `${-angle}deg`, transformOrigin: `${ox}px ${oy}px` } as Style
              }
            >
              <line x1={ox} y1={oy} x2={ox + len} y2={oy} />
              <path
                d={`M${ox + len - 8} ${oy - 5} L${ox + len} ${oy} L${ox + len - 8} ${oy + 5}`}
              />
            </g>
            <text className="cosine-fan-t" x={ox + len - 4} y={oy - len * 0.52}>
              {formatSim(floor)} = {Math.round(floorAngle)}°
            </text>
            <text className="cosine-a" x={ox + 34} y={oy - 8}>
              {Math.round(angle)}°
            </text>
          </svg>
          <figcaption>
            <b className="mono">{label}</b> é o cosseno do ângulo entre o vetor deste
            incidente e o do caso parecido: <b>{Math.round(angle)}°</b>. Quanto menor o
            ângulo, mais parecido; 1,00 seria a mesma direção. A faixa clara vai até{" "}
            {Math.round(floorAngle)}°, o ângulo do limiar de {formatSim(floor)}. Os
            vetores têm milhares de dimensões; o desenho mostra só o ângulo entre eles.
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
