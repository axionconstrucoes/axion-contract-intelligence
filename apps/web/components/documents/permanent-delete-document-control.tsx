"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@axion/db/browser";

export function PermanentDeleteDocumentControl({
  documentId,
  documentTitle,
}: {
  documentId: string;
  documentTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: deleteError } = await supabase.rpc("delete_project_document", {
        p_document_id: documentId,
      });

      if (deleteError) throw deleteError;

      const storagePaths = Array.isArray(data)
        ? data.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("project-documents")
          .remove(storagePaths);

        if (storageError) {
          setError(
            "Documento excluído do ACC, mas alguns arquivos físicos não puderam ser removidos do Storage. A auditoria foi preservada."
          );
          router.refresh();
          return;
        }
      }

      setConfirming(false);
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível excluir definitivamente o documento."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        className="bg-red-700 text-white hover:bg-red-800"
        onClick={() => setConfirming(true)}
      >
        Excluir definitivamente
      </Button>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-1.5 rounded-md border border-red-300 bg-red-50 p-2 text-xs">
      <strong>Excluir definitivamente “{documentTitle}”?</strong>
      <span>
        Esta ação remove o documento operacional e suas versões. O registro de auditoria permanece.
      </span>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          className="bg-red-700 text-white hover:bg-red-800"
          disabled={busy}
          onClick={handleDelete}
        >
          {busy ? "Excluindo…" : "Confirmar exclusão"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Cancelar
        </Button>
      </div>
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}
