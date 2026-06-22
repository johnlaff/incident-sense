"use client";

import { useEffect, useMemo, useState } from "react";

import { ClusterReveal } from "@/components/ClusterReveal";
import { RagNeighborFlight } from "@/components/RagNeighborFlight";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { buildPlotModel } from "@/lib/plot";
import type { ClustersResponse, Health } from "@/lib/types";

type Tab = "reveal" | "suggest";

export default function Home() {
  const [clusters, setClusters] = useState<ClustersResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("reveal");

  useEffect(() => {
    api
      .getClusters()
      .then(setClusters)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.detail : "Falha ao carregar os clusters."),
      );
    api
      .getHealth()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  const model = useMemo(() => (clusters ? buildPlotModel(clusters) : null), [clusters]);

  return (
    <main className="mx-auto flex h-screen max-w-7xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">
            incident<span className="text-accent">-sense</span>
          </h1>
          <p className="text-sm text-muted">
            Sugestão de resolução e detecção de recorrência para incidentes de TI · dados
            sintéticos do fictício Banco Meridiano
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg border border-border bg-surface/60 p-1">
          <Button
            variant={tab === "reveal" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("reveal")}
          >
            Recorrência
          </Button>
          <Button
            variant={tab === "suggest" ? "default" : "ghost"}
            size="sm"
            onClick={() => setTab("suggest")}
          >
            Sugestão (RAG)
          </Button>
        </nav>
      </header>

      <section className="min-h-0 flex-1">
        {error && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md rounded-xl border border-danger/40 bg-danger/10 p-6 text-center text-sm text-danger">
              {error}
              <p className="mt-2 text-muted">
                A API está rodando? Tente <code>docker compose up</code>.
              </p>
            </div>
          </div>
        )}

        {!error && !model && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Carregando o mapa de incidentes…
          </div>
        )}

        {model && clusters && (
          <div className="h-full">
            {tab === "reveal" ? (
              <ClusterReveal model={model} clusters={clusters.clusters} />
            ) : (
              <RagNeighborFlight model={model} health={health} />
            )}
          </div>
        )}
      </section>
    </main>
  );
}
