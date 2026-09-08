import { notFound, redirect } from "next/navigation";

// Aba "Serviços Adicionais" removida da interface: dependia da
// importação automática de propostas do Drive de Orçamentos, integração
// definitivamente cancelada. Nova regra: serviço adicional aprovado
// entra no ACC por upload manual do ADM, na área de Documentos.
//
// A rota antiga não fica acessível por link direto — redireciona para
// Documentos do MESMO projeto, preservando `projectId`. Nenhum dado,
// tabela ou lógica de negócio de apps/web/lib/additionals foi removido
// ou alterado: só o ponto de entrada de interface deixou de existir.
export default async function AdditionalProposalsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  if (!projectId) notFound();

  redirect(`/${projectId}/documentos`);
}
