"use client";

// Composição cliente da análise jurídica pré-contratual: o card de
// documento e a consulta ao especialista compartilham um único estado.
//
// A pergunta e a resposta NÃO são persistidas — vivem apenas no
// `useActionState` desta página. Recarregar zera a conversa por design
// (sem histórico, sem tabela, sem auditoria). O documento, esse sim,
// continua armazenado como qualquer upload, e por isso a tela volta a
// reconhecê-lo depois de um F5 sem exigir reenvio.

import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { PrecontractDocumentCard } from "@/components/legal/precontract-document-card";
import { usePrecontractUpload } from "@/components/legal/use-precontract-upload";
import { askLegalConsultantAction } from "@/lib/ai/legal-query-action";
import { initialAskCommercialDirectorState } from "@/lib/ai/expert-query-state";
import type { ExistingDocumentSnapshot } from "@/lib/documents/multi-upload/types";
import {
  precontractQueryBlockReason,
  type PrecontractExistingDocument,
} from "@/lib/legal/precontract-document-state";

export function PrecontractWorkspaceClient({
  projectId,
  canUpload,
  existingDocuments,
  classificationSnapshots,
}: {
  projectId: string;
  canUpload: boolean;
  existingDocuments: PrecontractExistingDocument[];
  classificationSnapshots: ExistingDocumentSnapshot[];
}) {
  const { items, addFile, cancelUpload, resolveDecision, retry } = usePrecontractUpload({
    projectId,
    existingDocuments,
    classificationSnapshots,
  });

  const blockReason = precontractQueryBlockReason(items);

  return (
    <>
      <PrecontractDocumentCard
        canUpload={canUpload}
        items={items}
        onAddFile={addFile}
        onCancel={cancelUpload}
        onResolveDecision={resolveDecision}
        onRetry={retry}
      />

      <ExpertQueryPanel
        projectId={projectId}
        scope="PROJECT"
        title="Pergunte ao especialista jurídico"
        action={askLegalConsultantAction}
        initialState={initialAskCommercialDirectorState}
        disabledReason={blockReason}
      />
    </>
  );
}
