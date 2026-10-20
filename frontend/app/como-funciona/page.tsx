"use client";

// "Como funciona": the whole lifecycle after the deploy, as the talk "Depois
// do Deploy" tells it and as the demo does it. Seven chapters: the Change
// graded before it ships, the incident after it breaks (seven steps), the
// recurrences that become a Problem, and the Problem that closes the loop.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useAula } from "@/components/aula";
import { Icons } from "@/components/icons";
import { Meridian } from "@/components/ui";
import { aulaKeyAction } from "@/lib/aula-machine";
import { usePrefersReducedMotion } from "@/lib/motion";

import { ChapterView, Origin, type ChapterSignal } from "./chapter";
import {
  CHAPTERS,
  CLUSTERS_DEMO,
  EMBEDDING,
  GATE,
  PARTS,
  RETRIEVAL,
  RUBRIC_VERSION,
  SOURCES,
  TOTAL_WEIGHT,
  br,
  type PartKey,
} from "./story";
import {
  Average,
  BackToSearch,
  Backout,
  Classify,
  ClusterStage,
  Coherence,
  ContentLock,
  Gate,
  Implementation,
  Load,
  Loop,
  Parallel,
  PostFilter,
  ProblemCard,
  Publish,
  Ruler,
  Suggest,
  Summarize,
  TagFilter,
  Tasks,
  Vectorize,
  Weights,
} from "./visuals";

import "./como-funciona.css";

