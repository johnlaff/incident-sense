import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";
import "./concepts.css";
import "./shell.css";
import { AppShell } from "@/components/app-shell";
import { AULA_BOOT_SCRIPT } from "@/lib/aula-machine";

// Inter for every word on screen: a neutral, very legible UI face that holds
// up on a phone and on a projector. JetBrains Mono only for record numbers and
// measured values: its 0 (dotted), O, 1, l and I all differ, which matters for
// a room reading INC0052233 from the back row.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Incident Sense · Banco Meridiano",
  description:
    "Estação de trabalho ITSM com copiloto de IA: sugestão de resolução (RAG) fundamentada e detecção de falhas que se repetem, sobre incidentes de um banco fictício.",
};

// viewport-fit=cover lets the app draw under the iOS notch and home indicator;
// the shell pads itself back with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

// Set the theme before paint so there is no light→dark flash on reload.
const themeScript = `(function(){try{var t=localStorage.getItem("is-theme")||"light";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      data-theme="light"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: AULA_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
