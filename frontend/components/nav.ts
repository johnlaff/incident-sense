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
  },
  {
    key: "recurrences",
    href: "/recorrencias",
    icon: Icons.recurrences,
    label: "Recorrências",
    short: "Recorrências",
    sub: "Mapa de padrões que se repetem",
    match: ["/recorrencias"],
  },
  {
    key: "problems",
    href: "/problemas",
    icon: Icons.problems,
    label: "Problemas",
    short: "Problemas",
    sub: "Causa raiz dos incidentes que se repetem",
    match: ["/problemas"],
  },
  {
    key: "changes",
    href: "/changes",
    icon: Icons.changes,
    label: "Mudanças",
    short: "Mudanças",
    sub: "Nota de preenchimento das mudanças",
    match: ["/changes"],
  },
  {
    key: "how",
    href: "/como-funciona",
    icon: Icons.how,
    label: "Como funciona",
    // Five tabs leave ~78px each on a phone; the full label would be cut.
    short: "Sobre a IA",
    sub: "Como a IA sugere e agrupa",
    match: ["/como-funciona"],
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