function Tech({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="cf-tech-list">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Cite({ who }: { who: keyof typeof SOURCES }) {
  const s = SOURCES[who];
  return <cite className="cf-cite-link">{s.label}</cite>;
}

const CONTENT: Record<
  string,
  {
    visuals?: ReactNode[];
    stage?: (idx: number, total: number) => ReactNode;
    details: ReactNode;
    source?: ReactNode;
  }
> = {
  "cap-1": {
    visuals: [
      <Weights key="w" />,
      <Parallel key="p" />,
      <Average key="a" />,
      <ContentLock key="l" />,
      <Gate key="g" />,
    ],
    source: (
      <>
        Pico de 1.084 Changes em um dia, segundo o <Cite who="solange" />.
      </>
    ),
    details: (
      <Tech
        rows={[
          [
            "Padrão",
            "LLM-as-judge: o modelo não escreve, ele avalia o texto de uma pessoa.",
          ],
          [
            "Grade",
            <>
              <span className="mono">
                backend/src/incident_sense/changes/rubrica.toml
              </span>
              , versão {RUBRIC_VERSION}, sete campos, soma {br(TOTAL_WEIGHT)}, corte{" "}
              {br(GATE)}. Mudar o critério é um pull request, não um release.
            </>,
          ],
          [
            "Modelo",
            "O escolhido na tela; o padrão é Claude Haiku 5.5 pela OpenRouter, com temperatura 0.",
          ],
          [
            "Paralelo",
            "No demo, uma thread por campo (ThreadPoolExecutor em Python). No banco, Virtual Threads do Java 21, segundo o artigo.",
          ],
          [
            "Trava de conteúdo",
            "Chave = versão da grade + modelo + Change + campo + hash SHA-256 do texto normalizado. Mesma chave, mesma nota, zero chamada.",
          ],
          [
            "Escopo",
            "Só Change Normal, estado Novo, empresa Banco Meridiano. Fora disso aparece como não avaliada, nunca como zero.",
          ],
          [
            "Fora do demo",
            "No banco a avaliação dispara sozinha por um evento de mensageria quando a Change é submetida. No demo, você clica em avaliar.",
          ],
        ]}
      />
    ),
  },
  "cap-2": {
    visuals: [
      <Implementation key="i" />,
      <Backout key="b" />,
      <Tasks key="t" />,
      <Coherence key="c" />,
    ],
    source: <>As notas 9,04 e 4 saíram no ensaio e podem mudar com o modelo.</>,
    details: (
      <Tech
        rows={[
          [
            "Quando roda",
            `Só se a média do preenchimento for ${br(GATE)} ou mais (trava de elegibilidade).`,
          ],
          [
            "Entrada",
            "Um prompt só, com os sete campos, o plano de retorno e as tarefas cadastradas.",
          ],
          [
            "Saída",
            "Nota de coerência de 0 a 10, lista de problemas, raciocínio, orientação ao autor, aderência do retorno às tarefas (aderente, parcial ou não aderente) e o percentual.",
          ],
          [
            "Cache",
            "A análise também tem trava de conteúdo: muda só se algum campo ou o plano de retorno mudar.",
          ],
          [
            "Limite",
            "A nota julga o texto, não a mudança. Nota alta não é execução segura.",
          ],
        ]}
      />
    ),
  },
  "cap-3": {
    visuals: [<Load key="l" />, <Summarize key="s" />, <Vectorize key="v" />],
    details: (
      <Tech
        rows={[
          [
            "Gatilho",
            "No demo, o botão de pedir sugestão. No banco, o incidente que chega.",
          ],
          ["Resumo", "Feito pelo modelo de chat escolhido (padrão Claude Haiku 5.5)."],
          [
            "Consulta",
            "Resumo + Categoria + Subcategoria + Empresa, uma linha cada. Nunca o texto cru.",
          ],
          [
            "Embedding",
            <>
              <span className="mono">{EMBEDDING.model}</span>,{" "}
              {EMBEDDING.dims.toLocaleString("pt-BR")} dimensões. A tela do pipeline
              mostra os 24 primeiros números que a API devolve.
            </>,
          ],
          [
            "Mesma chave",
            "Uma chave da OpenRouter serve para o chat e para os embeddings.",
          ],
        ]}
      />
    ),
  },
  "cap-4": {
    visuals: [<TagFilter key="t" />, <Ruler key="r" />, <PostFilter key="p" />],
    source: (
      <>
        Corte e top-K do <Cite who="joao" />.
      </>
    ),
    details: (
      <Tech
        rows={[
          [
            "Camada 1",
            "Tags do próprio incidente; se não houver, as escolhidas pela IA no resumo; se não, as usuais da categoria. Fica quem divide pelo menos uma tag.",
          ],
          [
            "Camada 2",
            <>
              Qdrant em memória, distância de cosseno, piso{" "}
              <span className="mono">RETRIEVAL_MIN_SIMILARITY = {RETRIEVAL.floor}</span>,
              top-K <span className="mono">{RETRIEVAL.incidentTopK}</span> incidentes e{" "}
              <span className="mono">{RETRIEVAL.problemTopK}</span> problemas, em coleções
              separadas.
            </>,
          ],
          [
            "Camada 3",
            "Um LLM julga cada candidato e devolve mantido ou descartado, com o motivo.",
          ],
          [
            "Se falhar",
            "Timeout ou resposta inválida na camada 3: volta a lista da camada 2. Perde precisão, mas não fica sem resposta.",
          ],
        ]}
      />
    ),
  },
  "cap-5": {
    visuals: [<Classify key="c" />, <Suggest key="s" />, <Publish key="p" />],
    details: (
      <Tech
        rows={[
          [
            "Classificar",
            "Pergunta se é incidente de verdade, independente da busca. Improcedente: pedido de autoatendimento, sem sugestão. Procedente sem caso parecido: também sem sugestão.",
          ],
          [
            "Citações",
            "Citação entre colchetes de um id que não veio da busca é removida. Um id solto no texto é sinalizado.",
          ],
          ["Publicar", "Vira nota de trabalho do incidente, assinada pela Aurora."],
          ["Quem decide", "A pessoa analista. A IA sugere e mostra as fontes."],
        ]}
      />
    ),
  },
  "cap-6": {
    stage: (idx, total) => <ClusterStage idx={idx} total={total} />,
    source: (
      <>
        No demo: {CLUSTERS_DEMO.incidents} incidentes, {CLUSTERS_DEMO.groups} grupos,{" "}
        {CLUSTERS_DEMO.isolated} isolados. O exemplo de 200 em 5 grupos é do{" "}
        <Cite who="joao" />.
      </>
    ),
    details: (
      <Tech
        rows={[
          [
            "Pipeline",
            "BERTopic: HDBSCAN agrupa os embeddings dos incidentes (cosseno), um LLM escreve o rótulo curto e o UMAP (semente fixa) só desenha o mapa em 2 dimensões.",
          ],
          [
            "Por que HDBSCAN",
            "Não sabemos quantos grupos existem, os grupos não são redondos e boa parte dos incidentes é ruído.",
          ],
          [
            "Densidade mínima",
            "O artigo usa 4 no banco: é uma decisão de negócio. No demo, o tamanho mínimo é um parâmetro do script de pré-cálculo.",
          ],
          [
            "Casos isolados",
            `No demo, ${CLUSTERS_DEMO.isolated} incidentes ficaram de fora de qualquer grupo. A maioria é suporte interno (projetor, ramal, ar-condicionado), que não se repete o bastante para virar recorrência.`,
          ],
          [
            "Offline",
            "O agrupamento é pré-calculado e servido de um JSON versionado: zero chamada à IA ao abrir o mapa.",
          ],
          [
            "Problemas",
            "Ao escolher um grupo, Recorrências mostra os Problemas que já explicam a causa. Um grupo sem Problema ganha o botão Abrir problema, que no demo só registra na tela.",
          ],
        ]}
      />
    ),
  },
  "cap-7": {
    visuals: [<ProblemCard key="p" />, <Loop key="l" />, <BackToSearch key="b" />],
    details: (
      <Tech
        rows={[
          [
            "Problemas na busca",
            `Coleção própria no Qdrant, até ${RETRIEVAL.problemTopK} por busca, com as mesmas três camadas.`,
          ],
          [
            "Vetor do Problema",
            "Do próprio texto do Problema, ou, sem ele, a média dos vetores dos incidentes ligados.",
          ],
          [
            "Fora do demo",
            "Abrir a Change da correção e ligar a Change ao Problema. No demo, a avaliação de Changes e os Problemas não se conversam.",
          ],
        ]}
      />
    ),
  },
};

const PART_ORDER: PartKey[] = ["antes", "depois", "ciclo"];

function scrollToId(id: string, reduced: boolean) {
  document
    .getElementById(id)
    ?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
}

export default function HowItWorksPage() {
  const { aula } = useAula();
  const reduced = usePrefersReducedMotion();
  const [focused, setFocused] = useState<string>(CHAPTERS[0].id);
  const [fromBelow, setFromBelow] = useState(false);
  const signals = useRef<Record<string, ChapterSignal>>({});
  const focusedRef = useRef(focused);

  const onSignal = useCallback((id: string, s: ChapterSignal) => {
    signals.current[id] = s;
  }, []);

  // The current chapter is the last one whose top has passed 45% of the
  // screen. Read from positions on every scroll (not from which observer
  // entry fired), so a tall sticky stage in modo aula cannot leave the index
  // a chapter behind. It drives the index and, in modo aula, the lesson.
  useEffect(() => {
    const els = CHAPTERS.map((c) => document.getElementById(c.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    let frame = 0;
    function pick() {
      frame = 0;
      const line = window.innerHeight * 0.45;
      let id = els[0]?.id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) id = el.id;
      }
      const prev = focusedRef.current;
      if (!id || id === prev) return;
      const order = (x: string) => CHAPTERS.findIndex((c) => c.id === x);
      setFromBelow(order(id) < order(prev));
      focusedRef.current = id;
      setFocused(id);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(pick);
    }
    // The page scrolls the window on phones and the .main pane on desktop.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    pick();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Modo aula: once a chapter's last step is on screen, the next press of the
  // clicker goes to the next chapter (and PageUp on step 1 to the previous).
  useEffect(() => {
    if (!aula) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target instanceof Element ? e.target : null;
      const move = aulaKeyAction(
        e.key,
        { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey },
        {
          editable: Boolean(t?.closest("input, textarea, select, [contenteditable]")),
          pressable: Boolean(t?.closest("button, a[href], [role='button'], summary")),
          arrowWidget: Boolean(
            t?.closest(
              "[role='tablist'], [role='slider'], [role='menu'], [role='listbox']",
            ),
          ),
          modal: document.querySelector(".palette, .drawer") !== null,
        },
      );
      if (!move) return;
      const i = CHAPTERS.findIndex((c) => c.id === focusedRef.current);
      const sig = signals.current[focusedRef.current];
      if (!sig) return;
      if (move === "next" && sig.done && i < CHAPTERS.length - 1) {
        e.preventDefault();
        scrollToId(CHAPTERS[i + 1].id, reduced);
      } else if (move === "prev" && sig.idx <= 0 && i > 0) {
        e.preventDefault();
        scrollToId(CHAPTERS[i - 1].id, reduced);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aula, reduced]);

  const current = CHAPTERS.find((c) => c.id === focused) ?? CHAPTERS[0];

  return (
    <div className="cf">
      <header className="cf-hero">
        <h1>Depois do deploy, do começo ao fim</h1>
        <p className="cf-lede">
          Da mudança ao incidente, e de volta. O caminho abaixo, contado em sete capítulos
          curtos.
        </p>
        {/* The line at the top: seven stops, one per chapter, same names as the
            index and the headings. */}
        <ol className="cf-life" aria-label="Os sete capítulos">
          {CHAPTERS.map((c, i) => (
            <li
              key={c.id}
              className="cf-life-n"
              data-part={c.part}
              style={{ "--i": i } as React.CSSProperties}
            >
              <a
                href={`#${c.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId(c.id, reduced);
                }}
              >
                <span className="cf-life-dot" aria-hidden="true" />
                <span className="cf-life-t">
                  <span className="cf-life-num">{c.n}</span> {c.title}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <p className="cf-hint">
          {aula ? (
            <>
              <Icons.board size={16} />
              Modo aula: avance com a seta, o espaço ou o passador.
            </>
          ) : (
            <>
              <Icons.play size={16} />
              Role para ler. &quot;Reproduzir passo a passo&quot; anima cada capítulo.
            </>
          )}
        </p>
      </header>

      <nav className="cf-index" aria-label="Capítulos">
        <p className="cf-index-now" aria-live="polite">
          <span className="mono">{current.n}/7</span> {current.title}
        </p>
        <ol className="cf-index-list">
          {PART_ORDER.map((p) => (
            <li key={p} className="cf-index-part" data-part={p}>
              <span className="cf-index-part-t">{PARTS[p].title}</span>
              <ol>
                {CHAPTERS.filter((c) => c.part === p).map((c) => (
                  <li key={c.id}>
                    <a
                      href={`#${c.id}`}
                      aria-current={c.id === focused ? "location" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToId(c.id, reduced);
                      }}
                    >
                      <span className="cf-index-n mono">{c.n}</span>
                      <span className="cf-index-t">{c.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </nav>

      {CHAPTERS.map((ch) => {
        const c = CONTENT[ch.id];
        return (
          <ChapterView
            key={ch.id}
            chapter={ch}
            focused={focused === ch.id}
            cameFromBelow={fromBelow}
            onSignal={onSignal}
            visuals={c.visuals}
            stage={c.stage}
            details={c.details}
            source={c.source}
          />
        );
      })}

      <aside className="cf-next">
        <h2>Próximo passo nos dois lados: medir</h2>
        <p>
          Um gabarito de casos conhecidos, rodado a cada troca de prompt ou modelo. Isso é
          eval: medir que melhorou, não achar.
        </p>
        <Origin kind="fora" />
      </aside>

      <footer className="howto-foot cf-foot">
        <Meridian ticks={28} />
        <p>
          Banco Meridiano é fictício e os dados são sintéticos. A IA sugere; a pessoa
          analista decide.
        </p>
      </footer>
    </div>
  );
}
