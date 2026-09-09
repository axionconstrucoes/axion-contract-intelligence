import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260909143000_ssma_submission_persistence.sql");
const app = read("apps/web/components/ssma/ssma-field-app.tsx");
const page = read("apps/web/app/ssma/[projectId]/page.tsx");

let checks = 0;
function check(message, condition) {
  checks += 1;
  if (!condition) throw new Error(message);
}

check("cria tabela de formulários", migration.includes("create table public.ssma_form_submissions"));
check("cria tabela de fotos", migration.includes("create table public.ssma_submission_photos"));
check("formulário tem estados de upload e conclusão", migration.includes("'UPLOADING', 'SUBMITTED'"));
check("formulário concluído exige data", migration.includes("status = 'SUBMITTED' and submitted_at is not null"));
check("registros são vinculados ao projeto", migration.includes("project_id uuid not null references public.projects"));
check("técnico autenticado é preservado", migration.includes("technician_user_id uuid not null"));
check("campos e checklist são JSON imutável", migration.includes("field_values jsonb") && migration.includes("checklist_values jsonb"));
check("somente Feito e NA são aceitos", migration.includes("value not in ('FEITO', 'NA')"));
check("payloads JSON possuem limite", migration.includes("octet_length(field_values::text) <= 65536") && migration.includes("octet_length(checklist_values::text) <= 8192"));
check("as 11 definições são validadas no servidor", (migration.match(/^    \('/gm) ?? []).length === 11);
check("risco usa quatro níveis oficiais", migration.includes("'BAIXA', 'MEDIA', 'ALTA', 'CRITICA'"));
check("foto aceita somente JPG e PNG", migration.includes("mime_type in ('image/jpeg', 'image/png')"));
check("foto tem limite de 15 MB", migration.includes("file_size_bytes <= 15728640"));
check("servidor limita 20 fotos", migration.includes("PHOTO_LIMIT_EXCEEDED"));
check("categoria da foto é validada no servidor", migration.includes("action_label in ('Tirar foto'"));
check("foto possui hash SHA-256", migration.includes("sha256_hash ~ '^[0-9a-f]{64}$'"));
check("hash impede duplicidade no mesmo envio", migration.includes("unique(submission_id, sha256_hash)"));
check("foto nasce pendente para o Drive", migration.includes("drive_sync_status text not null default 'PENDING'"));
check("nenhum ID de pasta do Drive é publicado", !migration.includes("drive.google.com/drive/folders/"));
check("RLS está ativo nas duas tabelas", (migration.match(/enable row level security/g) ?? []).length === 2);
check("somente membros ativos leem", (migration.match(/public\.is_project_member\(project_id\)/g) ?? []).length >= 2);
check("metadados não permitem escrita direta", migration.includes("revoke insert, update, delete"));
check("upload de Storage exige envio próprio aberto", migration.includes("can_upload_ssma_photo_object"));
check("caminho inválido não causa cast inseguro", migration.includes("exception when invalid_text_representation"));
check("registro valida objeto físico", migration.includes("STORAGE_OBJECT_NOT_FOUND"));
check("caminho físico é validado por prefixo", migration.includes("INVALID_STORAGE_PATH"));
check("limpeza só remove arquivo não registrado", migration.includes("discard_unregistered_ssma_photo"));
check("não existe policy geral de delete no Storage", !migration.includes("on storage.objects for delete"));
check("finalização é idempotente", migration.includes("if v_submission.status = 'SUBMITTED' then return"));
check("finalização grava auditoria", migration.includes("'SSMA_FORM_SUBMITTED'"));
check("RPCs são restritas a authenticated", (migration.match(/grant execute on function/g) ?? []).length === 5);
check("página passa projectId real", page.includes("projectId={projectId}"));
check("cliente cria submissão antes das fotos", app.indexOf('"create_ssma_form_submission"') < app.indexOf('.from("project-documents")'));
check("cliente calcula SHA-256", app.includes("computeFileSha256Hex(photo.file)"));
check("Storage nunca sobrescreve", app.includes("upsert: false"));
check("cliente registra metadado após upload", app.includes('"register_ssma_submission_photo"'));
check("falha de registro tenta limpeza segura", app.includes('"discard_unregistered_ssma_photo"'));
check("envio só conclui após finalizar", app.includes('"finalize_ssma_form_submission"'));
check("progresso é exibido", app.includes("Enviando fotos:"));
check("interface não afirma mais ser protótipo", !app.includes("Protótipo funcional sem gravação externa"));

console.log(`${checks} verificações, 0 falhas`);
