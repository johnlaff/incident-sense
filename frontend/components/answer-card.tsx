"use client";

// The answer first: what the AI suggests for this incident, in three fixed
// blocks (Em uma frase, Passos sugeridos, Com base em), with how sure it is in
// words, what it looked at, and the known Problem on top when there is one.
// How it got there folds below, in the pipeline.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ConceptIcon, ConceptLabel, RecordTag, TechDetails } from "./concepts";
import { Icons } from "./icons";
import { SuggestionMarkdown } from "./markdown";
import { useFocusTrap, useScrollLock } from "@/lib/a11y";
import {
  analysedCounts,
  answerPlain,
  closestHit,
  confidenceOf,
  parseSuggestion,
  sourceExcerpt,
  stepLayers,
  type ParsedAnswer,
} from "@/lib/answer";
import { buildSuggestionMarkdown, markdownToPlain } from "@/lib/model";
import { OUTCOME_LABEL, citationSource, formatSim } from "@/lib/pipeline";
import { problemState, useProblems } from "@/lib/problems";
import type { SuggestResponse } from "@/lib/types";

export type CiteHandler = (n: string, el?: HTMLElement) => void;

export function AnswerCard({
  result,
  modelName,
  onCite,
  onInsert,
  onCopy,
  onShowNotes,
}: {
  result: SuggestResponse;
  modelName: string;
  /** Opens the full record (drawer). */
  onCite: CiteHandler;
  onInsert?: (text: string) => void;
  onCopy?: (text: string) => void;
  onShowNotes: () => void;
}) {
  const parsed = useMemo(
    () => (result.suggestion ? parseSuggestion(result.suggestion) : null),
    [result.suggestion],
  );
  const confidence = confidenceOf(result);
  const counts = analysedCounts(result);
  const [sheet, setSheet] = useState<string | null>(null);
  const [vote, setVote] = useState<"util" | "nao" | null>(null);
  const { data: problems } = useProblems();

  // A Problem the search kept whose state is "Erro conhecido": its workaround
  // is the first thing to try, so it opens the card.
  const known = useMemo(() => {
    const states = new Map((problems ?? []).map((p) => [p.number, p.state]));
    return (
      result.problems.find(
        (p) =>
          p.survived_postfilter &&
          problemState(states.get(p.number) ?? "").tone === "known" &&
          result.citations.cited.includes(p.number),
      ) ?? null
    );
  }, [problems, result]);

  const plain = parsed ? answerPlain(parsed) : markdownToPlain(result.suggestion ?? "");

  const scope = (
    <AnalysedLine result={result} counts={counts} onOpen={(id) => setSheet(id)} />
  );

  if (!result.suggestion) {
    const improcedente = result.classification !== "PROCEDENTE";
    const near = closestHit(result);
    return (
      <section className="ans is-empty" aria-labelledby="ans-h">
        <div className="ans-head">
          <h3 id="ans-h" className="ans-title">
            <ConceptLabel concept="ai-out" />
          </h3>
          <ConfidenceTag level="baixa" label="Sem evidência suficiente" />
        </div>
        {scope}
        {improcedente ? (
          <>
            <p className="ans-one">Não é uma falha técnica: é um pedido do cliente.</p>
            <p className="ans-note">
              Por isso a IA não sugere uma correção. O melhor caminho é orientar o cliente
              pelo autoatendimento.
            </p>
          </>
        ) : (
          <>
            <p className="ans-one">Não achei casos parecidos o bastante para sugerir.</p>
            <p className="ans-note">
              {near
                ? `O mais próximo foi ${near.number}, com semelhança ${formatSim(near.similarity)}; o mínimo para usar um caso é ${formatSim(result.retrieval.vector.min_similarity)}.`
                : "A busca não trouxe nenhum caso."}{" "}
              Resolva manualmente e registre a solução: ela ajuda nos próximos casos.
            </p>
          </>
        )}
        <HumanDecides result={result} onShowNotes={onShowNotes} />
        {sheet ? (
          <SourceSheet
            id={sheet}
            result={result}
            onClose={() => setSheet(null)}
            onOpenRecord={onCite}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="ans" aria-labelledby="ans-h">
      <div className="ans-head">
        <h3 id="ans-h" className="ans-title">
          <ConceptLabel concept="ai-out" />
          <span className="ans-sub">Revise antes de usar.</span>
        </h3>
        <ConfidenceTag level={confidence.level} label={confidence.label} />
      </div>
      {scope}

      {known ? (
        <div className="ans-known">
          <div className="ans-known-head">
            <span className="ans-known-k">Erro conhecido</span>
            <button
              type="button"
              className="tag-btn"
              onClick={() => setSheet(known.number)}
              aria-label={`Ver o trecho de ${known.number}`}
            >
              <RecordTag number={known.number} size="sm" />
            </button>
          </div>
          <p>
            <b>Contorno:</b> {known.workaround}
          </p>
        </div>
      ) : null}

      {parsed ? (
        <ParsedBlocks parsed={parsed} onSource={(id) => setSheet(id)} />
      ) : (
        <div className="ans-block">
          <SuggestionMarkdown
            source={buildSuggestionMarkdown(result.suggestion, result.context_ids)}
            onCite={(id) => setSheet(id)}
            flashCite={null}
          />
        </div>
      )}

      <SourcesBlock result={result} onOpen={onCite} />

      <HumanDecides result={result} onShowNotes={onShowNotes}>
        {onCopy || onInsert ? (
          <div className="ans-actions">
            {onCopy ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onCopy(plain)}
              >
                <Icons.copy />
                Copiar
              </button>
            ) : null}
            {onInsert ? (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onInsert(plain)}
              >
                <Icons.insert />
                Usar como nota
              </button>
            ) : null}
          </div>
        ) : null}
      </HumanDecides>

      <div className="ans-vote" role="group" aria-labelledby="ans-vote-q">
        <span id="ans-vote-q" className="ans-vote-q">
          A sugestão ajudou?
        </span>
        {vote ? (
          <span className="ans-thanks" role="status">
            Obrigado. Sua resposta fica só neste navegador.
          </span>
        ) : (
          <span className="ans-vote-btns">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setVote("util")}
            >
              <Icons.thumbUp />
              Útil
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setVote("nao")}
            >
              <Icons.thumbDown />
              Não útil
            </button>
          </span>
        )}
      </div>

      <TechDetails summary="Detalhes técnicos">
        <p>
          Gerado por <b>{modelName}</b>.
        </p>
      </TechDetails>

      {sheet ? (
        <SourceSheet
          id={sheet}
          result={result}
          onClose={() => setSheet(null)}
          onOpenRecord={onCite}
        />
      ) : null}
    </section>
  );
}

