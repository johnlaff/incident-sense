"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { ScatterMap } from "@/components/ScatterMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { PlotModel } from "@/lib/plot";
import type { Health, SuggestRequest, SuggestResponse } from "@/lib/types";

// The 3 planted demo incidents (clearly tagged in the dataset) drive the demo.
const DEMOS: { key: string; label: string; req: SuggestRequest }[] = [
  {
    key: "procedente",
    label: "Procedente · Pix",
    req: {
      short_description: "Pix confirmado para o cliente mas sem comprovante há 2h",
      description:
        "Cliente concluiu um Pix pelo app, o valor foi debitado, mas o comprovante não foi gerado e o status segue pendente há cerca de duas horas.",
      category: "Pagamentos",
      cmdb_ci: "PIX-Core",
    },
  },
  {
    key: "borderline",
    label: "Ambíguo · App/Cartão",
    req: {
      short_description: "App às vezes lento e recusa pagamento ao abrir extrato",
      description:
        "Cliente relata que o aplicativo fica lento em alguns momentos e, ao abrir o extrato, uma compra no cartão foi recusada.",
      category: "Canais Digitais",
      cmdb_ci: "App-Mobile",
    },
  },
  {
    key: "improcedente",
    label: "Improcedente · Senha",
    req: {
      short_description: "Esqueci minha senha do internet banking",
      description:
        "Cliente diz que esqueceu a senha de acesso ao internet banking e quer saber como redefinir. Não há indício de falha técnica.",
      category: "Acesso",
      cmdb_ci: "Login-IDP",
    },
  },
];

function average(
  points: { nx: number; ny: number }[],
): { nx: number; ny: number } | null {
  if (!points.length) return null;
  const sum = points.reduce((a, p) => ({ nx: a.nx + p.nx, ny: a.ny + p.ny }), {
    nx: 0,
    ny: 0,
  });
  return { nx: sum.nx / points.length, ny: sum.ny / points.length };
}

export function RagNeighborFlight({
  model,
  health,
}: {
  model: PlotModel;
  health: Health | null;
}) {
  const [request, setRequest] = useState<SuggestRequest>(DEMOS[0].req);
  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keysMissing =
    health != null && (!health.llm_configured || !health.embeddings_configured);

  // Map a candidate number to its position on the cluster map (if present).
  const positionOf = (id: string) => model.points.find((p) => p.id === id) ?? null;

  const candidateIds = result?.candidates.map((c) => c.number) ?? [];
  const survivingIds =
    result?.candidates.filter((c) => c.survived_postfilter).map((c) => c.number) ?? [];
  const neighborPositions = candidateIds
    .map(positionOf)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  // The incoming incident flies in near its neighbors; if none, sits isolated.
  const newPoint = result
    ? (average(neighborPositions) ?? { nx: -0.85, ny: 0.85 })
    : null;

  async function run(req: SuggestRequest) {
    setRequest(req);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.suggest(req));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[1fr_380px]">
      <div className="relative h-full min-h-[420px] overflow-hidden rounded-xl border border-border bg-bg/40">
        <ScatterMap
          points={model.points}
          categoryColors={model.categoryColors}
          mode="static"
          newPoint={newPoint}
          selectedIds={candidateIds}
          connectionIds={survivingIds}
        />
        {!result && !loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-xs text-center text-sm text-muted">
              Escolha um incidente-demo ou descreva um novo para ver o ponto voar até seus
              vizinhos mais parecidos.
            </p>
          </div>
        )}
      </div>

      <div className="flex h-full min-h-0 flex-col gap-3">
        <SuggestForm
          request={request}
          loading={loading}
          disabled={keysMissing}
          onRun={run}
        />
        {keysMissing && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            Configure <code>OPENAI_API_KEY</code> e <code>OPENROUTER_API_KEY</code> no{" "}
            <code>.env</code> para usar a sugestão ao vivo.
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            {error}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && <Streaming />}
          {result && <TransparencyPanel result={result} survivingIds={survivingIds} />}
        </div>
      </div>
    </div>
  );
}

