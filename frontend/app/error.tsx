"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Icons } from "@/components/icons";
import { StateBlock } from "@/components/ui";

/** A screen that broke while drawing: say so in Portuguese and offer a way out. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page-state">
      <StateBlock
        variant="error"
        icon={Icons.alert}
        title="Esta tela não carregou"
        action={
          <div className="state-actions">
            <button className="btn btn-outline" onClick={reset}>
              <Icons.retry />
              Tentar de novo
            </button>
            <Link className="btn btn-ghost" href="/incidentes">
              Ir para incidentes
            </Link>
          </div>
        }
      >
        Algo deu errado ao montar a tela. Os dados não foram alterados.
      </StateBlock>
    </div>
  );
}
