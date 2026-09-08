import { notFound, redirect } from "next/navigation";

// Mesma remoção de interface da lista (../page.tsx) — ver comentário lá.
// O detalhe de uma proposta específica não tem mais tela própria;
// redireciona para Documentos do mesmo projeto, preservando `projectId`.
// `proposalId` não é validado contra o banco aqui de propósito: a rota
// não existe mais como destino navegável, só como redirecionamento —
// não há necessidade de consultar Supabase para isso.
export default async function AdditionalProposalDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; proposalId: string }>;
}) {
  const { projectId } = await params;

  if (!projectId) notFound();

  redirect(`/${projectId}/documentos`);
}
