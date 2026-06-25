"use client";

// App shell: topbar, sidenav, theme toggle, ⌘K command palette, notifications,
// and the global "peek" drawer that opens any cited incident so a suggestion's
// grounding can be verified without leaving the page. Wraps every route.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icons, type IconComponent } from "./icons";
import { StateBadge, PriorityBadge } from "./ui";
import { useFocusTrap } from "@/lib/a11y";
import { useAllIncidents, useIncident } from "@/lib/incidents";
import { absDate, mapDetail } from "@/lib/model";
import type { IncidentSummary } from "@/lib/types";

type Theme = "light" | "dark";

interface ShellContextValue {
  /** Open the peek drawer for a cited incident (verify grounding in place). */
  peek: (number: string) => void;
  /** Navigate to an incident's full record. */
  openIncident: (number: string) => void;
  /** Ask Aurora to suggest a resolution (navigates to the incident if needed). */
  requestSuggest: (number?: string) => void;
  /** The incident the copilot should auto-run for after navigation, or null. */
  autoSuggestFor: string | null;
  consumeAutoSuggest: () => void;
  /** The citation flashing right now (set briefly when peeked), or null. */
  flashCite: string | null;
  /** True while a modal overlay (palette or drawer) owns the keyboard. */
  blocked: boolean;
  theme: Theme;
  modKey: string;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within <AppShell>");
  return ctx;
}

const DETAIL_RE = /^\/incidentes\/(INC\w+)/;

