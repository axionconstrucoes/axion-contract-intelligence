import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RegistryPage } from "@/lib/email/registry/email-document-registry-data";
import {
  EMAIL_CLASSIFICATION_LABELS,
  REGISTRY_CLASSIFICATION_OPTIONS,
  type RegistrySearchParams,
} from "@/lib/email/registry/email-document-registry-shared";
import { formatDate } from "@/lib/labels";
import { cn } from "@/lib/utils";

// Registro documental por e-mail (aba "Registro por e-mail" em
// Documentos). A UNIDADE da lista é o ENVIO por e-mail (message_id); a
// busca, os filtros e a paginação são server-side (função SQL com RLS)
// — nada é carregado "inteiro" no cliente. Formulário GET simples:
// funciona sem JS, com teclado e leitores de tela.

export const INTAKE_STATUS_LABELS: Record<string, string> = {
  AUTHORIZED_AUTO: "Autorizado (automático)",
  PENDING_HUMAN_REVIEW: "Pendente de revisão humana",
  APPROVED_HUMAN_REVIEW: "Aprovado em revisão",
  REJECTED_HUMAN_REVIEW: "Rejeitado em revisão",
  REJECTED_UNAUTHORIZED_SENDER: "Remetente não autorizado",
  REJECTED_RECIPIENT_MISMATCH: "Destinatário fora do cliente",
  IGNORED_NO_MPP: "Sem .mpp",
  IGNORED_OUTSIDE_WINDOW: "Fora da janela",
  RECEIVED_DUPLICATE: "Recebido (arquivo já conhecido)",
  FAILED: "Falha",
};

export const RISK_LABELS: Record<string, string> = {
  LOW: "Baixo",
  MEDIUM: "Médio",
  HIGH: "Alto",
  CRITICAL: "Crítico",
  REVIEW_REQUIRED: "Revisão necessária",
};

