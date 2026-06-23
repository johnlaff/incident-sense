// Shared UI atoms (badges, meridian motif, avatar, empty/error block).
// Presentational only — safe as Server Components.
import type { ReactNode } from "react";

import { Icons, type IconComponent } from "./icons";
import {
  PRIORITY_LABEL,
  STATE_CLASS,
  STATE_LABEL,
  type Actor,
  type DsState,
  type PCode,
} from "@/lib/model";

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
    <span className={`badge ${priority}`} title={`Prioridade ${label}`}>
      <span className="dot" />
      {withWord ? `Prioridade · ${label}` : label}
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
