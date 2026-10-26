import { isActionOverdue, type FieldRecordView } from "@/lib/ssma/field-records/field-record-view";
import { ACTION_STATUS_LABELS, RISK_LABELS } from "@/lib/ssma/field-records/types";

const RISK_BADGE: Record<string, string> = {
  BAIXA: "bg-[#166534] text-white",
  MEDIA: "bg-[#2563EB] text-white",
  ALTA: "bg-[#FFD600] text-black",
  CRITICA: "bg-[#DC2626] text-white",
};
const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dateOnly = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

/** Tabela do painel do ACC (somente leitura). `today` = AAAA-MM-DD para marcar ações em atraso. */
export function FieldRecordsTable({ records, today }: { records: FieldRecordView[]; today: string }) {
  return (
    <table className="w-full min-w-[900px] text-sm">
    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
      <tr>
        {["Fato", "Tipo / categoria", "Local", "Risco", "Registrado por", "Responsável", "Prazo", "Ação corretiva", "Fotos"].map((heading) => (
          <th key={heading} className="px-3 py-2 font-semibold">{heading}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {records.map((record) => {
        const overdue = isActionOverdue(record.action, today);
        return (
          <tr key={record.id} className="border-t align-top">
            <td className="px-3 py-2 whitespace-nowrap">{dateTime(record.occurredAt)}<br /><span className="text-xs text-muted-foreground">recebido {dateTime(record.receivedAt)}</span></td>
            <td className="px-3 py-2"><span className="font-semibold">{record.kind === "OCORRENCIA" ? "Ocorrência" : "Inspeção"}</span><br />{record.category}<p className="mt-1 max-w-xs text-xs text-muted-foreground">{record.description}</p></td>
            <td className="px-3 py-2">{record.location}</td>
            <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs font-bold ${RISK_BADGE[record.risk]}`}>{RISK_LABELS[record.risk]}</span></td>
            <td className="px-3 py-2">{record.reportedByName}</td>
            <td className="px-3 py-2">{record.responsibleName ?? "—"}</td>
            <td className="px-3 py-2 whitespace-nowrap">{record.action ? dateOnly(record.action.dueDate) : "—"}</td>
            <td className={`px-3 py-2 font-semibold ${overdue ? "text-red-700" : ""}`}>{record.action ? (overdue ? "Em atraso" : ACTION_STATUS_LABELS[record.action.status]) : "Sem ação"}{record.evidenceCount > 0 ? <span className="block text-xs font-normal text-muted-foreground">{record.evidenceCount} evidência(s)</span> : null}</td>
            <td className="px-3 py-2">
              {record.photos.length === 0 ? "0" : (
                <span className="flex flex-wrap gap-1">
                  {record.photos.map((photo, index) => (
                    <a key={photo.id} href={`/api/ssma/records/photos/${photo.id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#7f1d1d] underline">
                      {photo.purpose === "EVIDENCIA_ACAO" ? "evid." : "foto"} {index + 1}
                    </a>
                  ))}
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
                </table>
  );
}
