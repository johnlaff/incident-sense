"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, ViewTransition } from "react";

import { RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { useShell } from "@/components/app-shell";
import {
  LoadError,
  PriorityBadge,
  StateBadge,
  StateBlock,
  WakeNotice,
} from "@/components/ui";
import { useAllIncidents } from "@/lib/incidents";
import {
  PRIORITY_LABEL,
  mapSummary,
  type DsState,
  type IncidentRow,
  type PCode,
} from "@/lib/model";
import { keepWhole } from "@/lib/text";

type Tab = "open" | "resolved" | "all";
type SortKey = "num" | "desc" | "svc" | "state" | "priority" | "when";

const PRIO_RANK: Record<PCode, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };
const STATE_RANK: Record<DsState, number> = {
  open: 0,
  progress: 1,
  hold: 2,
  resolved: 3,
};

const TABS: Tab[] = ["open", "resolved", "all"];
const TAB_LABEL: Record<Tab, string> = {
  open: "Abertos",
  resolved: "Resolvidos",
  all: "Todos",
};
const PCODES: PCode[] = ["p1", "p2", "p3", "p4"];

// Long lists render in pages so a phone does not lay out 431 cards at once.
const PAGE = 60;

/** Read the list filters from the URL, so a filtered view can be shared. */
function readFilters() {
  const p = new URLSearchParams(window.location.search);
  const tab = p.get("estado") as Tab | null;
  const prio = p.get("prioridade") as PCode | null;
  return {
    tab: tab && TABS.includes(tab) ? tab : "all",
    service: p.get("servico") ?? "",
    priority: prio && PCODES.includes(prio) ? prio : "",
    query: p.get("q") ?? "",
  } as const;
}

