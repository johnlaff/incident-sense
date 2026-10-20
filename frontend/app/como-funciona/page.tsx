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
  return (
    <a className="cf-cite-link" href={s.href} target="_blank" rel="noreferrer">
      {s.label}
      <Icons.external size={12} />
    </a>
  );
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
        Mil Changes por dia não é exagero: foram 1.084 no dia de pico, segundo o{" "}
        <Cite who="solange" />. O resto é do demo, com a CHG0031002 como exemplo.
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
    source: (
      <>
        Os textos são da CHG0031002 do demo. As notas 9,04 e 4 saíram no ensaio da
        palestra e podem mudar com o modelo.
      </>
    ),
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
    source: (
      <>O incidente e seus campos são do demo. O resumo e os números são de exemplo.</>
    ),
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
        As contagens de tags são do demo. As similaridades e os vereditos são de exemplo;
        no app, saem da busca real. Corte e top-K são os do <Cite who="joao" />.
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
    source: (
      <>
        Os registros são do demo. A sugestão e a nota publicada são exemplos de formato.
      </>
    ),
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
        No demo, o mapa real tem {CLUSTERS_DEMO.incidents} incidentes em{" "}
        {CLUSTERS_DEMO.groups} grupos. O exemplo de 200 incidentes em 5 grupos é do{" "}
        <Cite who="joao" />.
      </>
    ),
    details: (
      <Tech
        rows={[
          [
            "Pipeline",
            "BERTopic: embeddings dos incidentes, UMAP para 2 dimensões com cosseno (semente fixa), HDBSCAN e rótulo curto escrito por um LLM.",
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
            `Com os dados sintéticos atuais, o demo não deixou nenhum caso isolado (${CLUSTERS_DEMO.isolated}). O mapa acima mostra o conceito.`,
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
    source: (
      <>O Problema e sua causa são do demo. A Change da correção fica fora do demo.</>
    ),
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

/** The lifecycle line at the top: each stop links to its chapter. */
const LIFE = [
  { t: "Código" },
  { t: "Change", to: "cap-1" },
  { t: "Deploy", deploy: true },
  { t: "Incidente", to: "cap-3" },
  { t: "Recorrência", to: "cap-6" },
  { t: "Problema", to: "cap-7" },
] as const;

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

  // The chapter that crosses the band at 40% of the screen height is the
  // current one: it drives the index and, in modo aula, the lesson.
  useEffect(() => {
    const els = CHAPTERS.map((c) => document.getElementById(c.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        const id = hit.target.id;
        const prev = focusedRef.current;
        if (id === prev) return;
        const order = (x: string) => CHAPTERS.findIndex((c) => c.id === x);
        setFromBelow(order(id) < order(prev));
        focusedRef.current = id;
        setFocused(id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
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
          O caminho de uma mudança até o incidente, e de volta. Em cada capítulo, o que a
          IA faz, por que importa e onde ver isso funcionando no Incident Sense.
        </p>
        <ol className="cf-life" aria-label="O caminho de qualquer software">
          {LIFE.map((s, i) => (
            <li
              key={s.t}
              className={`cf-life-n${"deploy" in s ? " is-deploy" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
            >
              {"to" in s ? (
                <a
                  href={`#${s.to}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToId(s.to, reduced);
                  }}
                >
                  <span className="cf-life-dot" aria-hidden="true" />
                  {s.t}
                </a>
              ) : (
                <span>
                  <span className="cf-life-dot" aria-hidden="true" />
                  {s.t}
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="cf-hint">
          {aula ? (
            <>
              <Icons.board size={16} />
              Modo aula: cada capítulo começa quando chega ao meio da tela. Avance com a
              seta, o espaço ou o passador de slides.
            </>
          ) : (
            <>
              <Icons.play size={16} />
              Role para ler. Em cada capítulo, &quot;Reproduzir passo a passo&quot; anima
              a sequência; o modo aula, na barra de cima, vai uma etapa por toque.
            </>
          )}
        </p>
      </header>

      <nav className="cf-index" aria-label="Capítulos">
        <p className="cf-index-now" aria-live="polite">
          <span className="mono">{current.n}/7</span> {current.short}
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
                      <span className="cf-index-t">{c.short}</span>
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
          Do lado da Change, um gabarito humano para calibrar a nota. Do lado do
          incidente, uma bateria fixa de casos com resolução conhecida, rodada a cada
          troca de prompt, modelo ou base. Isso se chama eval: a diferença entre achar que
          melhorou e medir que melhorou.
        </p>
        <Origin kind="fora" />
      </aside>

      <footer className="howto-foot cf-foot">
        <Meridian ticks={28} />
        <p>
          O Banco Meridiano é fictício e os dados são sintéticos. A IA sugere e mostra as
          fontes; quem decide e responde pela resolução é a pessoa analista.
        </p>
      </footer>
    </div>
  );
}
