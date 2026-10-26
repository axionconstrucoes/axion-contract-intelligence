"use client";

// Casca offline do app de campo (/ssma/offline). NÃO contém dados de obra: lê do IndexedDB do
// aparelho o último usuário e o contexto mínimo dele (obra e nomes dos membros). Sem contexto
// guardado, orienta a abrir o app com internet uma vez. É a página que o service worker serve
// quando uma navegação para /ssma* falha por falta de rede.

import { useEffect, useState } from "react";
import { createIdbStore, LAST_USER_KEY, lastProjectKey, openOfflineDb, contextKey, type OfflineContext } from "@/lib/ssma/field-records/idb-store";
import { useFieldQueue } from "@/lib/ssma/field-records/use-field-queue";
import { FieldRecordsApp, type FieldProject } from "@/components/ssma/field-records/field-records-app";
import { SsmaHeader } from "@/components/ssma/ssma-chrome";

type Bootstrap = { userId: string; userLabel: string; project: FieldProject } | "EMPTY" | null;

export function SsmaOfflineShell() {
  const [boot, setBoot] = useState<Bootstrap>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = createIdbStore(await openOfflineDb());
        const last = await store.getMeta<{ userId: string }>(LAST_USER_KEY);
        const context = last ? await store.getMeta<OfflineContext>(contextKey(last.userId)) : null;
        const lastProjectId = last ? await store.getMeta<string>(lastProjectKey(last.userId)) : null;
        const project = context?.projects.find((entry) => entry.id === lastProjectId) ?? context?.projects[0];
        if (!cancelled) setBoot(last && context && project ? { userId: last.userId, userLabel: context.userLabel, project } : "EMPTY");
      } catch {
        if (!cancelled) setBoot("EMPTY");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot === null) return <div className="min-h-dvh bg-slate-100" aria-busy="true" />;
  if (boot === "EMPTY") {
    return (
      <div className="min-h-dvh bg-slate-100">
        <SsmaHeader title="SSMA/ESG" />
        <main className="mx-auto max-w-md space-y-3 p-6 text-center">
          <p className="text-lg font-black text-slate-900">Sem conexão</p>
          <p className="text-sm text-slate-700">Este aparelho ainda não tem uma obra guardada para uso sem sinal. Abra o app com internet, entre com a sua conta e acesse a obra uma vez.</p>
        </main>
      </div>
    );
  }
  return <OfflineApp userId={boot.userId} userLabel={boot.userLabel} project={boot.project} />;
}

function OfflineApp(props: { userId: string; userLabel: string; project: FieldProject }) {
  const queue = useFieldQueue(props.userId);
  return <FieldRecordsApp queue={queue} offlineShell {...props} />;
}
