// Shared icon set — stroke, currentColor, 24px grid. Ported from the
// Claude Design prototype (icons.jsx). Each icon takes an optional pixel
// `size` (else it inherits via CSS) and `sw` stroke-width.
import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
  sw?: number;
}

function icon(children: ReactNode, viewBox = "0 0 24 24") {
  function Icon({ size, className, sw = 2 }: IconProps) {
    return (
      <svg
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  }
  return Icon;
}

export type IconComponent = ReturnType<typeof icon>;

export const Icons = {
  search: icon(
    <>
      <circle cx={11} cy={11} r={7} />
      <path d="m21 21-4.3-4.3" />
    </>,
  ),
  incidents: icon(
    <>
      <rect x={3} y={4} width={18} height={16} rx={2} />
      <path d="M3 9h18M8 14h8M8 17h5" />
    </>,
  ),
  recurrences: icon(
    <>
      <circle cx={6} cy={7} r={2.4} />
      <circle cx={17} cy={6} r={2.4} />
      <circle cx={12} cy={16} r={2.4} />
      <circle cx={7.5} cy={17} r={1.6} />
      <path d="M8.2 7.6 10.6 15M15.4 7.2 13 14.6" />
    </>,
  ),
  how: icon(
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M9.3 9.2a2.7 2.7 0 1 1 3.4 2.6c-.7.3-1.2.8-1.2 1.7v.3" />
      <path d="M12 17h.01" />
    </>,
  ),
  sun: icon(
    <>
      <circle cx={12} cy={12} r={4} />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  moon: icon(<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />),
  command: icon(
    <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" />,
  ),
  check: icon(<path d="m5 12 5 5L20 7" />),
  checkCircle: icon(
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" />
    </>,
  ),
  loader: icon(<path d="M12 3a9 9 0 1 0 9 9" />),
  arrowRight: icon(<path d="M5 12h14M13 6l6 6-6 6" />),
  arrowLeft: icon(<path d="M19 12H5M11 18l-6-6 6-6" />),
  external: icon(<path d="M7 17 17 7M9 7h8v8" />),
  close: icon(<path d="M6 6l12 12M18 6 6 18" />),
  chevronDown: icon(<path d="m6 9 6 6 6-6" />),
  chevronRight: icon(<path d="m9 6 6 6-6 6" />),
  sparkle: icon(
    <>
      <path d="M12 3v3M5 8l2 2M19 8l-2 2" />
      <rect x={6} y={9} width={12} height={10} rx={3} />
      <path d="M10 14h4" />
    </>,
  ),
  aiSpark: icon(
    <path
      d="M12 2.4 Q13.2 10.8 21.6 12 Q13.2 13.2 12 21.6 Q10.8 13.2 2.4 12 Q10.8 10.8 12 2.4 Z"
      fill="currentColor"
      stroke="none"
    />,
  ),
  replay: icon(
    <>
      <path d="M3 2v6h6" />
      <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
    </>,
  ),
  assign: icon(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx={9} cy={7} r={4} />
      <path d="M19 8v6M22 11h-6" />
    </>,
  ),
  copy: icon(
    <>
      <rect x={9} y={9} width={12} height={12} rx={2} />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
  ),
  insert: icon(
    <>
      <path d="M5 12h11M11 7l5 5-5 5" />
      <path d="M20 5v14" />
    </>,
  ),
  filter: icon(<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  alert: icon(
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </>,
  ),
  inbox: icon(
    <>
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5.5 6h13l2.5 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z" />
    </>,
  ),
  promote: icon(<path d="M12 19V6M6 12l6-6 6 6" />),
  clock: icon(
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  summarize: icon(<path d="M5 6h14M5 10h14M5 14h9M5 18h6" />),
  embed: icon(
    <>
      <circle cx={7} cy={8} r={2} />
      <circle cx={17} cy={7} r={2} />
      <circle cx={15} cy={17} r={2} />
      <circle cx={7} cy={16} r={2} />
      <path d="M9 8.4 15.2 16.6M8.6 14.2 15.6 8.8" />
    </>,
  ),
  vectorSearch: icon(
    <>
      <circle cx={10} cy={10} r={6} />
      <path d="m21 21-4.3-4.3" />
      <path d="M10 7.5v5M7.5 10h5" />
    </>,
  ),
  funnel: icon(<path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />),
  classify: icon(<path d="M12 4v16M5 8l7-4 7 4M5 8v8l7 4 7-4V8" />),
  lightbulb: icon(
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M8 11a4 4 0 1 1 8 0c0 1.6-1 2.5-1.6 3.3-.4.5-.4 1-.4 1.7h-4c0-.7 0-1.2-.4-1.7C8.9 13.5 8 12.6 8 11Z" />
    </>,
  ),
  dot: icon(<circle cx={12} cy={12} r={4} />),
  enter: icon(
    <>
      <path d="M9 10 5 14l4 4" />
      <path d="M5 14h10a4 4 0 0 0 4-4V6" />
    </>,
  ),
  send: icon(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />),
  list: icon(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  bell: icon(
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>,
  ),
} satisfies Record<string, IconComponent>;
