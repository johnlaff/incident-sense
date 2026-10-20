import type { Metadata } from "next";
import Link from "next/link";

import "./aula.css";
import { LessonModeSwitch } from "./mode-switch";
import { ConceptIcon, ConceptLegend, RecordTag } from "@/components/concepts";
import { Icons } from "@/components/icons";
import { keepWhole } from "@/lib/text";

import { STOPS } from "./stops";

export const metadata: Metadata = {
  title: "Aula: como a IA ajuda depois do deploy · Incident Sense",
};

export default function LessonPage() {
  return (
    <div className="lesson">
      <header className="lesson-hero">
        <h1>Aula: como a IA ajuda depois do deploy</h1>
        <p className="lesson-lede">
          Um deploy quebrou o login do app do Banco Meridiano, um banco fictício. Siga
          quatro passos: a IA ajuda, uma pessoa decide.
        </p>
        <LessonModeSwitch />
      </header>

      <ol className="lesson-route" aria-label="Roteiro da aula">
        {STOPS.map((s) => (
          <li
            key={s.n}
            className={`lesson-stop${s.tone ? ` ${s.tone}` : ""}`}
            style={{ "--i": s.n - 1 } as React.CSSProperties}
          >
            <span className="stop-n" aria-hidden="true">
              {s.n}
            </span>
            <div className="stop-body">
              <div className="stop-head">
                {s.icon ? (
                  <span className="cicon k-rec" aria-hidden="true">
                    <s.icon />
                  </span>
                ) : (
                  <ConceptIcon concept={s.concept} />
                )}
                <h2>
                  <span className="sr-only">Passo {s.n}: </span>
                  {s.title}
                </h2>
              </div>
              <p>{s.line}</p>
              {s.picks ? (
                <ul className="stop-picks" aria-label="Exemplos para a demonstração">
                  {s.picks.map((p) => (
                    <li key={p.number}>
                      <Link href={p.href} className="stop-pick">
                        <RecordTag number={p.number} size="sm" />
                        <span className="pick-text">
                          <b>{keepWhole(p.title)}</b>
                          <small className="pick-status">
                            {/* Each fact stays whole; lines break at the dot. */}
                            {p.status.split(" · ").map((part, k) => (
                              <span key={part}>
                                {k > 0 ? " · " : null}
                                <span className="meta-item">{part}</span>
                              </span>
                            ))}
                          </small>
                          <small>{p.note}</small>
                        </span>
                        <Icons.chevronRight />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href={s.href} className="btn btn-outline stop-cta">
                {s.cta}
                <Icons.arrowRight />
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <section className="lesson-legend" aria-labelledby="legend-h">
        <div className="legend-head">
          <h2 id="legend-h">Como ler as cores e os ícones</h2>
          <p>Cada ideia tem sempre a mesma cor e o mesmo ícone.</p>
        </div>
        <ConceptLegend />
      </section>
    </div>
  );
}
