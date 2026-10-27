"use client";

import { useEffect, useMemo, useState } from "react";
import { reviewClauseCandidateAction } from "@/app/[projectId]/revisao-clausulas/actions";

// Formulário de revisão de UM candidato (aberto só ao selecionar o item).
// Rascunho: salvo em sessionStorage por candidato a cada alteração e
// restaurado ao voltar ao item — trocar de item nunca perde o que foi
// digitado. Fechar/recarregar a aba com alterações pede confirmação.
// A decisão continua 100% na RPC (permissões e auditoria inalteradas).

type Draft = {
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  approveNote: string;
  rejectNote: string;
};

export const CLAUSE_DRAFT_PREFIX = "acc:clause-review-draft:";

export function ClauseCandidateReviewForm({
  projectId,
  candidateId,
  initial,
  returnTo,
}: {
  projectId: string;
  candidateId: string;
  initial: { clauseNumber: string; clauseTitle: string; clauseText: string };
  returnTo: string;
}) {
  const storageKey = `${CLAUSE_DRAFT_PREFIX}${candidateId}`;
  const pristine: Draft = useMemo(() => ({ ...initial, approveNote: "", rejectNote: "" }), [initial]);
  const [draft, setDraft] = useState<Draft>(pristine);
  const [restored, setRestored] = useState(false);
  const [checkedOriginal, setCheckedOriginal] = useState(false);

  // Restaura rascunho salvo deste candidato (se houver).
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Draft>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única do storage após montar
        setDraft({ ...pristine, ...parsed });
        setRestored(true);
      }
    } catch {
      // storage indisponível: segue sem rascunho
    }
  }, [storageKey, pristine]);

  const dirty = (Object.keys(pristine) as Array<keyof Draft>).some((key) => draft[key] !== pristine[key]);

  // Salva a cada alteração; remove quando volta ao original.
  useEffect(() => {
    try {
      if (dirty) window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // ignora
    }
  }, [dirty, draft, storageKey]);

  // Aviso ao fechar/recarregar a aba com alterações.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  const discard = () => {
    setDraft(pristine);
    setRestored(false);
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // ignora
    }
  };

  const inputClass =
    "rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="flex flex-col gap-4">
      {restored && dirty ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
          <span>Rascunho não enviado restaurado para este candidato.</span>
          <button type="button" onClick={discard} className="font-medium underline underline-offset-2">
            Descartar rascunho
          </button>
        </div>
      ) : dirty ? (
        <p className="text-xs text-muted-foreground">Alterações salvas como rascunho nesta aba (ainda não enviadas).</p>
      ) : null}

      <form action={reviewClauseCandidateAction} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="APPROVE" />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Número da cláusula
          <input name="clauseNumber" value={draft.clauseNumber} onChange={update("clauseNumber")} required className={`h-9 ${inputClass}`} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Título
          <input name="clauseTitle" value={draft.clauseTitle} onChange={update("clauseTitle")} required className={`h-9 ${inputClass}`} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Texto contratual
          <textarea
            name="clauseText"
            value={draft.clauseText}
            onChange={update("clauseText")}
            required
            rows={10}
            className={`min-h-48 resize-y p-3 leading-6 ${inputClass}`}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Observação da revisão <span className="text-xs font-normal text-muted-foreground">Opcional para aprovação.</span>
          <textarea
            name="reviewNote"
            value={draft.approveNote}
            onChange={update("approveNote")}
            rows={2}
            placeholder="Ex.: numeração ajustada conforme documento original."
            className={`resize-y p-3 ${inputClass}`}
          />
        </label>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            required
            checked={checkedOriginal}
            onChange={(event) => setCheckedOriginal(event.target.checked)}
            className="mt-0.5"
          />
          Conferi número, título e texto com a página original do contrato.
        </label>

        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Aprovar cláusula
        </button>
      </form>

      <form action={reviewClauseCandidateAction} className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="candidateId" value={candidateId} />
        <input type="hidden" name="reviewAction" value="REJECT" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <p className="text-sm font-medium">Rejeitar candidato</p>
        <p className="text-xs text-muted-foreground">A rejeição exige justificativa e fica registrada na auditoria.</p>
        <textarea
          name="reviewNote"
          value={draft.rejectNote}
          onChange={update("rejectNote")}
          required
          rows={3}
          placeholder="Informe por que este trecho não deve ser tratado como cláusula."
          className={`resize-y p-3 ${inputClass}`}
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-md border border-destructive/40 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          Rejeitar candidato
        </button>
      </form>
    </div>
  );
}

// Indicador de rascunho na lista e limpeza de rascunho de item já
// decidido (aprovado/rejeitado) — componentes pequenos, só cliente.
export function ClauseDraftBadge({ candidateId }: { candidateId: string }) {
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única do storage após montar
      setHasDraft(Boolean(window.sessionStorage.getItem(`${CLAUSE_DRAFT_PREFIX}${candidateId}`)));
    } catch {
      // ignora
    }
  }, [candidateId]);
  return hasDraft ? (
    <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-900">rascunho</span>
  ) : null;
}

export function ClearClauseDraft({ candidateId }: { candidateId: string }) {
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(`${CLAUSE_DRAFT_PREFIX}${candidateId}`);
    } catch {
      // ignora
    }
  }, [candidateId]);
  return null;
}
