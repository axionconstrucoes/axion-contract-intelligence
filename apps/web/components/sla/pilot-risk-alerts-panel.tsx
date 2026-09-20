import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { slaAreaLabels, slaEscalationLevelLabels, slaTimeUnitLabels } from "@/lib/labels";
import type { PilotRiskAlertsView } from "@/lib/risk-alerts/pilot-risk-alerts-view-data";

// Painel SOMENTE LEITURA dos alertas de risco do piloto (tela de
// configuração do projeto). Prazos, unidades e níveis vêm da Matriz de
// responsabilidades e prazos — não são editáveis aqui (nem em nenhum
// outro lugar fora da própria Matriz). Allowlist e liga/desliga são
// configuração de projeto aplicada via script pelo administrador.

function formatDateTime(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  SENT: "Enviado",
  FAILED: "Falhou",
  SUPPRESSED: "Suprimido",
  SKIPPED: "Ignorado",
};

export function PilotRiskAlertsPanel({ view }: { view: PilotRiskAlertsView }) {
  const enabled = view.configured && view.ingestionEnabled && view.riskAlertsEnabled;
  return (
    <Card data-testid="pilot-risk-alerts-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Alertas de risco por e-mail (piloto)
          <Badge variant={enabled ? "default" : "outline"} data-testid="pilot-risk-alerts-status">
            {enabled ? "Habilitados" : "Desabilitados"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <p><span className="text-muted-foreground">Timezone do projeto:</span> {view.timeZone}</p>
          <p><span className="text-muted-foreground">Baixo/Médio:</span> consolidado único às quartas-feiras, 07:00 ({view.timeZone})</p>
          <p><span className="text-muted-foreground">Alto/Crítico:</span> imediato + escalonamento Nível 1 → 2 → 3 pelos prazos da Matriz</p>
          <p><span className="text-muted-foreground">Próximo consolidado:</span> {view.nextDigest}</p>
          <p>
            <span className="text-muted-foreground">Último consolidado:</span>{" "}
            {view.lastDigest ? `${view.lastDigest.window} — ${STATUS_LABEL[view.lastDigest.status] ?? view.lastDigest.status}${view.lastDigest.sentAt ? ` em ${formatDateTime(view.lastDigest.sentAt, view.timeZone)}` : ""}` : "nenhum"}
          </p>
          <p>
            <span className="text-muted-foreground">Casos em aberto:</span> {view.openCases.critical} crítico(s), {view.openCases.high} alto(s), {view.openCases.medium} médio(s), {view.openCases.low} baixo(s), {view.openCases.reviewRequired} em revisão
          </p>
        </div>

        {!view.configured ? (
          <p className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-amber-900" role="status">
            Projeto sem configuração de ingestão semanal — os alertas de risco ficam inativos até a configuração pelo administrador.
          </p>
        ) : null}

        <div>
          <h3 className="mb-1 font-medium">Níveis pela Matriz de responsabilidades e prazos</h3>
          <p className="mb-2 text-xs text-muted-foreground">Os prazos abaixo são os da Matriz (regra ALTO por área, para referência); edite-os somente na própria Matriz.</p>
          <Table data-testid="pilot-risk-alerts-levels">
            <TableHeader>
              <TableRow>
                <TableHead>Área</TableHead>
                <TableHead>{slaEscalationLevelLabels.RESPONSAVEL}</TableHead>
                <TableHead>{slaEscalationLevelLabels.ESCALAO_1}</TableHead>
                <TableHead>{slaEscalationLevelLabels.DIRETORIA}</TableHead>
                <TableHead>Prazo assumir (ALTO)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.levels.map((row) => (
                <TableRow key={row.area}>
                  <TableCell>{slaAreaLabels[row.area]}</TableCell>
                  <TableCell>{row.level1.length ? row.level1.join(", ") : "não definido"}</TableCell>
                  <TableCell>{row.level2 ?? "não definido"}</TableCell>
                  <TableCell>{row.level3 ?? "não definido"}</TableCell>
                  <TableCell>
                    {row.policy.assumeDeadlineValue} {slaTimeUnitLabels[row.policy.timeUnit].toLowerCase()}
                    {row.policy.usingDefaultRule ? " (default)" : ""}
                  </TableCell>
                  <TableCell>
                    {row.policy.status === "OK" ? <Badge variant="outline">OK</Badge> : <Badge variant="destructive">Revisão de configuração: {row.policy.missing.join(", ")}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-1 font-medium">Destinatários do piloto (allowlist por usuário)</h3>
          {view.allowlistStatus === "MISSING" ? (
            <p className="text-amber-800" data-testid="pilot-risk-alerts-allowlist-missing">Allowlist não configurada — nenhum e-mail é enviado (fail-closed).</p>
          ) : (
            <ul className="list-disc pl-5" data-testid="pilot-risk-alerts-recipients">
              {view.recipients.map((r) => (
                <li key={r.userId}>
                  {r.name ?? r.userId} — {r.email ?? "sem e-mail"} — {r.valid ? <Badge variant="outline">válido</Badge> : <Badge variant="destructive">{r.problem}</Badge>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Qualquer outro destinatário indicado pela Matriz é registrado como suprimido (PILOT_RECIPIENT_SUPPRESSED) e nunca recebe e-mail durante o piloto. Suprimidos até agora: {view.suppressedCount}.</p>
        </div>

        <div>
          <h3 className="mb-1 font-medium">Últimos alertas (outbox)</h3>
          {view.recentOutbox.length === 0 ? (
            <p className="text-muted-foreground">Nenhum alerta registrado.</p>
          ) : (
            <Table data-testid="pilot-risk-alerts-outbox">
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Risco</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.recentOutbox.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.sentAt ?? row.scheduledFor, view.timeZone)}</TableCell>
                    <TableCell>{row.type}{row.escalationLevel ? ` · ${slaEscalationLevelLabels[row.escalationLevel as keyof typeof slaEscalationLevelLabels] ?? row.escalationLevel}` : ""}</TableCell>
                    <TableCell>{row.riskLevel}</TableCell>
                    <TableCell>{row.recipientName ?? "—"}</TableCell>
                    <TableCell>
                      {STATUS_LABEL[row.status] ?? row.status}
                      {row.suppressionLabel ? ` — ${row.suppressionLabel}` : ""}
                      {row.attemptCount > 1 ? ` (${row.attemptCount} tentativas)` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
