// The /aula route: four stops and the records to open in class. Titles and
// statuses are the records' real ones (tests/aula-stops.test.ts checks them
// against backend/data).

import type { ConceptKey } from "@/components/concepts";
import { Icons, type IconComponent } from "@/components/icons";

export interface Pick {
  number: string;
  /** The record's real title (short_description), as the app shows it. */
  title: string;
  /** The record's real state and priority or risk. */
  status: string;
  /** What to show in class. */
  note: string;
  href: string;
}

export interface Stop {
  n: number;
  concept: ConceptKey;
  /** A section that is not a concept (Recorrências) shows its own icon. */
  icon?: IconComponent;
  tone: string;
  title: string;
  line: string;
  href: string;
  cta: string;
  picks?: Pick[];
}

// Every link keeps ?aula=1 so the screens open step by step, with captions.
export const STOPS: Stop[] = [
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
        title: "Dificuldades em logar no app após deploy recente",
        status: "Em andamento · Prioridade crítica",
        note: "O caso da aula: a IA sugere, citando as fontes",
        href: "/incidentes/INC0052233?aula=1",
      },
    ],
  },
  {
    n: 3,
    concept: "prb",
    icon: Icons.recurrences,
    tone: "",
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
        title:
          "Ajuste do pool de conexões do PIX-Core com o banco de liquidação (HikariCP de 40 para 80 conexões)",
        status: "Nova · Risco moderado",
        note: "Bem preenchida: deve passar",
        href: "/changes/CHG0031001?aula=1",
      },
      {
        number: "CHG0031002",
        title:
          "Boleto-Service 3.8.0: colunas de boleto híbrido na tabela boleto_titulo e migração dos boletos em aberto",
        status: "Nova · Risco alto",
        note: "O retorno não desfaz a migração",
        href: "/changes/CHG0031002?aula=1",
      },
    ],
  },
];
