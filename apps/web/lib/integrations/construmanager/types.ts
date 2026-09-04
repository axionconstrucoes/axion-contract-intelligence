export interface ConstrumanagerStatus {
  id: number;
  description: string;
  processamentoInicio?: string | null;
  processamentoFim?: string | null;
}

export interface ConstrumanagerAuthUser {
  id: number;
  name: string;
  email?: string | null;
  type?: string | number | null;
  companyId: number;
  companyTypeId?: number | null;
  token: string;
}

export interface ConstrumanagerAuthResponse {
  user: ConstrumanagerAuthUser;
  status: ConstrumanagerStatus;
}

export interface ConstrumanagerTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ConstrumanagerWork {
  id: number;
  name: string;
  zipCode?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  imageURL?: string | null;
  companyId: number;
}

export interface ConstrumanagerWorkListResponse {
  listWork: ConstrumanagerWork[];
  status: ConstrumanagerStatus;
}

export interface ConstrumanagerConfig {
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs: number;
}

// ============================================================
// Pacote B — metadados de documentos.
//
// Os tipos abaixo descrevem o CONTRATO REAL observado na obra piloto
// 34164, não uma suposição. Campos marcados como opcionais são os que
// de fato vieram nulos/ausentes em pelo menos uma linha real.
// ============================================================

// Pasta/List — { empresaId, obraId }.
// Atenção: parentId vem como STRING nesta rota (em Arquivo/List o
// mesmo conceito vem como number).
export interface ConstrumanagerFolder {
  id: number;
  parentId: string;
  name: string;
  text: string;
  level: number;
  path: string;
}

export interface ConstrumanagerFolderListResponse {
  listFolder: ConstrumanagerFolder[];
  status: ConstrumanagerStatus;
}

// Arquivo/List — { empresaId, obraId }. FONTE SECUNDÁRIA: usada para
// extensão e conferência cruzada, nunca para versionamento.
export interface ConstrumanagerFile {
  id: number;
  parentId: number;
  name: string;
  title: string;
  type: string;
  statusId: number;
  secondName: string;
  review: string;
  format: string;
  extension: string;
  upload: string;
  dataUpload: string;
  size: string;
  sizeNumber: number;
  hasVersion: boolean;
}

export interface ConstrumanagerFileListResponse {
  listFile: ConstrumanagerFile[];
  status: ConstrumanagerStatus;
}

// ListaMestra/List — contrato OFICIAL (ListaMestraBinder), validado.
// NÃO usa empresaId/obraId: usa idEmpresa/idObra e exige idUsuario,
// idTipoUsuario e idObjeto (ids de pasta separados por vírgula).
export interface ConstrumanagerMasterListRequest {
  id: string;
  isMostrarVersao: boolean;
  idEmpresa: number;
  idObra: number;
  idUsuario: number;
  idTipoUsuario: number;
  isMasterLider: boolean;
  idObjeto: string;
  isJSON: boolean;
}

// Somente os campos que a validação mostrou realmente preenchidos. Os
// outros ~27 campos do DTO vieram null em 208/208 linhas reais e não
// são modelados aqui de propósito.
export interface ConstrumanagerMasterListItem {
  isContemVersao: boolean;
  isVersao: number;
  cad_objects_id: number;
  // POLIMÓRFICO: pasta quando isVersao === 0; documento-cabeça quando
  // isVersao === 1.
  cad_objects_super: number;
  cad_objects_nome: string;
  cad_objects_caminho_pai: string;
  cad_objects_caminho_pai_versao?: string | null;
  cad_objects_versoes: string;
  cad_objects_tipos_id: number;
  cad_objects_nivel: number;
  cad_objects_original: number;
  cad_objects_tamanho: number;
  cad_objects_criacao: string;
  cad_objects_aprovado_data?: string | null;
  cad_objects_status?: string | null;
  cad_obra_id: number;
  cad_user_cons_id: number;
  cad_user_nome: string;
  autorAprovacao?: string | null;
}

export interface ConstrumanagerMasterListResponse {
  guid?: string | null;
  empresaID: number;
  listaMestra: ConstrumanagerMasterListItem[] | null;
  // Armadilha real: quando `top` é enviado na requisição, a API devolve
  // as linhas AQUI e deixa listaMestra vazia. Não enviamos `top`, mas
  // o parser tolera as duas formas.
  top: ConstrumanagerMasterListItem[] | null;
  total: number;
  status: ConstrumanagerStatus;
}

// ============================================================
// Formas normalizadas (fronteira entre a API e o banco).
// ============================================================

export interface NormalizedFolder {
  construmanager_folder_id: number;
  parent_folder_id: number | null;
  name: string;
  path: string;
  level: number;
}

export interface NormalizedDocument {
  construmanager_object_id: number;
  construmanager_folder_id: number;
  name: string;
  extension: string;
  extension_normalized: string;
  revision: string;
  revision_from_name: string | null;
  revision_conflict: boolean;
  has_versions: boolean;
  author_id: number | null;
  author_name: string | null;
  source_created_at_raw: string | null;
  source_created_at: string | null;
  source_approved_at_raw: string | null;
  source_approved_at: string | null;
  size_bytes: number | null;
  folder_path: string | null;
  status_label: string | null;
}

export interface NormalizedDocumentVersion {
  construmanager_version_object_id: number;
  construmanager_head_object_id: number;
  revision: string;
  revision_from_name: string | null;
  revision_conflict: boolean;
  name: string;
  extension: string;
  extension_normalized: string;
  author_id: number | null;
  author_name: string | null;
  source_created_at_raw: string | null;
  source_created_at: string | null;
  source_approved_at_raw: string | null;
  source_approved_at: string | null;
  size_bytes: number | null;
  folder_path: string | null;
  status_label: string | null;
}

// Conferência cruzada entre a fonte primária (ListaMestra/List) e a
// secundária (Arquivo/List). Diagnóstico puro: não altera a carga.
export interface MetadataCrossCheck {
  masterListDocuments: number;
  fileListDocuments: number;
  missingInFileList: number[];
  missingInMasterList: number[];
  revisionMismatches: number[];
}

export interface NormalizedMetadata {
  folders: NormalizedFolder[];
  documents: NormalizedDocument[];
  versions: NormalizedDocumentVersion[];
  // Versões cujo cabeça não veio na mesma resposta. Diagnóstico: nunca
  // viram vínculo inventado.
  orphanVersionIds: number[];
  crossCheck: MetadataCrossCheck;
}
