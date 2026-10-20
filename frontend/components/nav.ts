// Primary navigation, declared once. The desktop rail, the phone tab bar and
// the command palette's "Ir para" group all render from this list, so a new
// top-level section only needs an entry here.
import { Icons, type IconComponent } from "./icons";

export type NavKey = "incidents" | "recurrences" | "changes" | "how";

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
  tone: "k-inc" | "k-prb" | "k-chg" | "k-ai" | "k-human";
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
    label: "Recorrências",
    short: "Recorrências",
    sub: "Incidentes que se repetem, em grupos",
    match: ["/recorrencias"],
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
    label: "Como funciona",
    short: "Como funciona",
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
