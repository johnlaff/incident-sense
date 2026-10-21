// The explanatory visuals, one per step. Each one is drawn in its final state
// and the chapter's row state (data-s on .cf-row: ahead, now, done) or the
// scroll-driven reveal plays it; see como-funciona.css. Values come from
// story.ts and say on screen where they come from.

import type { CSSProperties } from "react";

import { ConceptLabel, GateMark, RecordTag, ScoreNumber } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { clusterColor } from "@/lib/model";

import { Origin } from "./chapter";
import {
  CANDIDATES,
  CHG2_BACKOUT,
  CHG2_COHERENCE,
  CHG2_IMPLEMENTATION,
  CHG2_TASKS,
  COVERAGE_LABEL,
  EMBEDDING,
  EXAMPLE_GRADES,
  EXAMPLE_LATENCY,
  EXAMPLE_SUMMARY,
  GATE,
  GATE_EXAMPLES,
  IMPROCEDENTE,
  INCIDENT,
  MINI_GROUPS,
  PROBLEM,
  RETRIEVAL,
  RUBRIC,
  SUGGESTION,
  TAG_FUNNEL,
  TOTAL_WEIGHT,
  br,
  fingerprint,
  funnel,
  latencySummary,
  miniMap,
  queryText,
  rulerPos,
  seeded,
  weightedSegments,
  words,
} from "./story";

type Style = CSSProperties & Record<`--${string}`, string | number>;

const fix = (n: number) => Number(n.toFixed(4));

// ---------------------------------------------------------------------------
// Chapter 1
// ---------------------------------------------------------------------------

export function Weights() {
  const max = Math.max(...RUBRIC.map((r) => r.weight));
  return (
    <figure className="cf-card cf-weights">
      <figcaption className="cf-card-head">
        <span>Grade de avaliação</span>
        <Origin kind="demo">rubrica.toml do demo</Origin>
      </figcaption>
      <ul className="cf-wt-list">
        {RUBRIC.map((r, i) => (
          <li
            key={r.key}
            className="cf-wt"
            style={{ "--i": i, "--v": fix(r.weight / max) } as Style}
          >
            <span className="cf-wt-l">{r.label}</span>
            <span className="cf-bar-track" aria-hidden="true">
              <i className="cf-bar" />
            </span>
            <b className="mono">{br(r.weight)}</b>
          </li>
        ))}
      </ul>
      <p className="cf-card-foot">
        Soma dos pesos: <b className="mono">{br(TOTAL_WEIGHT)}</b>
      </p>
    </figure>
  );
}