function ConfidenceTag({ level, label }: { level: string; label: string }) {
  const word = level === "alta" ? "alta" : level === "media" ? "média" : "baixa";
  return (
    <span className={`ans-conf is-${level}`}>
      <span className="ans-conf-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        Confiança {word}: <b>{label.toLowerCase()}</b>
      </span>
    </span>
  );
}

function AnalysedLine({
  result,
  counts,
  onOpen,
}: {
  result: SuggestResponse;
  counts: { incidents: number; problems: number };
  onOpen: (id: string) => void;
}) {
  const hits = [
    ...result.retrieval.vector.incidents,
    ...result.retrieval.vector.problems,
  ].filter((h) => h.passed);
  const inc = counts.incidents === 1 ? "incidente parecido" : "incidentes parecidos";
  const prb = counts.problems === 1 ? "Problema" : "Problemas";
  return (
    <details className="ans-scope">
      <summary>
        <Icons.chevronRight />
        Analisei {counts.incidents} {inc} e {counts.problems} {prb}
      </summary>
      {hits.length ? (
        <ul>
          {hits.map((h) => (
            <li key={h.number}>
              <button
                type="button"
                className="tag-btn"
                onClick={() => onOpen(h.number)}
                aria-label={`Ver o trecho de ${h.number}`}
              >
                <RecordTag number={h.number} size="sm" ghost={h.kind === "incidente"} />
              </button>
              <span className="ans-scope-d">{h.short_description}</span>
              <span className="ans-scope-s">semelhança {formatSim(h.similarity)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ans-note">Nenhum passou do mínimo de semelhança.</p>
      )}
    </details>
  );
}

function ParsedBlocks({
  parsed,
  onSource,
}: {
  parsed: ParsedAnswer;
  onSource: (id: string) => void;
}) {
  // Each step reads as its plain action first; the technical text behind it
  // opens for all steps at once.
  const [tech, setTech] = useState(false);
  const layers = parsed.steps.map(stepLayers);
  const hasTech = layers.some((l) => l.rest);
  return (
    <>
      <div className="ans-block">
        <h4 className="ans-label">Em uma frase</h4>
        <p className="ans-one">{parsed.oneLine}</p>
      </div>
      <div className="ans-block">
        <h4 className="ans-label">Passos sugeridos</h4>
        <ol className="ans-steps">
          {parsed.steps.map((s, i) => (
            <li key={i}>
              <span className="ans-step-n mono" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="ans-step-lead">
                  {layers[i].lead}{" "}
                  {s.cites.length ? (
                    <StepSources ids={s.cites} onSource={onSource} />
                  ) : null}
                </p>
                {tech && layers[i].rest ? (
                  <p className="ans-step-rest">{layers[i].rest}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {hasTech ? (
          <button
            type="button"
            className="ans-tech-btn"
            aria-expanded={tech}
            onClick={() => setTech((v) => !v)}
          >
            <Icons.chevronRight />
            {tech ? "Esconder o texto técnico" : "Ler o texto técnico"}
          </button>
        ) : null}
        {parsed.more ? (
          <p className="ans-note">
            A IA escreveu mais {parsed.more} {parsed.more === 1 ? "passo" : "passos"}; o
            texto completo está em Como a IA chegou nisso.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** "Fonte" under a step: the first record, then "+N" for the rest. The
 *  "Com base em" heading is said once, on the block below the steps. */
function StepSources({
  ids,
  onSource,
}: {
  ids: string[];
  onSource: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? ids : ids.slice(0, 1);
  return (
    <span className="ans-step-src">
      <span className="ans-step-src-k">{ids.length > 1 ? "Fontes" : "Fonte"}</span>
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          className="tag-btn"
          onClick={() => onSource(id)}
          aria-label={`Ver o trecho de ${id}`}
        >
          <RecordTag number={id} size="sm" ghost={!id.startsWith("PRB")} />
        </button>
      ))}
      {!all && ids.length > 1 ? (
        <button
          type="button"
          className="ans-more"
          onClick={() => setAll(true)}
          aria-label={`Mostrar mais ${ids.length - 1} fontes`}
        >
          +{ids.length - 1}
        </button>
      ) : null}
    </span>
  );
}

/** "Com base em": every record the answer cites, with how similar it was.
 *  One link per row opens the record itself. */
function SourcesBlock({
  result,
  onOpen,
}: {
  result: SuggestResponse;
  onOpen: CiteHandler;
}) {
  const cited = result.citations.cited;
  if (!cited.length) return null;
  return (
    <div className="ans-block">
      <h4 className="ans-label">Com base em</h4>
      <ul className="ans-sources">
        {cited.map((id) => {
          const { row, inContext } = citationSource(id, result);
          return (
            <li key={id}>
              <button
                type="button"
                className="ans-src-open"
                onClick={(e) => onOpen(id, e.currentTarget)}
              >
                <span className="ans-src-link">Abrir {id}</span>
                <span className="ans-src-what">
                  {row ? (
                    <>
                      semelhança <b className="num">{formatSim(row.sim)}</b>
                      {row.outcome === "mantido-fallback"
                        ? ` · ${OUTCOME_LABEL[row.outcome]}`
                        : null}
                    </>
                  ) : inContext ? (
                    "entre os casos encontrados"
                  ) : (
                    "fora dos casos encontrados"
                  )}
                </span>
                <Icons.chevronRight className="ans-src-go" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="ans-note">Semelhança de 0 a 1: perto de 1, mais parecido.</p>
    </div>
  );
}

function HumanDecides({
  result,
  onShowNotes,
  children,
}: {
  result: SuggestResponse;
  onShowNotes: () => void;
  /** What the person can do with the answer (copy, use as a note). */
  children?: ReactNode;
}) {
  return (
    <div className="pipe-human ans-human">
      <ConceptIcon concept="human" />
      <div className="ans-human-body">
        <p>
          <b>Agora é com você:</b> confira as fontes e decida. A IA não resolve sozinha.
        </p>
        {children}
        {result.publication.published ? (
          <button type="button" className="ans-notes-link" onClick={onShowNotes}>
            <Icons.list />
            Ver a nota que a IA deixou no histórico
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Bottom sheet (a dialog on wide screens): the exact text the AI used. */
function SourceSheet({
  id,
  result,
  onClose,
  onOpenRecord,
}: {
  id: string;
  result: SuggestResponse;
  onClose: () => void;
  onOpenRecord: CiteHandler;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  useScrollLock(true);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ex = sourceExcerpt(id, result);
  const problem = id.startsWith("PRB");
  return (
    <>
      <div className="src-sheet-scrim" onClick={onClose} />
      <div
        className="src-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="src-sheet-h"
        ref={ref}
      >
        <div className="src-sheet-head">
          <RecordTag number={id} />
          {ex?.similarity != null ? (
            <span className="src-sheet-sim">
              semelhança <b className="num">{formatSim(ex.similarity)}</b>
            </span>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Fechar"
          >
            <Icons.close />
          </button>
        </div>
        <h3 id="src-sheet-h" className="src-sheet-title">
          {ex?.title ?? id}
        </h3>
        {ex && ex.parts.length ? (
          <>
            <p className="src-sheet-k">O trecho que a IA leu</p>
            {ex.parts.map((p) => (
              <blockquote key={p.label} className="src-sheet-q">
                <b>{p.label}:</b> {p.text}
              </blockquote>
            ))}
          </>
        ) : (
          <p className="ans-note">Este registro não trouxe texto de solução.</p>
        )}
        {ex?.reason ? (
          <p className="src-sheet-why">
            <b>Por que a IA usou:</b> {ex.reason}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={(e) => {
            onClose();
            onOpenRecord(id, e.currentTarget);
          }}
        >
          {problem ? "Abrir o Problema" : "Abrir o incidente"}
          <Icons.arrowRight />
        </button>
      </div>
    </>
  );
}
