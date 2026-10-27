import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SsmaInstallCard } from "@/components/ssma/ssma-install-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject, getProjectMembers } from "@/lib/data";
import { getFieldRecords } from "@/lib/ssma/field-records/data";
import { FieldRecordsTable } from "@/components/ssma/field-records/field-records-table";
import { summarizeFieldRecords } from "@/lib/ssma/field-records/field-record-view";

export const metadata: Metadata = { title: "Registros de campo SSMA" };


export default async function SsmaFieldRecordsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, members] = await Promise.all([getProject(projectId), getProjectMembers(projectId)]);
  if (!project) notFound();

  const names = new Map(members.map((member) => [member.userId, member.user.name]));
  const { available, records } = await getFieldRecords(projectId, names);
  const today = new Date().toISOString().slice(0, 10);
  const summary = summarizeFieldRecords(records, today);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registros de campo SSMA"
        description="Ocorrências e inspeções registradas pelo app de campo, com as ações corretivas e o andamento. Registros criados sem sinal aparecem aqui depois de sincronizados."
        actions={
          <Link href={`/ssma/${projectId}`} className="rounded-md border border-[#7f1d1d] px-3 py-2 text-sm font-semibold text-[#7f1d1d]">
            Abrir app de campo
          </Link>
        }
      />

      {!available ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">Os registros de campo ainda não estão disponíveis neste ambiente (migration pendente).</CardContent></Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Resumo">
            {[
              ["Registros", summary.total],
              ["Ações em aberto", summary.openActions],
              ["Ações em atraso", summary.overdueActions],
              ["Críticos em aberto", summary.critical],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="p-4"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>
            ))}
          </section>

          <Card>
            <CardHeader><CardTitle className="text-base">Registros</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {records.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum registro enviado ainda.</p>
              ) : (
                <FieldRecordsTable records={records} today={today} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <SsmaInstallCard />
    </div>
  );
}
