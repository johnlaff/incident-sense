"use client";

// SCAFFOLD: data + routing plumbing only. The real ServiceNow-style table lands
// once the visual direction is locked in Claude Design. The data wiring here
// (URL filters → useIncidentList → links to the detail route) carries over.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { filtersFromParams, useIncidentList } from "@/lib/incidents";

function IncidentesScaffold() {
  const searchParams = useSearchParams();
  const filters = filtersFromParams(new URLSearchParams(searchParams.toString()));
  const { data, loading, error } = useIncidentList(filters);

  return (
    <main className="mx-auto max-w-4xl p-8 text-fg">
      <h1 className="mb-1 text-xl font-semibold">Incidentes (scaffold)</h1>
      <p className="mb-4 text-sm text-muted">
        Filtros: estado={filters.state} · serviço={filters.service ?? "—"} · busca=
        {filters.q ?? "—"} · página {filters.page}
      </p>

      {loading && <p className="text-muted">Carregando…</p>}
      {error && <p className="text-danger">{error}</p>}

      {data && (
        <>
          <p className="mb-3 text-sm text-muted">
            {data.total} resultados · {data.open_count} abertos · {data.resolved_count}{" "}
            resolvidos · {data.services.length} serviços
          </p>
          <ul className="space-y-1">
            {data.items.map((incident) => (
              <li key={incident.number}>
                <Link
                  href={`/incidentes/${incident.number}`}
                  className="text-accent hover:underline"
                >
                  <span className="font-mono">{incident.number}</span> —{" "}
                  {incident.short_description} [{incident.state}] P{incident.priority}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export default function IncidentesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Carregando…</p>}>
      <IncidentesScaffold />
    </Suspense>
  );
}
