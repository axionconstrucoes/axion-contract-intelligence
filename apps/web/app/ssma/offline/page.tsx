import type { Metadata } from "next";
import { SsmaOfflineShell } from "@/components/ssma/ssma-offline-shell";

export const metadata: Metadata = { title: "Sem conexão" };

// Casca estática: sem dados de obra e sem leitura de cookies — é guardada pelo service worker.
export default function SsmaOfflinePage() {
  return <SsmaOfflineShell />;
}
