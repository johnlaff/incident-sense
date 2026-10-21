"use client";

import { useAula } from "@/components/aula";
import { Icons } from "@/components/icons";

/** Shows whether modo aula is on, and turns it on or off in place. */
export function LessonModeSwitch() {
  const { aula, setAula } = useAula();
  return (
    <div className={`lesson-mode${aula ? " on" : ""}`}>
      <Icons.board />
      <p>
        {aula ? (
          <>
            <b>Modo aula ligado.</b> As animações param a cada passo, com legenda. Avance
            tocando em &quot;Próximo&quot;; no computador, também com a seta do teclado ou
            com o passador.
          </>
        ) : (
          <>
            <b>Modo aula desligado.</b> Ligue para ver cada passo devagar, com legenda.
          </>
        )}
      </p>
      <button
        type="button"
        className={`btn btn-sm ${aula ? "btn-outline" : "btn-primary"}`}
        onClick={() => setAula(!aula)}
        aria-pressed={aula}
      >
        {aula ? "Desligar" : "Ligar o modo aula"}
      </button>
    </div>
  );
}
