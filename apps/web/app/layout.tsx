import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXION Contract Intelligence",
  description: "Plataforma de inteligência contratual para obras e projetos da Axion Engenharia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