function screenFor(pathname: string): "incidents" | "recurrences" | "how" | "other" {
  if (pathname.startsWith("/recorrencias")) return "recurrences";
  if (pathname.startsWith("/como-funciona")) return "how";
  if (pathname === "/" || pathname.startsWith("/incidentes")) return "incidents";
  return "other";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [theme, setTheme] = useState<Theme>("light");
  const [modKey, setModKey] = useState("Ctrl");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Opening the bell marks notifications as read, so the badge clears for good
  // (these demo notifications are static, so none arrive afterwards).
  const [notifRead, setNotifRead] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [flashCite, setFlashCite] = useState<string | null>(null);
  const [autoSuggestFor, setAutoSuggestFor] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: list } = useAllIncidents();
  const items = useMemo(() => list?.items ?? [], [list]);
  const openCount = list?.open_count ?? null;

  // Sync theme from the attribute the no-flash inline script already applied.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") setTheme(current);
    const mac = /Mac|iPhone|iPad|iPod/.test(
      navigator.platform || navigator.userAgent || "",
    );
    setModKey(mac ? "⌘" : "Ctrl");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("is-theme", next);
      } catch {
        /* ignore storage failures (private mode) */
      }
      return next;
    });
  }, []);

  // ⌘K / Ctrl-K toggles the palette anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close transient overlays whenever the route changes.
  useEffect(() => {
    setPeekId(null);
    setPaletteOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  const peek = useCallback((number: string) => {
    setPeekId(number);
    setFlashCite(number);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashCite(null), 600);
  }, []);
  useEffect(
    () => () => void (flashTimer.current && clearTimeout(flashTimer.current)),
    [],
  );

  const openIncident = useCallback(
    (number: string) => {
      setPeekId(null);
      setPaletteOpen(false);
      router.push(`/incidentes/${number}`);
    },
    [router],
  );

  const currentDetail = DETAIL_RE.exec(pathname)?.[1] ?? null;
  const firstOpen = useMemo(
    () => items.find((i) => !i.is_resolved)?.number ?? null,
    [items],
  );

  const requestSuggest = useCallback(
    (number?: string) => {
      const target = number ?? currentDetail ?? firstOpen;
      if (!target) {
        router.push("/incidentes");
        return;
      }
      setAutoSuggestFor(target);
      setPaletteOpen(false);
      if (currentDetail !== target) router.push(`/incidentes/${target}`);
    },
    [currentDetail, firstOpen, router],
  );

  const consumeAutoSuggest = useCallback(() => setAutoSuggestFor(null), []);

  const ctx = useMemo<ShellContextValue>(
    () => ({
      peek,
      openIncident,
      requestSuggest,
      autoSuggestFor,
      consumeAutoSuggest,
      flashCite,
      blocked: paletteOpen || peekId !== null,
      theme,
      modKey,
    }),
    [
      peek,
      openIncident,
      requestSuggest,
      autoSuggestFor,
      consumeAutoSuggest,
      flashCite,
      paletteOpen,
      peekId,
      theme,
      modKey,
    ],
  );

  const active = screenFor(pathname);
  const navItems = [
    {
      key: "incidents",
      href: "/incidentes",
      icon: Icons.incidents,
      label: "Incidentes",
      count: openCount,
    },
    {
      key: "recurrences",
      href: "/recorrencias",
      icon: Icons.recurrences,
      label: "Recorrências",
    },
    { key: "how", href: "/como-funciona", icon: Icons.how, label: "Como funciona" },
  ] as const;

  return (
    <ShellContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <Link href="/incidentes" className="brand" style={{ textDecoration: "none" }}>
            <span className="mark">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx={12} cy={12} r={7.4} strokeWidth={1.6} opacity={0.95} />
                <line x1={12} y1={4.6} x2={12} y2={19.4} strokeWidth={1.6} />
                <path d="M5 9.6 Q12 12.4 19 9.6" strokeWidth={1.3} opacity={0.82} />
                <path d="M5 14.4 Q12 11.6 19 14.4" strokeWidth={1.3} opacity={0.82} />
              </svg>
            </span>
            <span className="brand-name">Banco Meridiano</span>
            <span className="brand-sep" />
            <span className="brand-prod">
              Incident&nbsp;<span className="brand-accent">Sense</span>
            </span>
          </Link>
          <div className="grow" />
          <button
            className="field-search search"
            onClick={() => setPaletteOpen(true)}
            style={{ cursor: "pointer", textAlign: "left" }}
            aria-label="Buscar (abre a paleta de comandos)"
          >
            <Icons.search />
            <input
              className="input"
              placeholder="Buscar incidentes, serviços…"
              readOnly
              style={{ cursor: "pointer" }}
              tabIndex={-1}
            />
            <span className="kbd">{modKey}K</span>
          </button>
          <div className="topbar-tools">
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === "dark" ? "Tema claro" : "Tema escuro"}
              aria-label="Alternar tema"
            >
              {theme === "dark" ? <Icons.sun /> : <Icons.moon />}
            </button>
            <div className="notif-wrap">
              <button
                className={`icon-btn${notifOpen ? " on" : ""}`}
                onClick={() => {
                  if (!notifOpen) setNotifRead(true);
                  setNotifOpen((o) => !o);
                }}
                title="Notificações"
                aria-label="Notificações"
              >
                <Icons.bell />
                {!notifRead && items.length > 0 ? <span className="notif-dot" /> : null}
              </button>
              {notifOpen ? (
                <NotificationsMenu
                  items={items}
                  onOpen={openIncident}
                  onClose={() => setNotifOpen(false)}
                />
              ) : null}
            </div>
            <div className="avatar" title="João Ferreira · Analista N2">
              JF
            </div>
          </div>
        </header>

        <nav className="sidenav">
          <div className="nav-label">Operações</div>
          {navItems.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className={`nav-item${active === n.key ? " active" : ""}`}
            >
              <n.icon />
              <span>{n.label}</span>
              {"count" in n && n.count != null ? (
                <span className="nav-count">{n.count}</span>
              ) : null}
            </Link>
          ))}
          <div className="nav-spacer" />
          <div className="nav-foot">
            Dados sintéticos · banco fictício. Demo do workshop.
          </div>
        </nav>

        <main className="main">
          <div className="screen-enter" key={pathname}>
            {children}
          </div>
        </main>

        {paletteOpen ? (
          <CommandPalette
            items={items}
            modKey={modKey}
            theme={theme}
            onClose={() => setPaletteOpen(false)}
            onOpenIncident={openIncident}
            onNavigate={(href) => {
              setPaletteOpen(false);
              router.push(href);
            }}
            onSuggest={() => requestSuggest()}
            onToggleTheme={toggleTheme}
          />
        ) : null}

        {peekId ? (
          <PeekDrawer
            number={peekId}
            onClose={() => setPeekId(null)}
            onOpen={openIncident}
          />
        ) : null}
      </div>
    </ShellContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Notifications dropdown (synthetic, references real incidents)
// ---------------------------------------------------------------------------

