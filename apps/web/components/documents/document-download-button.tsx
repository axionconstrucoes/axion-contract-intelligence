"use client";

import { useState } from "react";

import { createSupabaseBrowserClient } from "@axion/db/browser";

import { Button } from "@/components/ui/button";

type Props = {
  bucket: string;
  filePath: string;
  originalFileName: string;
};

export function DocumentDownloadButton({
  bucket,
  filePath,
  originalFileName,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);

    try {
      const supabase =
        createSupabaseBrowserClient();

      const {
        data,
        error: signedUrlError,
      } = await supabase.storage
        .from(bucket)
        .createSignedUrl(
          filePath,
          60,
          {
            download: originalFileName,
          }
        );

      if (signedUrlError) {
        throw signedUrlError;
      }

      if (!data?.signedUrl) {
        throw new Error(
          "Não foi possível gerar o link temporário."
        );
      }

      window.location.assign(
        data.signedUrl
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível baixar o arquivo."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={handleDownload}
      >
        {loading
          ? "Preparando..."
          : "Baixar arquivo"}
      </Button>

      {error ? (
        <span className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
