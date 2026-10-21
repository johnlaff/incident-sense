import Link from "next/link";

import { Icons } from "@/components/icons";
import { StateBlock } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="page-state">
      <StateBlock
        icon={Icons.search}
        title="Página não encontrada"
        action={
          <div className="state-actions">
            <Link className="btn btn-primary" href="/incidentes">
              Ir para incidentes
            </Link>
            <Link className="btn btn-ghost" href="/como-funciona">
              Como a IA funciona
            </Link>
          </div>
        }
      >
        Este endereço não existe no Incident Sense. Confira o link ou comece pela lista de
        incidentes.
      </StateBlock>
    </div>
  );
}
