// "Ao marcar CONTRATADO, o ACC deve PRIMEIRO procurar automaticamente o
// que já existe no sistema. Não pedir upload duplicado." — busca
// determinística por número da proposta no título de documentos e no
// assunto de e-mails já existentes no projeto. Nunca decide sozinho;
// apenas sugere candidatos para o humano vincular (ver
// link-additional-proposal-source.ts).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SuggestedDocumentSource {
  documentVersionId: string;
  documentTitle: string;
  documentKind: string;
  versionLabel: string;
}

export interface SuggestedEmailSource {
  emailId: string;
  subject: string;
  sentAt: string;
}

export interface SuggestedExistingSources {
  documents: SuggestedDocumentSource[];
  emails: SuggestedEmailSource[];
}

/** Sempre a versão mais recente de cada documento candidato — nunca uma versão obsoleta sugerida por engano. */
export async function suggestExistingSourcesForProposal(
  supabase: SupabaseClient,
  projectId: string,
  proposalNumber: string
): Promise<SuggestedExistingSources> {
  const needle = proposalNumber.trim();
  if (!needle) return { documents: [], emails: [] };

  const [documentsResult, emailsResult] = await Promise.all([
    supabase
      .from("documents")
      .select("id,kind,title,document_versions(id,version_label,version_index)")
      .eq("project_id", projectId)
      .ilike("title", `%${needle}%`),
    supabase.from("emails").select("id,subject,sent_at").eq("project_id", projectId).ilike("subject", `%${needle}%`).order("sent_at", { ascending: false }),
  ]);

  if (documentsResult.error) throw new Error(`Falha ao buscar documentos existentes: ${documentsResult.error.message}`);
  if (emailsResult.error) throw new Error(`Falha ao buscar e-mails existentes: ${emailsResult.error.message}`);

  type DocumentRow = { id: string; kind: string; title: string; document_versions: { id: string; version_label: string; version_index: number }[] };

  const documents: SuggestedDocumentSource[] = (documentsResult.data as unknown as DocumentRow[])
    .map((doc) => {
      const latest = [...doc.document_versions].sort((a, b) => b.version_index - a.version_index)[0];
      if (!latest) return null;
      return { documentVersionId: latest.id, documentTitle: doc.title, documentKind: doc.kind, versionLabel: latest.version_label };
    })
    .filter((v): v is SuggestedDocumentSource => v !== null);

  const emails: SuggestedEmailSource[] = (emailsResult.data as unknown as { id: string; subject: string; sent_at: string }[]).map((e) => ({
    emailId: e.id,
    subject: e.subject,
    sentAt: e.sent_at,
  }));

  return { documents, emails };
}