export default function IncidentesPage() {
  const { openIncident, blocked } = useShell();
  const { data, loading, error, slow, retry } = useAllIncidents();

  const [tab, setTab] = useState<Tab>("all");
  const [service, setService] = useState("");
  const [priority, setPriority] = useState<"" | PCode>("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("when");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [kbd, setKbd] = useState(-1);
  const [shown, setShown] = useState(PAGE);
  const [hydrated, setHydrated] = useState(false);

  // Restore filters from the URL once on mount, then mirror every change back.
  useEffect(() => {
    const f = readFilters();
    setTab(f.tab);
    setService(f.service);
    setPriority(f.priority);
    setQuery(f.query);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const p = new URLSearchParams();
    if (tab !== "all") p.set("estado", tab);
    if (service) p.set("servico", service);
    if (priority) p.set("prioridade", priority);
    if (query) p.set("q", query);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [hydrated, tab, service, priority, query]);

  const allRows = useMemo<IncidentRow[]>(
    () => (data?.items ?? []).map(mapSummary),
    [data],
  );

  const rows = useMemo(() => {
    const list = allRows.filter((x) => {
      if (tab === "open" && x.isResolved) return false;
      if (tab === "resolved" && !x.isResolved) return false;
      if (service && x.service !== service) return false;
      if (priority && x.priority !== priority) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!`${x.number} ${x.short} ${x.service}`.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "num":
          av = a.number;
          bv = b.number;
          break;
        case "desc":
          av = a.short;
          bv = b.short;
          break;
        case "svc":
          av = a.service;
          bv = b.service;
          break;
        case "state":
          av = STATE_RANK[a.state];
          bv = STATE_RANK[b.state];
          break;
        case "priority":
          av = PRIO_RANK[a.priority];
          bv = PRIO_RANK[b.priority];
          break;
        default:
          av = new Date(a.openedAt).getTime();
          bv = new Date(b.openedAt).getTime();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [allRows, tab, service, priority, query, sortKey, sortDir]);

  useEffect(() => {
    setKbd(-1);
    setShown(PAGE);
  }, [tab, service, priority, query]);

  const visible = rows.slice(0, shown);

  // Keyboard navigation: j/k move, Enter opens.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (blocked) return;
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setKbd((k) => Math.min((k < 0 ? -1 : k) + 1, visible.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setKbd((k) => Math.max((k < 0 ? visible.length : k) - 1, 0));
      } else if (e.key === "Enter" && kbd >= 0 && visible[kbd]) {
        e.preventDefault();
        openIncident(visible[kbd].number);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, kbd, blocked, openIncident]);

  // Keep the keyboard-selected row on screen.
  useEffect(() => {
    if (kbd < 0) return;
    document
      .querySelector<HTMLElement>(`.list tbody tr:nth-child(${kbd + 1})`)
      ?.scrollIntoView({ block: "nearest" });
  }, [kbd]);

  function sortBtn(
    key: SortKey,
    label: string,
    style?: React.CSSProperties,
    className = "",
  ) {
    const isActive = sortKey === key;
    function toggle() {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir(key === "when" ? "desc" : "asc");
      }
    }
    return (
      <th
        className={`sortable ${className}`}
        style={style}
        tabIndex={0}
        aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {label}
        {isActive ? (
          <span className="sort-ico" aria-hidden="true">
            {sortDir === "asc" ? (
              <Icons.arrowUp size={13} />
            ) : (
              <Icons.arrowDown size={13} />
            )}
          </span>
        ) : null}
      </th>
    );
  }

  const total = data?.total ?? 0;
  const openCount = data?.open_count ?? 0;
  const services = data?.services ?? [];

  const chips: { k: string; label: string; sub?: string; clear: () => void }[] = [];
  if (tab !== "all")
    chips.push({
      k: "tab",
      label: TAB_LABEL[tab],
      sub: "Estado",
      clear: () => setTab("all"),
    });
  if (service)
    chips.push({ k: "svc", label: service, sub: "Serviço", clear: () => setService("") });
  if (priority)
    chips.push({
      k: "prio",
      label: PRIORITY_LABEL[priority],
      sub: "Prioridade",
      clear: () => setPriority(""),
    });
  if (query)
    chips.push({ k: "q", label: `“${query}”`, sub: "Busca", clear: () => setQuery("") });

  function clearAll() {
    setTab("all");
    setService("");
    setPriority("");
    setQuery("");
  }

  return (
    <div>
      <div className="page-head">
        <h1>Incidentes</h1>
        <span className="count">
          {loading
            ? "Carregando…"
            : error
              ? null
              : `${total} no total · ${openCount} em aberto`}
        </span>
      </div>

      <p className="page-lede">
        Cada linha é um chamado. Abra um e veja a IA sugerir a solução.
      </p>

      <WakeNotice show={slow} />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Estado">
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <select
          className={`select toolbar-svc${service ? " has-value" : ""}`}
          value={service}
          onChange={(e) => setService(e.target.value)}
          aria-label="Filtrar por serviço"
        >
          <option value="">Serviço</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={`select toolbar-prio${priority ? " has-value" : ""}`}
          value={priority}
          onChange={(e) => setPriority(e.target.value as "" | PCode)}
          aria-label="Filtrar por prioridade"
        >
          <option value="">Prioridade</option>
          {PCODES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <div className="grow" />
        <div className={`field-search toolbar-search${query ? " has-clear" : ""}`}>
          <Icons.search />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            placeholder="Buscar por número, título ou serviço"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar incidentes"
          />
          {query ? (
            <button
              className="clear-btn"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
            >
              <Icons.close />
            </button>
          ) : null}
        </div>
      </div>

      {chips.length ? (
        <div className="chips">
          {chips.map((c) => (
            <span key={c.k} className="chip">
              {c.sub ? <span className="chip-k">{c.sub}</span> : null}
              <b>{c.label}</b>
              <button onClick={c.clear} aria-label={`Remover filtro ${c.sub ?? ""}`}>
                <Icons.close />
              </button>
            </span>
          ))}
          <button className="chip-clear" onClick={clearAll}>
            Limpar filtros
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="card">
          <LoadError
            title="Não foi possível carregar os incidentes"
            error={error}
            onRetry={retry}
          />
        </div>
      ) : (
        <div className="card">
          <div className="list-wrap">
            <table className="list">
              <caption className="sr-only">
                Incidentes. Use J e K para navegar e Enter para abrir.
              </caption>
              <thead>
                <tr>
                  {sortBtn("num", "Número", { width: 150 })}
                  {sortBtn("desc", "Título")}
                  {sortBtn("svc", "Serviço", { width: 200 }, "col-svc")}
                  {sortBtn("state", "Estado", { width: 128 })}
                  {sortBtn("priority", "Prioridade", { width: 112 })}
                  {sortBtn("when", "Aberto", { width: 112 })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk${i}`} className="sk-row" aria-hidden="true">
                      <td>
                        <span className="sk" style={{ width: 78 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 220 + ((i * 37) % 90) }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 110 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 84, height: 18 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 60, height: 18 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 48 }} />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={6}>
                      <StateBlock
                        icon={Icons.search}
                        title="Nenhum incidente com esses filtros"
                        action={
                          <button className="btn btn-outline btn-sm" onClick={clearAll}>
                            Limpar filtros
                          </button>
                        }
                      >
                        Tente outra palavra ou remova um filtro. Para ver também os
                        incidentes já resolvidos, escolha <b>Todos</b>.
                      </StateBlock>
                    </td>
                  </tr>
                ) : (
                  visible.map((x, i) => (
                    <tr key={x.number} className={kbd === i ? "kbd" : ""}>
                      <td className="num" data-label="Número">
                        <Link
                          className="row-link"
                          href={`/incidentes/${x.number}`}
                          transitionTypes={["nav-forward"]}
                        >
                          <ViewTransition
                            name={`inc-${x.number}`}
                            share="morph"
                            default="none"
                          >
                            <span>
                              <RecordTag number={x.number} size="sm" />
                            </span>
                          </ViewTransition>
                          <span className="sr-only">{`: ${x.short}`}</span>
                        </Link>
                      </td>
                      <td className="desc" data-label="Título">
                        {x.short}
                        <span className="desc-svc">{keepWhole(x.service)}</span>
                      </td>
                      <td className="svc" data-label="Serviço">
                        {keepWhole(x.service)}
                      </td>
                      <td className="st" data-label="Estado">
                        <StateBadge state={x.state} />
                      </td>
                      <td className="pr" data-label="Prioridade">
                        <PriorityBadge priority={x.priority} />
                      </td>
                      <td className="when" data-label="Aberto">
                        {x.rel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && rows.length > visible.length ? (
            <div className="list-more">
              <button
                className="btn btn-outline"
                onClick={() => setShown((n) => n + PAGE)}
              >
                Mostrar mais {Math.min(PAGE, rows.length - visible.length)}
              </button>
            </div>
          ) : null}
          <div className="table-foot">
            <span>
              {loading
                ? "Carregando…"
                : rows.length === 0
                  ? "Nenhum resultado"
                  : `Mostrando ${visible.length} de ${rows.length}`}
            </span>
            <span className="shortcut-hint">
              <span className="kbd">J</span>
              <span className="kbd">K</span>
              navegar
              <span className="sh-sep">·</span>
              <span className="kbd">↵</span>
              abrir
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