function NotificationsMenu({
  items,
  onOpen,
  onClose,
}: {
  items: IncidentSummary[];
  onOpen: (number: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const open = items.filter((i) => !i.is_resolved).slice(0, 4);
  const kinds: { icon: IconComponent; kind: string; title: string; time: string }[] = [
    {
      icon: Icons.alert,
      kind: "alert",
      title: "Novo incidente de prioridade alta no seu grupo",
      time: "há 4 min",
    },
    {
      icon: Icons.incidents,
      kind: "warn",
      title: "Incidente segue em andamento",
      time: "há 1 h",
    },
    {
      icon: Icons.recurrences,
      kind: "recur",
      title: "Possível recorrência detectada",
      time: "há 2 h",
    },
    {
      icon: Icons.aiSpark,
      kind: "ai",
      title: "A Aurora fundamentou uma resolução para revisão",
      time: "há 3 h",
    },
  ];
  const notifs = open.map((inc, i) => ({ inc, ...kinds[i % kinds.length] }));

  return (
    <>
      <div className="notif-overlay" onClick={onClose} />
      <div className="notif-menu">
        <div className="nm-head">
          <span>Notificações</span>
          <span className="nm-count">{notifs.length} novas</span>
        </div>
        {notifs.map(({ inc, icon: Icon, kind, title, time }) => (
          <button
            key={inc.number}
            className="nm-item"
            onClick={() => {
              onOpen(inc.number);
              onClose();
            }}
          >
            <span className={`nm-ico ${kind}`}>
              <Icon size={15} />
            </span>
            <div className="nm-main">
              <div className="nm-title">{title}</div>
              <div className="nm-sub">
                <span className="mono">{inc.number}</span>
                {` · ${time}`}
              </div>
            </div>
          </button>
        ))}
        <div className="nm-foot">
          Notificações sintéticas, para a demonstração do workshop.
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Command palette (⌘K)
// ---------------------------------------------------------------------------

interface PaletteAction {
  id: string;
  group: string;
  icon: IconComponent;
  title: string;
  sub?: string;
  hint?: string;
  run: () => void;
}

interface PaletteIncident {
  id: string;
  group: "Incidentes";
  mono: true;
  title: string;
  sub: string;
  run: () => void;
}

type PaletteItem = PaletteAction | PaletteIncident;

function CommandPalette({
  items,
  modKey,
  theme,
  onClose,
  onOpenIncident,
  onNavigate,
  onSuggest,
  onToggleTheme,
}: {
  items: IncidentSummary[];
  modKey: string;
  theme: Theme;
  onClose: () => void;
  onOpenIncident: (number: string) => void;
  onNavigate: (href: string) => void;
  onSuggest: () => void;
  onToggleTheme: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<PaletteItem[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: "a-suggest",
        group: "Ações",
        icon: Icons.sparkle,
        title: "Sugerir resolução",
        sub: "Aciona o copiloto (Aurora)",
        hint: "↵",
        run: onSuggest,
      },
      {
        id: "a-theme",
        group: "Ações",
        icon: theme === "dark" ? Icons.sun : Icons.moon,
        title: theme === "dark" ? "Tema claro" : "Tema escuro",
        sub: "Alternar aparência",
        run: onToggleTheme,
      },
      {
        id: "a-inc",
        group: "Ir para",
        icon: Icons.incidents,
        title: "Incidentes",
        sub: "Lista de chamados",
        run: () => onNavigate("/incidentes"),
      },
      {
        id: "a-rec",
        group: "Ir para",
        icon: Icons.recurrences,
        title: "Recorrências",
        sub: "Mapa de agrupamentos",
        run: () => onNavigate("/recorrencias"),
      },
      {
        id: "a-how",
        group: "Ir para",
        icon: Icons.how,
        title: "Como funciona",
        sub: "Fluxo RAG e clustering",
        run: () => onNavigate("/como-funciona"),
      },
    ];
    const ql = q.trim().toLowerCase();
    const acts = ql
      ? actions.filter((a) => `${a.title} ${a.sub ?? ""}`.toLowerCase().includes(ql))
      : actions;
    const incs: PaletteIncident[] = items
      .filter((x) =>
        !ql
          ? true
          : `${x.number} ${x.short_description} ${x.cmdb_ci}`.toLowerCase().includes(ql),
      )
      .slice(0, ql ? 8 : 5)
      .map((x) => ({
        id: `i-${x.number}`,
        group: "Incidentes",
        mono: true,
        title: x.short_description,
        sub: `${x.number} · ${x.cmdb_ci}`,
        run: () => onOpenIncident(x.number),
      }));
    return [...acts, ...incs];
  }, [q, items, theme, onSuggest, onToggleTheme, onNavigate, onOpenIncident]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[sel];
        if (item) {
          item.run();
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [results, sel, onClose]);

  const groups: { name: string; items: { item: PaletteItem; index: number }[] }[] = [];
  results.forEach((item, index) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) {
      g = { name: item.group, items: [] };
      groups.push(g);
    }
    g.items.push({ item, index });
  });

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        tabIndex={-1}
        ref={trapRef}
      >
        <div className="pal-input">
          <Icons.search />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar incidentes, pular telas, ações…"
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="pal-results">
          {results.length === 0 ? (
            <div className="pal-empty">Nada encontrado para “{q}”.</div>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div className="pal-group-label">{g.name}</div>
                {g.items.map(({ item, index }) => (
                  <div
                    key={item.id}
                    className={`pal-item${sel === index ? " sel" : ""}`}
                    onMouseEnter={() => setSel(index)}
                    onClick={() => {
                      item.run();
                      onClose();
                    }}
                  >
                    <div className={`pal-ico${"mono" in item ? " mono" : ""}`}>
                      {"mono" in item ? "INC" : <item.icon />}
                    </div>
                    <div className="pal-main">
                      <div className="pal-title">{item.title}</div>
                      {item.sub ? <div className="pal-sub">{item.sub}</div> : null}
                    </div>
                    {"hint" in item && item.hint ? (
                      <span className="pal-hint kbd">{item.hint}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="pal-foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>
            Navegar
          </span>
          <span>
            <span className="kbd">↵</span>
            Selecionar
          </span>
          <span>
            <span className="kbd">{modKey}</span>
            <span className="kbd">K</span>
            Abrir ou fechar
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peek drawer — open a cited incident in place to verify the grounding
// ---------------------------------------------------------------------------

function PeekDrawer({
  number,
  onClose,
  onOpen,
}: {
  number: string;
  onClose: () => void;
  onOpen: (number: string) => void;
}) {
  const { data, loading, error } = useIncident(number);
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inc = data ? mapDetail(data) : null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Incidente citado"
        tabIndex={-1}
        ref={trapRef}
      >
        <div className="drawer-head">
          <span className="peek-label">Citado</span>
          <span
            className="mono"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--primary-ink)" }}
          >
            {number}
          </span>
          <button className="drawer-back" onClick={onClose}>
            <Icons.arrowLeft />
            Voltar ao incidente
          </button>
        </div>
        <div className="drawer-body">
          {loading ? <p className="muted">Carregando…</p> : null}
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          {inc ? (
            <>
              <div
                className="row"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <StateBadge state={inc.state} />
                <PriorityBadge priority={inc.priority} withWord />
              </div>
              <h2>{inc.title}</h2>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: -6 }}>
                {`${inc.service} · ${inc.group} · ${inc.rel}`}
              </div>

              {inc.resolutionNotes ? (
                <div className="peek-res">
                  <div className="pr-label">
                    <Icons.checkCircle />
                    Notas de resolução
                  </div>
                  <div className="pr-body">{inc.resolutionNotes}</div>
                  {inc.closeCode ? (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: "var(--st-resolved)",
                        fontWeight: 600,
                      }}
                    >
                      {inc.closeCode}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "12px 13px",
                    background: "var(--surface-2)",
                    fontSize: 13.5,
                    color: "var(--ink-body)",
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                    Ainda sem resolução
                  </div>
                  {inc.description}
                </div>
              )}

              <div className="label-row" style={{ marginTop: 4 }}>
                Registro
              </div>
              <p
                style={{
                  margin: 0,
                  color: "var(--ink-body)",
                  fontSize: 13.5,
                  lineHeight: 1.65,
                }}
              >
                {inc.description}
              </p>
              <div className="peek-meta-grid">
                {(
                  [
                    ["Categoria", inc.category],
                    ["Subcategoria", inc.subcategory],
                    ["Serviço (CI)", inc.service],
                    ["Grupo", inc.group],
                    ["Impacto", inc.impact],
                    ["Urgência", inc.urgency],
                    ["Aberto em", absDate(inc.openedAt)],
                    inc.clusterLabel ? ["Recorrência", inc.clusterLabel] : null,
                  ].filter(Boolean) as [string, string][]
                ).map(([k, v]) => (
                  <div className="field" key={k}>
                    <label>{k}</label>
                    <span className="val">{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    onClose();
                    onOpen(number);
                  }}
                >
                  <Icons.external />
                  Abrir como incidente
                </button>
                <button className="btn btn-ghost btn-sm" onClick={onClose}>
                  Voltar
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
