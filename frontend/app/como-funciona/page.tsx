"use client";

// "Como a IA funciona": the whole lifecycle after the deploy, as the talk "Depois
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
        Pico de 1.084 Mudanças em um dia, segundo o <Cite who="solange" />.
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
            "Critérios",
            <>
              Ficam num arquivo de configuração do demo (
              <span className="mono">rubrica.toml</span>), versão {RUBRIC_VERSION}: sete
              campos, pesos que somam {br(TOTAL_WEIGHT)}, mínimo {br(GATE)}. Mudar um
              critério é editar esse arquivo, sem nova versão do sistema.
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
            "Chave = versão da grade + modelo + Mudança + campo + hash SHA-256 do texto normalizado. Mesma chave, mesma nota, zero chamada.",
          ],
          [
            "Escopo",
            "Só Mudança Normal, estado Novo, empresa Banco Meridiano. Fora disso aparece como não avaliada, nunca como zero.",
          ],
          [
            "Fora do demo",
            "No banco a avaliação dispara sozinha por um evento de mensageria quando a Mudança é submetida. No demo, você clica em avaliar.",
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
        A média 8,87 saiu de uma avaliação real no app; a coerência 4,0, do ensaio. As
        duas podem mudar um pouco com o modelo.
      </>
    ),
    details: (
      <Tech
        rows={[
          [
            "Quando roda",
            `Só se a média ponderada for ${br(GATE)} ou mais (trava de elegibilidade).`,
          ],
          [
            "Entrada",
            "Uma instrução só para a IA (o prompt), com os sete campos, o plano de retorno e as tarefas cadastradas.",
          ],
          [
            "Saída",
            "Nota de coerência de 0 a 10, pontos que a IA anotou (só os que se contradizem pesam na nota), raciocínio, orientação ao autor, aderência do retorno às tarefas (aderente, parcial ou não aderente) e o percentual.",
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
            "Vetor (embedding)",
            <>
              <span className="mono">{EMBEDDING.model}</span>,{" "}
              {EMBEDDING.dims.toLocaleString("pt-BR")} números por texto. A tela do
              pipeline mostra os 24 primeiros números que a API devolve.
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
        O mínimo de 0,80 e quantos casos a busca traz (o top-K) vêm do <Cite who="joao" />
        .
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
              Banco de vetores Qdrant, em memória. A semelhança de cosseno compara a
              direção de dois vetores: 1 é o mesmo sentido, 0 é nada a ver. Mínimo{" "}
              <span className="mono">RETRIEVAL_MIN_SIMILARITY = {RETRIEVAL.floor}</span>;
              a busca traz no máximo{" "}
              <span className="mono">{RETRIEVAL.incidentTopK}</span> incidentes e{" "}
              <span className="mono">{RETRIEVAL.problemTopK}</span> problemas (o top-K),
              em coleções separadas.
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
            "Pergunta se é falha de verdade, independente da busca. Não é falha (improcedente): pedido de autoatendimento, sem sugestão. É falha (procedente), mas sem caso parecido: também sem sugestão.",
          ],
          [
            "Citações",
            "Citação entre colchetes de um id que não veio da busca é removida. Um id solto no texto é sinalizado.",
          ],
          [
            "Publicar",
            "Vira nota de trabalho do incidente, assinada pelo assistente da IA.",
          ],
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
            "BERTopic: o HDBSCAN agrupa os vetores dos incidentes pela semelhança de cosseno, um LLM escreve o rótulo curto e o UMAP (semente fixa) só desenha o mapa em 2 dimensões.",
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
            `No demo, ${CLUSTERS_DEMO.isolated} incidentes ficaram de fora de qualquer grupo. A maioria é suporte interno (projetor, ramal, ar-condicionado), que não se repete o bastante para virar um grupo de repetições.`,
          ],
          [
            "Offline",
            "O agrupamento é pré-calculado e servido de um JSON versionado: zero chamada à IA ao abrir o mapa.",
          ],
          [
            "Problemas",
            "Ao escolher um grupo, a tela Repetições mostra os Problemas que já explicam a causa. Um grupo sem Problema ganha o botão Abrir problema, que no demo só registra na tela.",
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
            "Abrir a Mudança da correção e ligar a Mudança ao Problema. No demo, a avaliação de Mudanças e os Problemas não se conversam.",
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

function Cap({ n, reduced }: { n: number; reduced: boolean }) {
  return (
    <a
      className="cf-30-cap"
      href={`#cap-${n}`}
      onClick={(e) => {
        e.preventDefault();
        scrollToId(`cap-${n}`, reduced);
      }}
    >
      cap. {n}
    </a>
  );
}

/** Three lines that tell both flows, each with links to its chapters. */
function Summary30({ reduced }: { reduced: boolean }) {
  return (
    <section className="cf-30" aria-labelledby="cf-30-h">
      <h2 id="cf-30-h">Em 30 segundos</h2>
      <ol>
        <li>
          <b>No incidente:</b> a IA resume o chamado e acha casos parecidos já resolvidos.
          Parecido quer dizer com o mesmo sentido, mesmo escrito com outras palavras.
          Depois sugere uma solução citando cada caso. <Cap n={3} reduced={reduced} />{" "}
          <Cap n={4} reduced={reduced} /> <Cap n={5} reduced={reduced} />
        </li>
        <li>
          <b>Na Mudança, antes de ela ir ao ar:</b> a IA dá nota de 0 a 10 a cada parte do
          pedido. Pode seguir quando a média e a coerência entre as partes chegam a 8,0.{" "}
          <Cap n={1} reduced={reduced} /> <Cap n={2} reduced={reduced} />
        </li>
        <li>
          <b>O ciclo fecha:</b> incidentes que se repetem formam grupos, o grupo vira um
          Problema e a correção volta como Mudança. <Cap n={6} reduced={reduced} />{" "}
          <Cap n={7} reduced={reduced} />
        </li>
      </ol>
    </section>
  );
}

export default function HowItWorksPage() {
  const { aula } = useAula();
  const reduced = usePrefersReducedMotion();
  const [focused, setFocused] = useState<string>(CHAPTERS[0].id);
  const [fromBelow, setFromBelow] = useState(false);
  const signals = useRef<Record<string, ChapterSignal>>({});
  const focusedRef = useRef(focused);
  // The hero's line already lists the seven chapters: the sticky pager only
  // shows once that line (and the hint under it) has left the screen, so the
  // index is never doubled and is already stuck when it appears.
  const lifeRef = useRef<HTMLParagraphElement>(null);
  const [lifeShown, setLifeShown] = useState(true);
  useEffect(() => {
    const el = lifeRef.current;
    if (!el) return;
    const top = document.querySelector<HTMLElement>(".topbar")?.offsetHeight ?? 56;
    const io = new IntersectionObserver(([e]) => setLifeShown(e.isIntersecting), {
      rootMargin: `-${top}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
        {/* Same name as the tab and the menu. */}
        <h1>Como a IA funciona</h1>
        <p className="cf-lede">
          A IA compara o sentido do texto de um chamado com casos já resolvidos, acha os
          mais parecidos e escreve uma sugestão citando cada um. Quem decide é uma pessoa.
          Aqui está o caminho todo, em sete capítulos curtos.
        </p>
        <Summary30 reduced={reduced} />
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
        <p className="cf-hint" ref={lifeRef}>
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

      <nav
        className="cf-index"
        aria-label="Capítulos"
        data-hidden={lifeShown || undefined}
      >
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

      <section className="cf-not" aria-labelledby="cf-not-h">
        <h2 id="cf-not-h">O que a IA não faz</h2>
        <ul>
          <li>
            <b>Não decide.</b> Quem aprova a Mudança e resolve o incidente é uma pessoa.
          </li>
          <li>
            <b>Não mexe em nada.</b> Não altera sistemas, não fecha chamados e não abre
            Problemas sozinha. No demo, a nota que ela deixa no incidente aparece só para
            você, e some quando o servidor reinicia.
          </li>
          <li>
            <b>Não inventa fonte.</b> Só cita casos que a busca trouxe; uma citação de
            fora é removida.
          </li>
          <li>
            <b>Não responde sem base.</b> Sem caso parecido o bastante, diz que não tem
            sugestão.
          </li>
          <li>
            <b>Não garante que a mudança é segura.</b> A nota julga o texto do pedido, não
            a execução.
          </li>
        </ul>
      </section>

      <aside className="cf-next">
        <h2>Próximo passo nos dois lados: medir</h2>
        <p>
          Um gabarito de casos com resposta conhecida, rodado a cada troca de instrução
          (prompt) ou de modelo. É o que se chama de eval: medir que melhorou, em vez de
          achar.
        </p>
        <Origin kind="fora" />
      </aside>

      <footer className="howto-foot cf-foot">
        <Meridian ticks={28} />
        <p>
          Banco Meridiano é fictício e os dados são sintéticos. A IA sugere; a pessoa
          analista decide.
        </p>
        <p className="cf-credit">
          Solange e João, os palestrantes, escreveram os artigos que inspiraram esta demo.
        </p>
      </footer>
    </div>
  );
}