export function Parallel() {
  const { parallel, queue } = latencySummary();
  const starts = RUBRIC.map((_, i) =>
    RUBRIC.slice(0, i).reduce((sum, x) => sum + EXAMPLE_LATENCY[x.key], 0),
  );
  return (
    <figure className="cf-card cf-par">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <ConceptLabel concept="ai-step" />
          Sete chamadas ao modelo
        </span>
        <Origin kind="ilustrativo">tempos ilustrativos</Origin>
      </figcaption>
      <div className="cf-par-group">
        <p className="cf-par-k">
          Juntas <b className="mono">{br(parallel)} s</b>
        </p>
        <ul className="cf-par-lanes">
          {RUBRIC.map((r, i) => {
            const t = EXAMPLE_LATENCY[r.key];
            return (
              <li
                key={r.key}
                style={{ "--i": i, "--t": t, "--v": fix(t / queue) } as Style}
              >
                <span className="cf-par-l">{r.short}</span>
                <span className="cf-bar-track" aria-hidden="true">
                  <i className="cf-bar cf-bar-lin" />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="cf-par-group">
        <p className="cf-par-k">
          Uma depois da outra <b className="mono">{br(queue)} s</b>
        </p>
        <div className="cf-par-queue" aria-hidden="true">
          {RUBRIC.map((r, i) => {
            const t = EXAMPLE_LATENCY[r.key];
            const start = starts[i];
            return (
              <i
                key={r.key}
                className="cf-q-seg"
                style={
                  {
                    "--i": i,
                    "--t": t,
                    "--c": start,
                    left: `${(start / queue) * 100}%`,
                    width: `${(t / queue) * 100}%`,
                  } as Style
                }
              />
            );
          })}
        </div>
      </div>
      <p className="cf-card-foot">
        O tempo total fica perto do campo mais lento, não da soma.
      </p>
    </figure>
  );
}

export function Average() {
  const { segments, average } = weightedSegments(EXAMPLE_GRADES);
  return (
    <figure className="cf-card cf-avg">
      <figcaption className="cf-card-head">
        <span>CHG0031002: nota de cada campo × peso</span>
        <Origin kind="ilustrativo">notas por campo ilustrativas</Origin>
      </figcaption>
      <ul className="cf-avg-terms">
        {segments.map((s, i) => (
          <li key={s.key} style={{ "--i": i } as Style}>
            <span className="cf-avg-l">{s.short}</span>
            <span className="mono">
              {br(s.grade)} × {br(s.weight)}
            </span>
          </li>
        ))}
      </ul>
      <div
        className="cf-scale"
        style={{ "--avg": fix(average / 10), "--gate": GATE / 10 } as Style}
        role="img"
        aria-label={`Média ponderada ${br(average, 2)} numa escala de 0 a 10, com corte em ${br(GATE)}`}
      >
        <div className="cf-scale-track">
          {segments.map((s, i) => (
            <i
              key={s.key}
              className="cf-seg"
              style={
                {
                  "--i": i,
                  left: `${(s.start / 10) * 100}%`,
                  width: `${(s.share / 10) * 100}%`,
                } as Style
              }
            />
          ))}
          <span className="cf-gate-tick">
            <span className="mono">{br(GATE)}</span>
          </span>
        </div>
        <span className="cf-pointer">
          <b className="mono">{br(average, 2)}</b>
        </span>
        <div className="cf-scale-ticks mono" aria-hidden="true">
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>
      </div>
      <p className="cf-formula mono">
        ({segments.map((s) => br(s.product)).join(" + ")}) ÷ {br(TOTAL_WEIGHT)} ={" "}
        <b>{br(average, 2)}</b>
      </p>
      <div className="cf-avg-result">
        <ScoreNumber value={average} band="high" max={10} decimals={2} size="md" />
        <GateMark rule={`Nota mínima ${br(GATE)}`} verdict="pass" />
      </div>
    </figure>
  );
}

export function ContentLock() {
  return (
    <figure className="cf-card cf-lock">
      <figcaption className="cf-card-head">
        <span>Reavaliar depois de editar Benefícios</span>
        <Origin kind="ilustrativo">exemplo</Origin>
      </figcaption>
      <ul className="cf-lock-list">
        {RUBRIC.map((r, i) => {
          const edited = r.key === "benefits";
          return (
            <li
              key={r.key}
              className={edited ? "is-edited" : "is-kept"}
              style={{ "--i": i } as Style}
            >
              <span className="cf-lock-l">{r.short}</span>
              {edited ? (
                <span className="cf-lock-s is-call">
                  <Icons.aiSpark size={14} />
                  volta ao juiz
                </span>
              ) : (
                <span className="cf-lock-s">
                  <Icons.check size={14} sw={2.5} />
                  nota mantida
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="cf-card-foot">
        <b className="mono">1</b> chamada ao modelo em vez de <b className="mono">7</b>.
        Campo sem mudança reaproveita a nota.
      </p>
    </figure>
  );
}

export function Gate() {
  return (
    <figure className="cf-card cf-gate">
      <figcaption className="cf-card-head">
        <span>A trava de elegibilidade</span>
        <Origin kind="ensaio" />
      </figcaption>
      <div className="cf-gate-axis" style={{ "--gate": GATE / 10 } as Style}>
        <div className="cf-gate-line" aria-hidden="true" />
        <div className="cf-door" aria-hidden="true">
          <i className="cf-door-a" />
          <i className="cf-door-b" />
          <span className="cf-door-k mono">{br(GATE)}</span>
        </div>
        {GATE_EXAMPLES.map((g, i) => {
          const pass = g.grade >= GATE;
          return (
            <div
              key={g.number}
              className={`cf-gate-chg ${pass ? "is-pass" : "is-stop"}`}
              style={{ "--i": i, "--x": fix(g.grade / 10) } as Style}
            >
              <span className="cf-gate-dot" aria-hidden="true" />
              <span className="cf-gate-txt mono">
                <span className="cf-sr">{g.number}: nota </span>
                {g.approx ? "≈ " : ""}
                {br(g.grade, g.approx ? 0 : 2)}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="cf-gate-verdicts">
        {GATE_EXAMPLES.map((g) => {
          const pass = g.grade >= GATE;
          return (
            <li key={g.number} className={pass ? "is-pass" : "is-stop"}>
              {pass ? <Icons.checkCircle size={16} /> : <Icons.alert size={16} />}
              <span>
                <RecordTag number={g.number} size="sm" /> {g.verdict}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 2
// ---------------------------------------------------------------------------

const TOUCH_LABEL = {
  banco: "muda o banco",
  imagem: "muda a imagem",
  operação: "operação",
} as const;

export function Implementation() {
  return (
    <figure className="cf-card cf-doc">
      <figcaption className="cf-card-head">
        <span>CHG0031002 · Plano de implementação (trechos)</span>
        <Origin kind="demo" />
      </figcaption>
      <ol className="cf-doc-lines">
        {CHG2_IMPLEMENTATION.map((l, i) => (
          <li
            key={l.text}
            className={`is-${l.touches === "operação" ? "op" : l.touches}`}
            style={{ "--i": i } as Style}
          >
            <span className="cf-doc-t">
              <mark>{l.text}</mark>
            </span>
            <span className="cf-touch">{TOUCH_LABEL[l.touches]}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function Backout() {
  const checks = [
    { ok: true, t: "Volta a imagem de 3.8.0 para 3.7.4" },
    { ok: false, t: "Remove as colunas novas da tabela boleto_titulo" },
    { ok: false, t: "Desfaz a migração dos 1,9 milhão de boletos" },
  ];
  return (
    <figure className="cf-card cf-doc">
      <figcaption className="cf-card-head">
        <span>CHG0031002 · Plano de retorno</span>
        <Origin kind="demo" />
      </figcaption>
      <p className="cf-quote">{CHG2_BACKOUT}</p>
      <ul className="cf-checks">
        {checks.map((c, i) => (
          <li
            key={c.t}
            className={c.ok ? "is-ok" : "is-no"}
            style={{ "--i": i } as Style}
          >
            {c.ok ? <Icons.checkCircle size={16} /> : <Icons.close size={16} sw={2.5} />}
            <span>
              <span className="cf-sr">{c.ok ? "Sim: " : "Não: "}</span>
              {c.t}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function Tasks() {
  return (
    <figure className="cf-card cf-tasks">
      <figcaption className="cf-card-head">
        <span>Tarefas cadastradas × plano de retorno</span>
        <Origin kind="ilustrativo">ligação ilustrativa</Origin>
      </figcaption>
      <ul className="cf-task-list">
        {CHG2_TASKS.map((t, i) => (
          <li key={t.number} className={`is-${t.coverage}`} style={{ "--i": i } as Style}>
            <span className="cf-task-n mono">{t.number.slice(-2)}</span>
            <span className="cf-task-t">{t.text}</span>
            <span className="cf-cov">
              {t.coverage === "desfeita" ? (
                <Icons.check size={14} sw={2.5} />
              ) : t.coverage === "sem-volta" ? (
                <Icons.alert size={14} />
              ) : (
                <Icons.dot size={14} />
              )}
              {COVERAGE_LABEL[t.coverage]}
            </span>
          </li>
        ))}
      </ul>
      <p className="cf-card-foot">A ligação tarefa a tarefa é só para explicar.</p>
    </figure>
  );
}

export function Coherence() {
  return (
    <figure className="cf-card cf-coh">
      <figcaption className="cf-card-head">
        <span>CHG0031002 · duas notas</span>
        <Origin kind="ensaio" />
      </figcaption>
      <div className="cf-coh-rows">
        <div className="cf-coh-row is-high" style={{ "--v": 0.904, "--i": 0 } as Style}>
          <span className="cf-coh-l">Média ponderada</span>
          <span className="cf-bar-track" aria-hidden="true">
            <i className="cf-bar" />
          </span>
          <b className="mono">9,04</b>
        </div>
        <div
          className="cf-coh-row is-low"
          style={{ "--v": CHG2_COHERENCE / 10, "--i": 1 } as Style}
        >
          <span className="cf-coh-l">Coerência</span>
          <span className="cf-bar-track" aria-hidden="true">
            <i className="cf-bar" />
          </span>
          <b className="mono">{br(CHG2_COHERENCE)}</b>
        </div>
      </div>
      <p className="cf-problem">
        <Icons.alert size={16} />
        <span>
          O plano de retorno não desfaz a alteração da tabela nem a migração dos dados. Se
          precisar voltar às três da manhã, não funciona.
        </span>
      </p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 3
// ---------------------------------------------------------------------------

export function Load() {
  const fields = [
    { k: "Categoria", v: INCIDENT.category },
    { k: "Subcategoria", v: INCIDENT.subcategory },
    { k: "Empresa", v: INCIDENT.empresa },
  ];
  return (
    <figure className="cf-card cf-inc">
      <figcaption className="cf-card-head">
        <RecordTag number={INCIDENT.number} size="sm" />
        <Origin kind="demo" />
      </figcaption>
      <p className="cf-inc-title">{INCIDENT.title}</p>
      <p className="cf-inc-desc">{INCIDENT.description}</p>
      <dl className="cf-fields">
        {fields.map((f, i) => (
          <div key={f.k} style={{ "--i": i } as Style}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
        <div style={{ "--i": 3 } as Style}>
          <dt>Tags</dt>
          <dd className="cf-tags">
            {INCIDENT.tags.map((t) => (
              <span key={t} className="cf-tag mono">
                {t}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </figure>
  );
}

export function Summarize() {
  return (
    <figure className="cf-card cf-sum">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <ConceptLabel concept="ai-step" />
          Do texto para o resumo
        </span>
        <Origin kind="ilustrativo">resumo de exemplo</Origin>
      </figcaption>
      <div className="cf-sum-from">
        <p className="cf-sum-k">
          Texto original · <b className="mono">{words(INCIDENT.description)}</b> palavras
        </p>
        <p className="cf-sum-raw">{INCIDENT.description}</p>
      </div>
      <Icons.arrowRight className="cf-sum-arrow" />
      <div className="cf-sum-to">
        <p className="cf-sum-k">
          Resumo da IA · <b className="mono">{words(EXAMPLE_SUMMARY)}</b> palavras
        </p>
        <p className="cf-sum-out">{EXAMPLE_SUMMARY}</p>
      </div>
    </figure>
  );
}

export function Vectorize() {
  const bars = fingerprint(48);
  return (
    <figure className="cf-card cf-vec">
      <figcaption className="cf-card-head">
        <span>A consulta vira um vetor</span>
        <Origin kind="ilustrativo">números ilustrativos</Origin>
      </figcaption>
      <pre className="cf-query">{queryText(EXAMPLE_SUMMARY)}</pre>
      <div
        className="cf-fp"
        role="img"
        aria-label="Impressão digital do vetor: barras para cima e para baixo"
      >
        {bars.map((v, i) => (
          <i
            key={i}
            className={v >= 0 ? "up" : "down"}
            style={{ "--i": i, "--v": fix(Math.abs(v)) } as Style}
          />
        ))}
      </div>
      <p className="cf-card-foot">
        O vetor real tem <b className="mono">{EMBEDDING.dims.toLocaleString("pt-BR")}</b>{" "}
        números. Aqui, 48 ilustrativos.
      </p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 4
// ---------------------------------------------------------------------------

/** Which cells of the 336-record grid share a tag (spread, deterministic). */
function tagCells(): boolean[] {
  const total = TAG_FUNNEL.incidents + TAG_FUNNEL.problems;
  const match = TAG_FUNNEL.matchIncidents + TAG_FUNNEL.matchProblems;
  const order = Array.from({ length: total }, (_, i) => i).sort(
    (a, b) => seeded(a + 101) - seeded(b + 101),
  );
  const hit = new Set(order.slice(0, match));
  return Array.from({ length: total }, (_, i) => hit.has(i));
}

export function TagFilter() {
  const cells = tagCells();
  const total = cells.length;
  const match = TAG_FUNNEL.matchIncidents + TAG_FUNNEL.matchProblems;
  return (
    <figure className="cf-card cf-tagf">
      <figcaption className="cf-card-head">
        <span>Camada 1 · tags</span>
        <Origin kind="demo">contagem do demo</Origin>
      </figcaption>
      <div
        className="cf-grid"
        role="img"
        aria-label={`${total} registros resolvidos; ${match} dividem uma tag com o incidente`}
      >
        {cells.map((hit, i) => (
          <i
            key={i}
            className={hit ? "hit" : "miss"}
            style={{ "--r": Math.floor(i / 24) } as Style}
          />
        ))}
      </div>
      <p className="cf-count">
        <b className="mono">{total}</b> registros resolvidos{" "}
        <Icons.arrowRight size={14} /> <b className="mono">{match}</b> com{" "}
        {INCIDENT.tags.map((t, i) => (
          <span key={t}>
            <span className="cf-tag mono">{t}</span>
            {i < INCIDENT.tags.length - 2
              ? ", "
              : i === INCIDENT.tags.length - 2
                ? " ou "
                : ""}
          </span>
        ))}
      </p>
      <p className="cf-card-foot">
        Sobram {TAG_FUNNEL.matchIncidents} incidentes e {TAG_FUNNEL.matchProblems}{" "}
        problemas.
      </p>
    </figure>
  );
}

export function Ruler() {
  const f = funnel();
  const floorX = rulerPos(RETRIEVAL.floor);
  return (
    <figure className="cf-card cf-ruler">
      <figcaption className="cf-card-head">
        <span>Camada 2 · semelhança de cosseno</span>
        <Origin kind="ilustrativo">similaridades ilustrativas</Origin>
      </figcaption>
      <div className="cf-ruler-plot" style={{ "--floor": floorX } as Style}>
        <div className="cf-ruler-out" aria-hidden="true" />
        <div className="cf-ruler-floor" aria-hidden="true">
          <span className="mono">{br(RETRIEVAL.floor, 2)}</span>
        </div>
        <ul className="cf-ruler-rows">
          {CANDIDATES.map((c, i) => {
            const pass = c.sim >= RETRIEVAL.floor;
            return (
              <li
                key={c.number}
                className={pass ? "is-pass" : "is-out"}
                style={{ "--i": i, "--x": fix(rulerPos(c.sim)) } as Style}
              >
                <span className="cf-rec">
                  <RecordTag number={c.number} size="sm" ghost />
                </span>
                <span className="cf-ruler-lane">
                  <span className="cf-ruler-dot" />
                </span>
                {/* The value sits in its own column: inside the plot it ran
                    into the 0,80 line and its neighbors on a phone. */}
                <span className="cf-ruler-v mono">{br(c.sim, 2)}</span>
                <span className="cf-sr">{pass ? "passou" : "abaixo do limiar"}</span>
              </li>
            );
          })}
        </ul>
        <div className="cf-ruler-ticks mono" aria-hidden="true">
          <span>0,50</span>
          <span>1,00</span>
        </div>
      </div>
      <p className="cf-count">
        <b className="mono">{f.found}</b> candidatos <Icons.arrowRight size={14} />{" "}
        <b className="mono">{f.passed}</b> passaram de {br(RETRIEVAL.floor, 2)}
      </p>
    </figure>
  );
}

export function PostFilter() {
  const f = funnel();
  const passed = CANDIDATES.filter((c) => c.sim >= RETRIEVAL.floor);
  return (
    <figure className="cf-card cf-pf">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <ConceptLabel concept="ai-step" />
          Camada 3 · a IA confere
        </span>
        <Origin kind="ilustrativo">vereditos ilustrativos</Origin>
      </figcaption>
      <ul className="cf-pf-list">
        {passed.map((c, i) => {
          const keep = c.verdict === "mantido";
          return (
            <li
              key={c.number}
              className={keep ? "is-keep" : "is-drop"}
              style={{ "--i": i } as Style}
            >
              <span className="cf-rec">
                <RecordTag number={c.number} size="sm" ghost />
              </span>
              <span className="cf-pf-reason">{c.reason}</span>
              <span className="cf-pf-v">
                {keep ? (
                  <Icons.check size={14} sw={2.5} />
                ) : (
                  <Icons.close size={14} sw={2.5} />
                )}
                {keep ? "mantido" : "descartado"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="cf-count">
        <b className="mono">{f.found}</b> <Icons.arrowRight size={14} />{" "}
        <b className="mono">{f.passed}</b> <Icons.arrowRight size={14} />{" "}
        <b className="mono">{f.kept}</b> casos viram contexto
      </p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 5
// ---------------------------------------------------------------------------

export function Classify() {
  return (
    <figure className="cf-card cf-cls">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <ConceptLabel concept="ai-step" />
          Procedente ou improcedente?
        </span>
        <Origin kind="demo">registros do demo</Origin>
      </figcaption>
      <ul className="cf-cls-list">
        <li className="is-yes" style={{ "--i": 0 } as Style}>
          <span className="cf-cls-rec">
            <RecordTag number={INCIDENT.number} size="sm" />
            <span>{INCIDENT.title}</span>
          </span>
          <span className="cf-cls-v">
            <Icons.checkCircle size={16} />
            Procedente: segue para a sugestão
          </span>
        </li>
        <li className="is-no" style={{ "--i": 1 } as Style}>
          <span className="cf-cls-rec">
            <RecordTag number={IMPROCEDENTE.number} size="sm" />
            <span>{IMPROCEDENTE.title}</span>
          </span>
          <span className="cf-cls-v">
            <Icons.alert size={16} />
            Improcedente: é um pedido, sem sugestão
          </span>
        </li>
      </ul>
    </figure>
  );
}

export function Suggest() {
  return (
    <figure className="cf-card cf-sug">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <ConceptLabel concept="ai-out" />
          Assistente da IA · sugestão de resolução
        </span>
        <Origin kind="ilustrativo">texto de exemplo</Origin>
      </figcaption>
      <p className="cf-sug-text">
        {SUGGESTION.map((s, i) =>
          s.cite ? (
            <span
              key={i}
              className={`cf-cite mono${s.removed ? " is-removed" : ""}`}
              style={{ "--i": i } as Style}
            >
              {s.removed ? <span className="cf-sr">Citação removida: </span> : null}
              {s.cite}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
      <p className="cf-card-foot cf-sug-foot">
        <Icons.close size={14} sw={2.5} />
        <span>
          <b className="mono">INC0051234</b> saiu: não veio da busca.
        </span>
      </p>
    </figure>
  );
}

export function Publish() {
  return (
    <figure className="cf-card cf-pub">
      <figcaption className="cf-card-head">
        <span className="cf-head-k">
          <RecordTag number={INCIDENT.number} size="sm" /> Atividade
        </span>
        <Origin kind="ilustrativo">nota nova de exemplo</Origin>
      </figcaption>
      <ol className="cf-feed">
        <li className="cf-note is-new">
          <span className="cf-note-who">
            <ConceptLabel concept="ai-out">
              Assistente da IA · nota de trabalho
            </ConceptLabel>
          </span>
          <span className="cf-note-t">
            Sugestão de resolução, com 3 fontes citadas: PRB0004105, PRB0004104 e
            INC0052226.
          </span>
        </li>
        <li className="cf-note">
          <span className="cf-note-who">Nota de trabalho</span>
          <span className="cf-note-t">{INCIDENT.workNote}</span>
        </li>
      </ol>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 6: one map that changes with the step
// ---------------------------------------------------------------------------

const POINTS = miniMap();

export function ClusterStage({ idx, total }: { idx: number; total: number }) {
  const at = idx >= total ? total : idx;
  const gathered = at >= 1;
  const colored = at >= 2;
  const named = at >= 3;
  const promoted = at >= 4;
  const status = [
    "Cada incidente é um ponto",
    "Os parecidos se aproximam",
    `${MINI_GROUPS.length} grupos e ${POINTS.filter((p) => p.group < 0).length} casos isolados`,
    "Cada grupo ganha um nome",
    "Um grupo vira um Problema",
  ][Math.max(0, Math.min(at, 4))];
  return (
    <figure className="cf-card cf-map-card">
      <figcaption className="cf-card-head">
        <span>Mapa de incidentes</span>
        <Origin kind="ilustrativo">mapa ilustrativo, rótulos do demo</Origin>
      </figcaption>
      <div
        className={`cf-map${gathered ? " is-gathered" : ""}${colored ? " is-colored" : ""}${named ? " is-named" : ""}${promoted ? " is-promoted" : ""}`}
        role="img"
        aria-label={status}
      >
        {POINTS.map((p) => (
          <i
            key={p.i}
            className={`cf-pt${p.group < 0 ? " is-iso" : ""}${p.group === MINI_GROUPS[0].id ? " is-first" : ""}`}
            style={
              {
                "--sx": fix(p.sx),
                "--sy": fix(p.sy),
                "--tx": fix(p.tx),
                "--ty": fix(p.ty),
                "--i": p.i % 10,
                "--c": clusterColor(p.group, p.group < 0),
              } as Style
            }
          />
        ))}
        {MINI_GROUPS.map((g, i) => (
          <span
            key={g.id}
            className={`cf-map-label${i === 0 ? " is-first" : ""}`}
            style={
              { "--x": g.cx, "--y": g.cy, "--i": i, "--c": clusterColor(g.id) } as Style
            }
          >
            {g.label}
            {i === 0 ? <b className="cf-prb-chip mono">PRB</b> : null}
          </span>
        ))}
        <span className="cf-map-status">{status}</span>
      </div>
      <p className="cf-legend">
        <span>
          <i className="cf-sw" style={{ background: clusterColor(MINI_GROUPS[0].id) }} />{" "}
          cada cor é um grupo
        </span>
        <span>
          <i className="cf-sw" style={{ background: clusterColor(-1, true) }} /> cinza:
          caso isolado
        </span>
      </p>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Chapter 7
// ---------------------------------------------------------------------------

export function ProblemCard() {
  return (
    <figure className="cf-card cf-prb">
      <figcaption className="cf-card-head">
        <RecordTag number={PROBLEM.number} size="sm" />
        <Origin kind="demo" />
      </figcaption>
      <p className="cf-inc-title">{PROBLEM.title}</p>
      <dl className="cf-fields cf-prb-f">
        <div style={{ "--i": 0 } as Style}>
          <dt>Estado</dt>
          <dd>{PROBLEM.state}</dd>
        </div>
        <div style={{ "--i": 1 } as Style}>
          <dt>Incidentes ligados</dt>
          <dd className="mono">{PROBLEM.linked}</dd>
        </div>
        <div className="is-wide" style={{ "--i": 2 } as Style}>
          <dt>Causa raiz</dt>
          <dd>{PROBLEM.rootCause}</dd>
        </div>
      </dl>
    </figure>
  );
}

const LOOP = [
  { k: "chg", t: "Mudança" },
  { k: "dep", t: "Deploy" },
  { k: "inc", t: "Incidente" },
  { k: "rec", t: "Recorrência" },
  { k: "prb", t: "Problema" },
] as const;

export function Loop() {
  return (
    <figure className="cf-card cf-loop">
      <figcaption className="cf-card-head">
        <span>Da correção para uma nova Mudança</span>
        <Origin kind="fora" />
      </figcaption>
      <p className="cf-quote">
        <span className="cf-quote-k">Correção definitiva do {PROBLEM.number}</span>
        {PROBLEM.permanentFix}
      </p>
      <ol
        className="cf-ring"
        aria-label="O ciclo: Mudança, deploy, incidente, recorrência, problema e de volta à Mudança"
      >
        {LOOP.map((n, i) => (
          <li key={n.k} className={`cf-ring-n is-${n.k}`} style={{ "--i": i } as Style}>
            <span>{n.t}</span>
          </li>
        ))}
        <li className="cf-ring-back" style={{ "--i": 5 } as Style}>
          <Icons.replay size={14} />
          <span>nova Mudança, mesmo juiz</span>
        </li>
      </ol>
      <p className="cf-card-foot">A Mudança da correção fica fora do demo.</p>
    </figure>
  );
}

export function BackToSearch() {
  const c = CANDIDATES[0];
  return (
    <figure className="cf-card cf-back">
      <figcaption className="cf-card-head">
        <span>Próximo incidente de login depois de um deploy</span>
        <Origin kind="ilustrativo">similaridade ilustrativa</Origin>
      </figcaption>
      <ol className="cf-back-flow">
        <li style={{ "--i": 0 } as Style}>
          <span className="cf-back-k">Busca</span>
          <span>
            Problemas resolvidos e conhecidos ficam numa coleção própria, com até{" "}
            {RETRIEVAL.problemTopK} por busca.
          </span>
        </li>
        <li style={{ "--i": 1 } as Style}>
          <span className="cf-back-k">Encontra</span>
          <span>
            <RecordTag number={c.number} size="sm" ghost /> com{" "}
            <b className="mono">{br(c.sim, 2)}</b>, mantido pela conferência.
          </span>
        </li>
        <li style={{ "--i": 2 } as Style}>
          <span className="cf-back-k">Cita</span>
          <span>A sugestão já nasce com a causa raiz e a correção como fonte.</span>
        </li>
      </ol>
    </figure>
  );
}
