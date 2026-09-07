// Orquestração da coleta de metadados do Construmanager.
//
// Server-side apenas. Nada aqui é importado por Client Component:
// credenciais vêm de getConstrumanagerConfig() (process.env) e o token
// nunca sai desta função — não é retornado, não é logado, não é
// persistido.
//
// Estritamente somente leitura: Obra/List, Pasta/List e Arquivo/List.
// Nenhum ListaMestra/List, nenhum Objeto/Download, nenhum byte de documento.

import type { ConstrumanagerClient } from "./client";
import { normalizeFileListMetadata, normalizeFolders } from "./normalize-metadata";
import type { NormalizedMetadata } from "./types";

export interface CollectedConstrumanagerMetadata extends NormalizedMetadata {
  companyId: number;
  workId: number;
  workName: string | null;
}

export async function collectConstrumanagerMetadata(
  client: ConstrumanagerClient,
  companyId: number,
  workId: number
): Promise<CollectedConstrumanagerMetadata> {
  const auth = await client.authenticate();

  if (auth.user.companyId !== companyId) {
    // Sem interpolar o valor recebido. Quando um chamador erra a
    // assinatura, este parâmetro pode conter qualquer coisa — inclusive
    // um access token —, e a mensagem vai parar em log de CI. Uma
    // mensagem de erro nunca deve ser um canal de exfiltração: o que ela
    // precisa dizer é QUAL invariante quebrou, não com que valor.
    throw new Error(
      "A conta configurada não corresponde à empresa retornada pela API."
    );
  }

  // `idTipoUsuario` era exigência exclusiva de ListaMestra/List. Sem ela
  // no caminho, validar esse campo só criaria uma forma nova de falhar
  // por um dado que ninguém mais usa.

  const token = await client.getAccessToken(auth.user.token);
  const accessToken = token.access_token;

  // A obra precisa estar disponível para este usuário — mesma checagem
  // do Pacote A, para não sincronizar uma obra fora de escopo.
  const works = await client.listWorks(accessToken, companyId);
  const configuredWork = works.listWork.find((work) => work.id === workId);

  if (!configuredWork) {
    throw new Error(
      `A obra configurada (${workId}) não está disponível para este usuário no Construmanager.`
    );
  }

  // 1) Pastas: unica fonte do caminho legivel, e o `parentId` de cada
  //    arquivo aponta para um id daqui.
  const folderResponse = await client.listFolders(
    accessToken,
    companyId,
    workId
  );
  const folders = normalizeFolders(folderResponse);

  if (folders.length === 0) {
    throw new Error(
      "A obra não possui pastas no Construmanager; não há metadados a sincronizar."
    );
  }

  // 2) Arquivos vigentes. FONTE UNICA desde a decisão de escopo somente
  //    metadados: ListaMestra/List saiu do caminho crítico por estar
  //    quebrada na obra (falha idêntica pelo worker headless e pela UI) e
  //    por ser dispensável neste recorte — a validação isolada do run
  //    34078849742 mediu Arquivo/List devolvendo 192 de 192 documentos,
  //    com 192 revisões idênticas e nenhum ausente, divergente ou
  //    inválido.
  //
  //    O que se perde, e a decisão de escopo aceitou: versões históricas
  //    deixam de ser coletadas (as já gravadas ficam intactas, porque o
  //    núcleo SQL só faz upsert), e não se sabe qual objeto foi
  //    substituído numa troca de revisão.
  const fileList = await client.listFiles(accessToken, companyId, workId);

  const normalized = normalizeFileListMetadata(fileList, folders);

  return {
    ...normalized,
    folders,
    companyId,
    workId,
    workName: configuredWork.name ?? null,
  };
}
