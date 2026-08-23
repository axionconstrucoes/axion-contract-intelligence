// VOLUME POR FONTE DE INFORMAÇÃO (seção 14) — uma linha por mailbox
// AXION real + uma linha por fonte genérica configurada. "0" só
// aparece quando a contagem É real (e-mail); fontes genéricas mostram
// NÃO DISPONÍVEL (contagem não modelada) ou NÃO CONFIGURADA (sem
// nenhuma origem definida) — nunca confundidos com 0.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureInfo } from "@/components/shared/feature-info";
import { formatDateTime } from "@/lib/labels";
import type { SourceVolumeRow, SourceVolumeTotals, VolumeCount } from "@/lib/dashboard-visual/compute-source-volume-rows";

function renderCount(value: VolumeCount): string {
  if (value === "NAO_DISPONIVEL") return "NÃO DISPONÍVEL";
  if (value === "NAO_CONFIGURADA") return "NÃO CONFIGURADA";
  return String(value);
}

function renderSync(value: string | "NAO_CONFIGURADA" | null): string {
  if (value === "NAO_CONFIGURADA") return "NÃO CONFIGURADA";
  if (!value) return "Ainda sem sincronização";
  return formatDateTime(value);
}

export function SourceVolumeTable({ rows, totals }: { rows: SourceVolumeRow[]; totals: SourceVolumeTotals }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Volume por fonte de informação
          <FeatureInfo helpId="dashboard-visual-source-volume" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Origem específica</TableHead>
                <TableHead>Tipo de conteúdo</TableHead>
                <TableHead>Itens recebidos</TableHead>
                <TableHead>Processados pelo ACC</TableHead>
                <TableHead>Considerados em análises</TableHead>
                <TableHead>Pendentes</TableHead>
                <TableHead>Última sincronização</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.source}-${row.specificOrigin}-${index}`}>
                  <TableCell className="font-medium">{row.source}</TableCell>
                  <TableCell>{row.specificOrigin}</TableCell>
                  <TableCell className="text-muted-foreground">{row.contentType}</TableCell>
                  <TableCell>{renderCount(row.received)}</TableCell>
                  <TableCell>{renderCount(row.processed)}</TableCell>
                  <TableCell>{renderCount(row.considered)}</TableCell>
                  <TableCell>{renderCount(row.pending)}</TableCell>
                  <TableCell className="text-muted-foreground">{renderSync(row.lastSyncAt)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  TOTAL
                </TableCell>
                <TableCell className="font-semibold">{totals.totalReceived}</TableCell>
                <TableCell className="font-semibold">{totals.totalProcessed}</TableCell>
                <TableCell className="font-semibold">{totals.totalConsidered}</TableCell>
                <TableCell className="font-semibold">{totals.totalPending}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Totais deduplicados: a mesma mensagem recebida em mais de uma caixa AXION é contada uma única vez.
        </p>
      </CardContent>
    </Card>
  );
}