function SuggestForm({
  request,
  loading,
  disabled,
  onRun,
}: {
  request: SuggestRequest;
  loading: boolean;
  disabled: boolean;
  onRun: (req: SuggestRequest) => void;
}) {
  const [short, setShort] = useState(request.short_description);
  const [desc, setDesc] = useState(request.description);

  return (
    <div className="rounded-xl border border-border bg-surface/80 p-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {DEMOS.map((d) => (
          <Button
            key={d.key}
            size="sm"
            variant="outline"
            disabled={loading || disabled}
            onClick={() => {
              setShort(d.req.short_description);
              setDesc(d.req.description);
              onRun(d.req);
            }}
          >
            {d.label}
          </Button>
        ))}
      </div>
      <input
        value={short}
        onChange={(e) => setShort(e.target.value)}
        placeholder="Resumo do incidente"
        className="mb-2 w-full rounded-md border border-border bg-bg/60 px-2.5 py-1.5 text-sm text-fg outline-none placeholder:text-muted focus:border-accent/60"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Descrição"
        rows={3}
        className="mb-2 w-full resize-none rounded-md border border-border bg-bg/60 px-2.5 py-1.5 text-sm text-fg outline-none placeholder:text-muted focus:border-accent/60"
      />
      <Button
        className="w-full"
        disabled={loading || disabled || !short.trim() || !desc.trim()}
        onClick={() => onRun({ short_description: short, description: desc })}
      >
        {loading ? "Analisando…" : "Sugerir resolução"}
      </Button>
    </div>
  );
}

function Streaming() {
  return (
    <div className="space-y-2">
      {["Resumindo consulta…", "Buscando vizinhos…", "Filtrando e classificando…"].map(
        (label, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
            className="rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-muted"
          >
            {label}
          </motion.div>
        ),
      )}
    </div>
  );
}

function Section({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: step * 0.18, duration: 0.35 }}
    >
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      {children}
    </motion.div>
  );
}

function TransparencyPanel({
  result,
  survivingIds,
}: {
  result: SuggestResponse;
  survivingIds: string[];
}) {
  const procedente = result.classification === "PROCEDENTE";
  return (
    <div className="space-y-3 text-sm">
      <Section step={0} title="Consulta resumida">
        <p className="rounded-md border border-border bg-surface/60 px-3 py-2 text-fg">
          {result.summarized_query}
        </p>
      </Section>

      <Section step={1} title={`Candidatos (${result.candidates.length})`}>
        <div className="space-y-1.5">
          {result.candidates.map((c) => (
            <div
              key={c.number}
              className="rounded-md border border-border bg-surface/60 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{c.number}</span>
                <span className="ml-auto tabular-nums text-xs text-muted">
                  {c.similarity.toFixed(3)}
                </span>
                <Badge variant={c.survived_postfilter ? "success" : "danger"}>
                  {c.survived_postfilter ? "mantido" : "descartado"}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-fg">{c.short_description}</div>
              {/* similarity bar */}
              <div className="mt-1.5 h-1 overflow-hidden rounded bg-bg/80">
                <div
                  className="h-full rounded bg-accent"
                  style={{ width: `${Math.max(0, Math.min(1, c.similarity)) * 100}%` }}
                />
              </div>
              {c.postfilter_reason && (
                <div className="mt-1 text-[11px] text-muted">{c.postfilter_reason}</div>
              )}
            </div>
          ))}
          {result.candidates.length === 0 && (
            <p className="text-xs text-muted">Nenhum candidato acima do limiar.</p>
          )}
        </div>
      </Section>

      <Section step={2} title="Classificação">
        <Badge variant={procedente ? "success" : "danger"} className="text-sm">
          {result.classification}
        </Badge>
      </Section>

      {result.suggestion && (
        <Section step={3} title="Sugestão fundamentada">
          <p className="whitespace-pre-wrap rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-fg">
            {result.suggestion}
          </p>
          {result.referenced_incidents.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.referenced_incidents.map((n) => (
                <Badge
                  key={n}
                  variant={survivingIds.includes(n) ? "accent" : "default"}
                  className="font-mono"
                >
                  {n}
                </Badge>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
