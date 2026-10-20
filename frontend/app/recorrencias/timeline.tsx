"use client";

import type { CSSProperties } from "react";

import { monthLabel, shortDate, type RecGroup } from "./model";

/**
 * Incidents per week for one group: one bar per week, the tallest bar sets
 * the scale. Bars grow from the baseline in order, so the eye reads time
 * left to right. A selected month dims the weeks outside it.
 */
export function GroupTimeline({
  group,
  weeks,
  month,
  compact = false,
}: {
  group: RecGroup;
  weeks: string[];
  month: string | null;
  compact?: boolean;
}) {
  if (weeks.length === 0) return null;
  const max = Math.max(1, ...group.perWeek);
  const peak = group.perWeek.indexOf(max);
  const ticks: { i: number; label: string }[] = [];
  weeks.forEach((w, i) => {
    const prev = weeks[i - 1];
    if (i === 0 || prev.slice(0, 7) !== w.slice(0, 7)) ticks.push({ i, label: monthLabel(w.slice(0, 7)) });
  });
  const summary =
    `${group.size} incidentes em ${group.activeWeeks} das ${weeks.length} semanas` +
    (group.firstAt && group.lastAt ? `, de ${shortDate(group.firstAt)} a ${shortDate(group.lastAt)}` : "") +
    `. Pico de ${max} na semana de ${shortDate(weeks[peak])}.`;

  return (
    <figure className={`rx-tl${compact ? " compact" : ""}`} style={{ "--weeks": weeks.length } as CSSProperties}>
      <div className="rx-tl-head">
        <span className="rx-tl-t">Quando aconteceram</span>
        <span className="rx-tl-s">
          {group.activeWeeks} de {weeks.length} semanas · pico de {max} em {shortDate(weeks[peak])}
        </span>
      </div>
      <div className="rx-tl-plot" role="img" aria-label={summary}>
        {group.perWeek.map((n, i) => {
          const inMonth =
            !month || weeks[i].slice(0, 7) === month || addDays(weeks[i], 6).slice(0, 7) === month;
          return (
            <span
              key={weeks[i]}
              className={`rx-tl-bar${n === 0 ? " zero" : ""}${inMonth ? "" : " out"}${i === peak ? " peak" : ""}`}
              style={
                {
                  "--v": n / max,
                  "--i": i,
                } as CSSProperties
              }
              title={`Semana de ${shortDate(weeks[i])}: ${n} ${n === 1 ? "incidente" : "incidentes"}`}
            />
          );
        })}
      </div>
      <div className="rx-tl-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.i} style={{ "--at": t.i } as CSSProperties}>
            {t.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
