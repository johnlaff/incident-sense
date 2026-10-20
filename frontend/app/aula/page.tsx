import type { Metadata } from "next";
import Link from "next/link";

import "./aula.css";
import { LessonModeSwitch } from "./mode-switch";
import {
  ConceptIcon,
  ConceptLegend,
  RecordTag,
  type ConceptKey,
} from "@/components/concepts";
import { Icons } from "@/components/icons";
import { keepWhole } from "@/lib/text";

export const metadata: Metadata = {
  title: "Aula: como a IA ajuda depois do deploy · Incident Sense",
};

interface Pick {
  number: string;
  title: string;
  note: string;
  href: string;
}

interface Stop {
  n: number;
  concept: ConceptKey;
  tone: string;
  title: string;
  line: string;
  href: string;
  cta: string;
  picks?: Pick[];
}

// Every link keeps ?aula=1 so the screens open step by step, with captions.
const STOPS: Stop[] = [
  {
    n: 1,
    concept: "ai-step",
    tone: "k-ai",
    title: "Como funciona",
    line: "Do chamado aberto à sugestão revisada.",
    href: "/como-funciona?aula=1",
    cta: "Ver o caminho",
  },
  {
    n: 2,
    concept: "inc",
    tone: "k-inc",
    title: "Um incidente real, resolvido com IA",
    line: "A IA acha casos parecidos e sugere, citando cada um.",
    href: "/incidentes/INC0052233?aula=1",
    cta: "Abrir o incidente",
    picks: [
      {
        number: "INC0052233",
        title: "Login no app falha depois do deploy",
        note: "Prioridade crítica, ainda aberto",
        href: "/incidentes/INC0052233?aula=1",
      },
    ],
  },
  {
    n: 3,
    concept: "prb",
    tone: "k-prb",
    title: "Recorrências",
    line: "Erro que se repete vira grupo. Grupo pede um Problema.",
    href: "/recorrencias?aula=1",
    cta: "Ver os grupos",
  },
  {
    n: 4,
    concept: "chg",
    tone: "k-chg",
    title: "Avaliação de uma Mudança",
    line: "Antes do deploy, a IA dá nota ao pedido.",
    href: "/changes/CHG0031001?aula=1",
    cta: "Avaliar uma mudança",
    picks: [
      {
        number: "CHG0031001",
        title: "Pool de conexões do PIX-Core",
        note: "Bem preenchida: deve passar",
        href: "/changes/CHG0031001?aula=1",
      },
      {
        number: "CHG0031002",
        title: "Boleto híbrido com migração de dados",
        note: "O retorno não desfaz a migração",
        href: "/changes/CHG0031002?aula=1",
      },
    ],
  },
];

export default function LessonPage() {
  return (
    <div className="lesson">
      <header className="lesson-hero">
        <h1>Aula: como a IA ajuda depois do deploy</h1>
        <p className="lesson-lede">
          Um deploy quebrou o login do app do Banco Meridiano, um banco fictício. Siga
          quatro passos: a IA ajuda, uma pessoa decide.
        </p>
        <LessonModeSwitch />
      </header>

      <ol className="lesson-route" aria-label="Roteiro da aula">
        {STOPS.map((s) => (
          <li
            key={s.n}
            className={`lesson-stop ${s.tone}`}
            style={{ "--i": s.n - 1 } as React.CSSProperties}
          >
            <span className="stop-n" aria-hidden="true">
              {s.n}
            </span>
            <div className="stop-body">
              <div className="stop-head">
                <ConceptIcon concept={s.concept} />
                <h2>
                  <span className="sr-only">Passo {s.n}: </span>
                  {s.title}
                </h2>
              </div>
              <p>{s.line}</p>
              {s.picks ? (
                <ul className="stop-picks" aria-label="Exemplos para a demonstração">
                  {s.picks.map((p) => (
                    <li key={p.number}>
                      <Link href={p.href} className="stop-pick">
                        <RecordTag number={p.number} size="sm" />
                        <span className="pick-text">
                          <b>{keepWhole(p.title)}</b>
                          <small>{p.note}</small>
                        </span>
                        <Icons.chevronRight />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href={s.href} className="btn btn-outline stop-cta">
                {s.cta}
                <Icons.arrowRight />
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <section className="lesson-legend" aria-labelledby="legend-h">
        <div className="legend-head">
          <h2 id="legend-h">Como ler as cores e os ícones</h2>
          <p>Cada ideia tem sempre a mesma cor e o mesmo ícone.</p>
        </div>
        <ConceptLegend />
      </section>
    </div>
  );
}
