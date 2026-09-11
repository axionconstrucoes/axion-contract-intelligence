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
    // Duas colunas a partir de lg: documento a esquerda, consulta a
    // direita. `items-start` impede que um card estique para acompanhar
    // a altura do outro (a resposta do especialista cresce muito), e
    // `min-w-0` deixa o conteudo longo encolher em vez de estourar a
    // grade. Abaixo de lg os cards empilham na ordem natural do DOM —
    // documento primeiro, que e a ordem do fluxo: sem documento legivel
    // a consulta nem fica disponivel.
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <div className="min-w-0">
        <PrecontractDocumentCard
          canUpload={canUpload}
          items={items}
          onAddFile={addFile}
          onCancel={cancelUpload}
          onResolveDecision={resolveDecision}
          onRetry={retry}
        />
      </div>

      <div className="min-w-0">
        <ExpertQueryPanel
          projectId={projectId}
          scope="PROJECT"
          title="Pergunte ao especialista jurídico"
          action={askLegalConsultantAction}
          initialState={initialAskCommercialDirectorState}
          disabledReason={blockReason}
        />
      </div>
    </div>
  );
}