export function riskBadgeClassName(risk: string | null): string {
  switch (risk) {
    case "CRITICAL":
      return "border-red-700 bg-red-700 text-white";
    case "HIGH":
      return "border-orange-600 bg-orange-600 text-white";
    case "MEDIUM":
      return "border-amber-500 bg-amber-500 text-black";
    case "LOW":
      return "border-emerald-600 bg-emerald-600 text-white";
    case "REVIEW_REQUIRED":
      return "border-violet-600 bg-violet-600 text-white";
    default:
      return "";
  }
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function buildHref(projectId: string, params: RegistrySearchParams, page: number): string {
  const search = new URLSearchParams();
  search.set("tab", "registro-email");
  if (params.classification !== "ALL") search.set("classificacao", params.classification);
  if (params.query) search.set("q", params.query);
  if (params.from) search.set("de", params.from);
  if (params.to) search.set("ate", params.to);
  if (params.sender) search.set("remetente", params.sender);
  if (params.recipient) search.set("destinatario", params.recipient);
  if (params.workWeek) search.set("semana", String(params.workWeek));
  if (params.direction) search.set("direcao", params.direction);
  if (params.intakeStatus) search.set("status", params.intakeStatus);
  if (params.risk) search.set("risco", params.risk);
  if (page > 1) search.set("pagina", String(page));
  return `/${projectId}/documentos?${search.toString()}`;
}

export function EmailRegistryPanel({
  projectId,
  params,
  page,
  error,
}: {
  projectId: string;
  params: RegistrySearchParams;
  page: RegistryPage | null;
  error: string | null;
}) {
  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4" data-testid="email-registry-panel">
      <form method="get" action={`/${projectId}/documentos`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4" role="search" aria-label="Buscar no registro documental por e-mail">
        <input type="hidden" name="tab" value="registro-email" />

        <label className="flex flex-col gap-1 text-xs sm:col-span-1">
          Classificação
          <Select name="classificacao" defaultValue={params.classification} aria-label="Classificação">
            {REGISTRY_CLASSIFICATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs sm:col-span-3">
          Busca (título, assunto, arquivo, remetente, destinatário, WNN, texto extraído, atividades MPP, Curva S)
          <Input name="q" defaultValue={params.query} placeholder="Ex.: W37, ata, cronograma…" aria-label="Busca" />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          De
          <Input type="date" name="de" defaultValue={params.from ?? ""} aria-label="Data inicial" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Até
          <Input type="date" name="ate" defaultValue={params.to ?? ""} aria-label="Data final" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Remetente
          <Input name="remetente" defaultValue={params.sender ?? ""} aria-label="Remetente" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Destinatário / domínio
          <Input name="destinatario" defaultValue={params.recipient ?? ""} aria-label="Destinatário ou domínio" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Semana da obra (W)
          <Input name="semana" inputMode="numeric" defaultValue={params.workWeek ?? ""} placeholder="37" aria-label="Semana da obra" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Direção
          <Select name="direcao" defaultValue={params.direction ?? ""} aria-label="Direção">
            <option value="">Todas</option>
            <option value="INBOUND">Recebido (INBOUND)</option>
            <option value="OUTBOUND">Enviado (OUTBOUND)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Status do envio semanal
          <Select name="status" defaultValue={params.intakeStatus ?? ""} aria-label="Status">
            <option value="">Todos</option>
            {Object.entries(INTAKE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Risco
          <Select name="risco" defaultValue={params.risk ?? ""} aria-label="Risco">
            <option value="">Todos</option>
            {Object.entries(RISK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>

        <div className="flex items-end gap-2 sm:col-span-4">
          <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
            Buscar
          </button>
          <Link href={`/${projectId}/documentos?tab=registro-email`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
            Limpar
          </Link>
          {page ? (
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {page.total} registro(s) · página {page.page} de {totalPages}
            </span>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : !page ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Carregando registro…
        </p>
      ) : page.rows.length === 0 ? (
        <EmptyState message="Nenhum envio por e-mail corresponde aos filtros. Ajuste a classificação ou a busca." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título / assunto</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Direção</TableHead>
                <TableHead>Remetente → destinatários</TableHead>
                <TableHead>Data / hora</TableHead>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Anexos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revisão</TableHead>
                <TableHead>Risco</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((row) => {
                const href = `/${projectId}/documentos/emails/${row.emailId}`;
                return (
                  <TableRow key={row.emailId} className="cursor-pointer hover:bg-muted/60 focus-within:bg-muted/60">
                    <TableCell className="max-w-[320px]">
                      <Link href={href} className="font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Abrir ${row.subject}`}>
                        <span className="line-clamp-2">{row.subject}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="flex flex-col gap-1">
                        <span>{row.classification ? EMAIL_CLASSIFICATION_LABELS[row.classification] : "Não classificado"}</span>
                        {row.sentToClient ? (
                          <Badge variant="outline" className="w-fit" title="Filtro transversal: e-mail OUTBOUND com destinatário no domínio do cliente">
                            Enviado ao cliente
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{row.direction ?? "—"}</TableCell>
                    <TableCell className="max-w-[260px] text-xs">
                      <span className="block truncate" title={row.fromAddress}>
                        {row.fromAddress}
                      </span>
                      <span className="block truncate text-muted-foreground" title={row.toAddress}>
                        → {row.toAddress}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs" title={row.sentAt}>
                      {formatDateTime(row.sentAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.workWeekLabel ?? <span className="text-muted-foreground" title="Semana da obra não identificada no assunto">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs">{row.attachmentCount}</TableCell>
                    <TableCell className="text-xs">{row.intakeStatus ? (INTAKE_STATUS_LABELS[row.intakeStatus] ?? row.intakeStatus) : "—"}</TableCell>
                    <TableCell className="text-xs">
                      {row.classificationStatus === "PENDING_HUMAN_REVIEW" || row.intakeStatus === "PENDING_HUMAN_REVIEW" || row.workWeekStatus === "NOT_IDENTIFIED" ? (
                        <Badge variant="outline" className="border-violet-600 text-violet-700">
                          Pendente
                        </Badge>
                      ) : row.classificationStatus === "CONFIRMED" ? (
                        "Confirmada"
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.riskClassification ? (
                        <Badge variant="outline" className={riskBadgeClassName(row.riskClassification)}>
                          {RISK_LABELS[row.riskClassification] ?? row.riskClassification}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {page && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-xs" aria-label="Paginação">
          {page.page > 1 ? (
            <Link href={buildHref(projectId, params, page.page - 1)} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span>
            {formatDate(new Date().toISOString())} · página {page.page} de {totalPages}
          </span>
          {page.page < totalPages ? (
            <Link href={buildHref(projectId, params, page.page + 1)} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              Próxima →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
