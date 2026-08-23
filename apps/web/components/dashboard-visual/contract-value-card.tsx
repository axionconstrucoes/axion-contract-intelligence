// Card VALOR CONTRATUAL (seção 11) — tabela de instrumentos formalizados
// (Contrato Base + Aditivo 01, 02, ...). "Valor acumulado"/"TOTAL
// CONTRATUAL VIGENTE" dependem de um valor-base que não existe em
// nenhuma tabela hoje — nunca calculados a partir de um base fictício
// (0), sempre NÃO DISPONÍVEL. Só o acréscimo real dos aditivos
// formalizados é somado e mostrado.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureInfo } from "@/components/shared/feature-info";
import { formatDate } from "@/lib/labels";
import type { ContractValueTable } from "@/lib/dashboard-visual/compute-contract-value";
import { ValuePlaceholder } from "./value-placeholder";

export function ContractValueCard({ table, formatCurrency }: { table: ContractValueTable; formatCurrency: (v: number) => string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Valor contratual
          <FeatureInfo helpId="dashboard-visual-contract-value" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instrumento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Acréscimo / Redução</TableHead>
                <TableHead>Valor acumulado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.instrument}>
                  <TableCell className="font-medium">{row.instrument}</TableCell>
                  <TableCell>{row.date ? formatDate(row.date) : <ValuePlaceholder />}</TableCell>
                  <TableCell>{row.description}</TableCell>
                  <TableCell>{row.changeValue === null ? <ValuePlaceholder /> : formatCurrency(row.changeValue)}</TableCell>
                  <TableCell>
                    <ValuePlaceholder note="Depende do valor-base do contrato, ainda não configurado" />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  TOTAL CONTRATUAL VIGENTE
                </TableCell>
                <TableCell className="font-semibold">{formatCurrency(table.totalAditivosChange)} (soma dos aditivos formalizados)</TableCell>
                <TableCell>
                  <ValuePlaceholder note="Valor contratual-base ainda não configurado" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
