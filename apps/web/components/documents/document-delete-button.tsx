"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@axion/db/browser";

import { Button } from "@/components/ui/button";

type Props = {
  documentId: string;
  documentTitle: string;
};

export function DocumentDeleteButton({
  documentId,
  documentTitle,
}: Props) {
  const router = useRouter();

  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(
      `Excluir o documento "${documentTitle}"?\n\n` +
        "O documento, suas versões, cláusulas derivadas e arquivos " +
        "serão removidos.\n\n" +
        "Se ele já estiver vinculado a uma evidência ou evento, " +
        "o ACC bloqueará a exclusão.\n\n" +
        "Esta operação não poderá ser desfeita."
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setErrorMessage(null);

    const supabase =
      createSupabaseBrowserClient();

    try {
      const {
        data: storagePaths,
        error: deleteError,
      } = await supabase.rpc(
        "delete_project_document",
        {
          p_document_id: documentId,
        }
      );

      if (deleteError) {
        throw deleteError;
      }

      const paths = Array.isArray(storagePaths)
        ? storagePaths.filter(
            (path): path is string =>
              typeof path === "string" &&
              path.length > 0
          )
        : [];

      if (paths.length > 0) {
        const { error: storageError } =
          await supabase.storage
            .from("project-documents")
            .remove(paths);

        if (storageError) {
          console.error(
            "Falha ao limpar Storage:",
            storageError
          );

          window.alert(
            "O documento foi excluído do ACC, " +
              "mas houve falha ao remover um ou mais " +
              "arquivos físicos do Storage. " +
              "A limpeza deverá ser verificada."
          );
        }
      }

      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error !== null &&
              "message" in error
            ? String(
                (error as { message: unknown }).message
              )
            : "Não foi possível excluir o documento.";

      console.error(
        "Falha ao excluir documento:",
        error
      );

      setErrorMessage(message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={deleting}
        onClick={handleDelete}
      >
        {deleting
          ? "Excluindo..."
          : "Excluir documento"}
      </Button>

      {errorMessage ? (
        <p className="max-w-md text-right text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}