// Orquestração da coleta de metadados do Construmanager.
//
// Server-side apenas. Nada aqui é importado por Client Component:
// credenciais vêm de getConstrumanagerConfig() (process.env) e o token
// nunca sai desta função — não é retornado, não é logado, não é
// persistido.
//
// Estritamente somente leitura: Pasta/List, ListaMestra/List e
// Arquivo/List. Nenhum Objeto/Download, nenhum byte de documento.

import type { ConstrumanagerClient } from "./client";
import { normalizeFolders, normalizeMetadata } from "./normalize-metadata";
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
    throw new Error(
      `A conta configurada (${companyId}) não corresponde à empresa retornada pela API.`
    );
  }

  const userTypeId = Number(auth.user.type);

  if (!Number.isInteger(userTypeId) || userTypeId <= 0) {
    throw new Error(
      "A API não devolveu um tipo de usuário válido para montar a lista mestra."
    );
  }

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

  // 1) Pastas primeiro: os ids são entrada OBRIGATÓRIA de idObjeto na
  //    lista mestra. Sem eles a lista mestra devolve 200 com "Registro
  //    não encontrado" — um falso negativo silencioso.
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

  const folderIds = folders.map((folder) => folder.construmanager_folder_id);

  // 2) Fonte PRIMÁRIA: documentos vigentes + versões históricas.
  const masterList = await client.listMasterList(
    accessToken,
    companyId,
    workId,
    auth.user.id,
    userTypeId,
    folderIds
  );

  // 3) Fonte SECUNDÁRIA: extensão crua e conferência cruzada.
  const fileList = await client.listFiles(accessToken, companyId, workId);

  const normalized = normalizeMetadata(masterList, fileList);

  return {
    ...normalized,
    folders,
    companyId,
    workId,
    workName: configuredWork.name ?? null,
  };
}
