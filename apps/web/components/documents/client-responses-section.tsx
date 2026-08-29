import { createSupabaseServerClient } from "@axion/db/server";
import { Badge } from "@/components/ui/badge";
import {
  getDocumentVersionClientResponses,
  hasContestedClientResponse,
} from "@/lib/documents/client-responses/get-document-version-client-responses";
import { formatDateTime } from "@/lib/labels";
import type { ClientResponseRelationType } from "@/lib/documents/client-responses/types";

// "RESPOSTAS DO CLIENTE" (Bloco 6 — MVP controlado) — seção compacta
// no card do documento, mostrando remetente/data/relação/trecho/acesso
// ao e-mail. Nunca reescreve a versão original (só lê o vínculo lateral
// document_version_client_responses). O badge "CONTESTADO PELO
// CLIENTE" aparece quando há divergência real (DISCORDA/CORRIGE/
// RESSALVA) — isso NUNCA invalida o documento nem constitui alteração
// contratual por si só, é só um sinalizador visual de atenção.
const RELATION_LABELS: Record<ClientResponseRelationType, string> = {
  RESPONDE: "Responde",
  DISCORDA: "Discorda",
  CORRIGE: "Corrige",
  RESSALVA: "Ressalva",
  COMPLEMENTA: "Complementa",
};

export async function ClientResponsesSection({ documentVersionId }: { documentVersionId: string }) {
  const supabase = await createSupabaseServerClient();
  const responses = await getDocumentVersionClientResponses(supabase, documentVersionId);

  if (responses.length === 0) {
    return null;
  }

  const contested = hasContestedClientResponse(responses);

  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-md border border-dashed p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold">Respostas do cliente</span>
        {contested ? <Badge variant="destructive">CONTESTADO PELO CLIENTE</Badge> : null}
      </div>
      {responses.map((response) => (
        <div key={response.id} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{RELATION_LABELS[response.relationType]}</span>
          {" — "}
          {response.emailFromAddress} · {formatDateTime(response.emailSentAt)}
          {response.excerpt ? <span> — &quot;{response.excerpt}&quot;</span> : null}
        </div>
      ))}
    </div>
  );
}
