// Shared UI atoms (badges, meridian motif, avatar, empty/error block).
// Presentational only, safe as Server Components.
import { Fragment, type ReactNode } from "react";

import { Icons, type IconComponent } from "./icons";
import {
  PRIORITY_LABEL,
  STATE_CLASS,
  STATE_LABEL,
  type Actor,
  type DsState,
  type PCode,
} from "@/lib/model";
import { keepWhole } from "@/lib/text";

export function StateBadge({ state }: { state: DsState }) {
  return (
    <span className={`badge ${STATE_CLASS[state]}`}>
      {state === "resolved" ? <Icons.check sw={3} /> : <span className="dot" />}
      {STATE_LABEL[state]}
    </span>
  );
}

export function PriorityBadge({
  priority,
  withWord,
}: {
  priority: PCode;
  withWord?: boolean;
}) {
  const label = PRIORITY_LABEL[priority];
  return (
    <span className={`badge ${priority}`} title={`Prioridade ${label.toLowerCase()}`}>
      <span className="dot" />
      {withWord ? (
        <>
          <span className="badge-word">Prioridade </span>
          <span className="badge-level">{label.toLowerCase()}</span>
        </>
      ) : (
        label
      )}
    </span>
  );
}

export function Meridian({
  ticks = 24,
  style,
}: {
  ticks?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div className="meridian" style={style}>
      <div className="ticks">
        {Array.from({ length: ticks }).map((_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}

export function Avatar({ who, cls }: { who: Actor; cls?: string }) {
  return (
    <span className={`av ${cls ?? ""}${who.ai ? " ai" : ""}`} title={who.name}>
      {who.initials}
    </span>
  );
}

export function StateBlock({
  icon: Icon = Icons.inbox,
  variant,
  title,
  action,
  children,
}: {
  icon?: IconComponent;
  variant?: "error";
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`state-block ${variant ?? ""}`}>
      <div className="state-ico">
        <Icon />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action ?? null}
      <Meridian ticks={16} style={{ marginTop: 6 }} />
    </div>
  );
}

/**
 * Shown while a request is still pending after a few seconds. The public demo's
 * API sleeps when idle, so the first visitor of a talk waits up to a minute;
 * saying so (and that the screen fills itself in) beats a silent skeleton.
 */
export function WakeNotice({ show }: { show: boolean }) {
  return (
    <div className="wake-slot" role="status" aria-live="polite">
      {show ? (
        <div className="wake-notice">
          <Icons.loader className="spin" />
          <p>
            <b>Ligando o servidor da demonstração.</b> Na primeira visita isso leva até um
            minuto. A tela se completa sozinha.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Error block with a retry that re-runs the request instead of reloading. */
export function LoadError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <StateBlock
      icon={Icons.alert}
      variant="error"
      title={title}
      action={
        <button className="btn btn-outline btn-sm" onClick={onRetry}>
          <Icons.retry />
          Tentar de novo
        </button>
      }
    >
      {error}
    </StateBlock>
  );
}

/**
 * A record's meta line ("PIX-Core · Sustentacao-Pagamentos · aberto há 7
 * meses"). Each fact stays whole on one line; only the separators break.
 */
export function MetaLine({ items }: { items: (string | false | null | undefined)[] }) {
  const parts = items.filter((t): t is string => Boolean(t));
  return (
    <>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          <span className="meta-item">{keepWhole(t)}</span>
        </Fragment>
      ))}
    </>
  );
}
