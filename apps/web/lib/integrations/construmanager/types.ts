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
