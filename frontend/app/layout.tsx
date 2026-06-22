import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "incident-sense",
  description:
    "Sugestão de resolução (RAG) e detecção de recorrência para incidentes de TI de um banco fictício.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
