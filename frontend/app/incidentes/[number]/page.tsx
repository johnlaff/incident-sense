"use client";

// SCAFFOLD: data + routing plumbing only. The real record + activity stream +
// AI copilot panel land once the visual is locked. The data wiring (useIncident)
// and the route shape (/incidentes/[number]) carry over.

import Link from "next/link";
import { useParams } from "next/navigation";

import { useIncident } from "@/lib/incidents";

export default function IncidentDetailPage() {
  const params = useParams<{ number: string }>();
  const { data, loading, error } = useIncident(params.number);

  return (
    <main className="mx-auto max-w-3xl p-8 text-fg">
      <Link href="/incidentes" className="text-sm text-accent hover:underline">
        ← Incidentes
      </Link>

      {loading && <p className="mt-4 text-muted">Carregando…</p>}
      {error && <p className="mt-4 text-danger">{error}</p>}

      {data && (
        <article className="mt-4 space-y-3">
          <header>
            <p className="font-mono text-sm text-muted">{data.number}</p>
            <h1 className="text-xl font-semibold">{data.short_description}</h1>
            <p className="text-sm text-muted">
              {data.cmdb_ci} · {data.assignment_group} · {data.state} · P{data.priority}
            </p>
          </header>
          <p className="text-sm leading-relaxed">{data.description}</p>
          {data.resolution_notes && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Notas de resolução
              </h2>
              <p className="text-sm leading-relaxed">{data.resolution_notes}</p>
            </section>
          )}
          <p className="text-xs text-muted">{data.tags.join(" · ")}</p>
        </article>
      )}
    </main>
  );
}
