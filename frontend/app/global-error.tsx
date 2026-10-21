"use client";

import "./globals.css";

/** The last net: the whole layout failed. Plain HTML, in Portuguese. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <main className="page-state">
          <div className="state-block error">
            <h2>O Incident Sense não carregou</h2>
            <p>Algo deu errado ao abrir o site. Os dados não foram alterados.</p>
            <div className="state-actions">
              <button className="btn btn-outline" onClick={reset}>
                Tentar de novo
              </button>
              {/* A full reload, not a client navigation: the layout is broken. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="btn btn-ghost" href="/incidentes">
                Ir para incidentes
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
