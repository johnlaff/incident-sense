// Primary navigation, declared once. The desktop rail, the phone tab bar and
// the command palette's "Ir para" group all render from this list, so a new
// top-level section only needs an entry here.
import { Icons, type IconComponent } from "./icons";

export type NavKey = "incidents" | "recurrences" | "problems" | "changes" | "how";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: IconComponent;
  /** Full label, used in the rail and in the palette. */
  label: string;
  /** Shorter label for the phone tab bar, where each slot is ~90px wide. */
  short: string;
  /** One-line description shown in the command palette. */
  sub: string;
  /** Pathname prefixes that mark this section as active. */
  match: readonly string[];
  /** Concept color class (concepts.css) for the section's chip. */
  tone: "k-inc" | "k-rec" | "k-prb" | "k-chg" | "k-ai" | "k-human";
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "incidents",
    href: "/incidentes",
    icon: Icons.incidents,
    label: "Incidentes",
    short: "Incidentes",
    sub: "Todos os incidentes do banco",
    match: ["/incidentes"],
    tone: "k-inc",
  },
  {
    key: "recurrences",
    href: "/recorrencias",
    icon: Icons.recurrences,
    // The tab, the menu and the page all say "Grupos": "Recorrências" does
    // not fit a ~66px tab on a 360px phone. The page names recorrências in
    // its lede.
    label: "Grupos",
    short: "Grupos",
    sub: "Incidentes que se repetem, em grupos",
    match: ["/recorrencias"],
    tone: "k-rec",
  },
  {
    key: "problems",
    href: "/problemas",
    icon: Icons.problems,
    label: "Problemas",
    short: "Problemas",
    sub: "Causa raiz dos incidentes que se repetem",
    match: ["/problemas"],
    tone: "k-prb",
  },
  {
    key: "changes",
    href: "/changes",
    icon: Icons.changes,
    label: "Mudanças",
    short: "Mudanças",
    sub: "A IA dá nota ao pedido de mudança",
    match: ["/changes"],
    tone: "k-chg",
  },
  {
    key: "how",
    href: "/como-funciona",
    icon: Icons.how,
    // One name in the tab, the menu and the page. On a 360px phone the tab is
    // ~66px wide: the name goes on two lines there ("\n" marks the break).
    label: "Como a IA funciona",
    short: "Como a IA\nfunciona",
    sub: "O caminho todo, passo a passo",
    match: ["/como-funciona"],
    tone: "k-ai",
  },
];

/** The nav section a pathname belongs to; the root redirects to incidents. */
export function activeNav(pathname: string): NavKey | null {
  if (pathname === "/") return "incidents";
  const hit = NAV_ITEMS.find((n) =>
    n.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)),
  );
  return hit?.key ?? null;
}
