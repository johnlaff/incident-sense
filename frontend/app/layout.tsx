import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";

import "./globals.css";
import "./concepts.css";
import "./shell.css";
import { AppShell } from "@/components/app-shell";
import { AULA_BOOT_SCRIPT } from "@/lib/aula-machine";

// Atkinson Hyperlegible was drawn for readers with low vision: every letter
// and digit has a distinct shape (0 and O, 1, l and I), which is what a room
// reading INC numbers and scores from a projector or a phone at arm's length needs.
const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Incident Sense · Banco Meridiano",
  description:
    "Estação de trabalho ITSM com copiloto de IA: sugestão de resolução (RAG) fundamentada e detecção de recorrências, sobre incidentes de um banco fictício.",
};

// viewport-fit=cover lets the app draw under the iOS notch and home indicator;
// the shell pads itself back with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#131a2b",
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
