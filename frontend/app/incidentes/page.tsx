"use client";

import { useEffect, useMemo, useState } from "react";

import { Icons } from "@/components/icons";
import { useShell } from "@/components/app-shell";
import { PriorityBadge, StateBadge, StateBlock } from "@/components/ui";
import { useAllIncidents } from "@/lib/incidents";
import {
  PRIORITY_LABEL,
  mapSummary,
  type DsState,
  type IncidentRow,
  type PCode,
} from "@/lib/model";

type Tab = "open" | "resolved" | "all";
type SortKey = "num" | "desc" | "svc" | "state" | "priority" | "when";

const PRIO_RANK: Record<PCode, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };
const STATE_RANK: Record<DsState, number> = {
  open: 0,
  progress: 1,
  hold: 2,
  resolved: 3,
};

export default function IncidentesPage() {
  const { openIncident, blocked } = useShell();
  const { data, loading, error } = useAllIncidents();

  const [tab, setTab] = useState<Tab>("all");
  const [service, setService] = useState("");
  const [priority, setPriority] = useState<"" | PCode>("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("when");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [kbd, setKbd] = useState(-1);

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
  }, [tab, service, priority, query]);

  // Keyboard navigation: j/k move, Enter opens.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (blocked) return;
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setKbd((k) => Math.min((k < 0 ? -1 : k) + 1, rows.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setKbd((k) => Math.max((k < 0 ? rows.length : k) - 1, 0));
      } else if (e.key === "Enter" && kbd >= 0 && rows[kbd]) {
        e.preventDefault();
        openIncident(rows[kbd].number);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, kbd, blocked, openIncident]);

  function sortBtn(key: SortKey, label: string, style?: React.CSSProperties) {
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
        className="sortable"
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
          <span className="sort-ico">{sortDir === "asc" ? "↑" : "↓"}</span>
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
      label: tab === "open" ? "Abertos" : "Resolvidos",
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
          {loading ? "carregando…" : `${total} chamados · ${openCount} abertos`}
        </span>
      </div>

      <div className="toolbar">
        <div className="segmented">
          {(["open", "resolved", "all"] as const).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "open" ? "Abertos" : t === "resolved" ? "Resolvidos" : "Todos"}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={service}
          onChange={(e) => setService(e.target.value)}
          aria-label="Filtrar por serviço"
        >
          <option value="">Todos os serviços</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={priority}
          onChange={(e) => setPriority(e.target.value as "" | PCode)}
          aria-label="Filtrar por prioridade"
        >
          <option value="">Toda prioridade</option>
          {(["p1", "p2", "p3", "p4"] as const).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <div className="grow" />
        <div
          className={`field-search${query ? " has-clear" : ""}`}
          style={{ width: 260 }}
        >
          <Icons.search />
          <input
            className="input"
            placeholder="Filtrar nesta lista…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filtrar incidentes"
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
          <span className="chips-label">Filtros:</span>
          {chips.map((c) => (
            <span key={c.k} className="chip">
              {c.sub ? <span style={{ opacity: 0.7 }}>{c.sub} ·</span> : null}
              <b>{c.label}</b>
              <button onClick={c.clear} aria-label="Remover filtro">
                <Icons.close />
              </button>
            </span>
          ))}
          <button className="chip-clear" onClick={clearAll}>
            Limpar tudo
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="card">
          <StateBlock
            icon={Icons.alert}
            variant="error"
            title="Não foi possível carregar os incidentes"
            action={
              <button
                className="btn btn-outline btn-sm"
                onClick={() => location.reload()}
              >
                Tentar de novo
              </button>
            }
          >
            {error} Verifique se a API está rodando em{" "}
            <span className="mono">localhost:8000</span>.
          </StateBlock>
        </div>
      ) : (
        <div className="card">
          <div className="list-wrap">
            <table className="list">
              <thead>
                <tr>
                  {sortBtn("num", "Número", { width: 116 })}
                  {sortBtn("desc", "Descrição")}
                  {sortBtn("svc", "Serviço", { width: 150 })}
                  {sortBtn("state", "Estado", { width: 128 })}
                  {sortBtn("priority", "Prioridade", { width: 104 })}
                  {sortBtn("when", "Aberto", { width: 96 })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk${i}`}>
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
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <StateBlock
                        icon={Icons.search}
                        title="Nenhum incidente neste recorte"
                        action={
                          <button className="btn btn-outline btn-sm" onClick={clearAll}>
                            Limpar filtros
                          </button>
                        }
                      >
                        Ajuste os filtros acima ou limpe a busca. O segmento{" "}
                        <b>Abertos</b> esconde os incidentes já resolvidos; mude para{" "}
                        <b>Todos</b> para ver o histórico completo.
                      </StateBlock>
                    </td>
                  </tr>
                ) : (
                  rows.map((x, i) => (
                    <tr
                      key={x.number}
                      className={kbd === i ? "kbd" : ""}
                      onClick={() => openIncident(x.number)}
                    >
                      <td className="num" data-label="Número">
                        {x.number}
                      </td>
                      <td className="desc" data-label="Descrição">
                        {x.short}
                      </td>
                      <td className="svc" data-label="Serviço">
                        {x.service}
                      </td>
                      <td data-label="Estado">
                        <StateBadge state={x.state} />
                      </td>
                      <td data-label="Prioridade">
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
          <div className="table-foot">
            <span>
              {loading
                ? "Carregando…"
                : `Mostrando ${rows.length} ${rows.length === 1 ? "resultado" : "resultados"}`}
            </span>
            <span className="shortcut-hint">
              <span className="kbd">J</span>
              <span className="kbd">K</span>
              Navegar
              <span className="sh-sep">·</span>
              <span className="kbd">↵</span>
              Abrir
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
