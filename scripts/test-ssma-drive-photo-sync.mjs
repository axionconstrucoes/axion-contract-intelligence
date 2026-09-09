import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { buildSsmaDriveFileName } = await import("../apps/web/lib/drive/sync-ssma-photo-to-drive");

const sync = await readFile(new URL("../apps/web/lib/drive/sync-ssma-photo-to-drive.ts", import.meta.url), "utf8");
const script = await readFile(new URL("./sync-ssma-drive-photos.mjs", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/ssma-drive-photo-sync.yml", import.meta.url), "utf8");

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
}

check("processa somente pendentes e falhas", script.includes('.in("drive_sync_status", ["PENDING", "FAILED"])'));
check("processa somente formulários finalizados", script.includes('.eq("ssma_form_submissions.status", "SUBMITTED")'));
check("simulação é padrão", script.includes('if (!apply) process.exit(0)'));
check("aplicação é explícita", workflow.includes("--apply --limit=100"));
check("job tem concorrência única", workflow.includes("group: ssma-drive-photo-sync"));
check("job nunca cancela execução ativa", workflow.includes("cancel-in-progress: false"));
check("job roda a cada 15 minutos", workflow.includes('cron: "*/15 * * * *"'));
check("job pode ser acionado manualmente", workflow.includes("workflow_dispatch:"));
check("workflow tem somente leitura no repositório", workflow.includes("contents: read"));
check("não publica IDs no workflow", !workflow.includes("drive.google.com/drive/folders/"));
check("não exige ID de pasta em secret", !workflow.includes("GOOGLE_DRIVE_FOLDER_"));
check("raiz vem da integração do projeto", sync.includes('.from("project_integrations")'));
check("origem é restrita ao ESG SSMA", sync.includes('.eq("source_type", "ESG_SSMA")'));
check("extrai ID da URL configurada", sync.includes("extractGoogleDriveFolderId"));
check("localiza subpasta pelo nome exato", sync.includes("name = '${escapeDriveQuery(folderName)}'"));
check("suporta Drive compartilhado na listagem", sync.includes("includeItemsFromAllDrives: true"));
check("suporta Drive compartilhado na escrita", sync.includes("supportsAllDrives: true"));
check("verifica foto existente antes do upload", sync.includes("findExistingDriveFile"));
check("idempotência usa ID imutável da foto", sync.includes("ssmaPhotoId: photo.id"));
check("arquivo mantém vínculo com submissão", sync.includes("ssmaSubmissionId: photo.submissionId"));
check("download parte do Storage autoritativo", sync.includes("createSignedUrl(photo.storagePath, 60)"));
check("sucesso grava SYNCED", sync.includes('drive_sync_status: "SYNCED"'));
check("sucesso grava ID do Drive", sync.includes("drive_file_id: driveFileId"));
check("sucesso grava horário", sync.includes("drive_synced_at: new Date().toISOString()"));
check("falha preserva registro e marca FAILED", sync.includes('drive_sync_status: "FAILED"'));
check("falha não expõe erro bruto", sync.includes("safeDriveError(error)"));
check("sucesso é auditado", sync.includes('"SSMA_DRIVE_FILE_SYNCED"'));
check("falha é auditada", sync.includes('"SSMA_DRIVE_FILE_SYNC_FAILED"'));
check("arquivo recebe nome determinístico", sync.includes("buildSsmaDriveFileName(photo)"));
check("não apaga foto do Supabase", !sync.includes('.remove(') && !sync.includes('.delete('));
check(
  "nome do arquivo preserva data, ID e nome original",
  buildSsmaDriveFileName({
    id: "foto-123",
    occurredAt: "2026-09-09T14:47:02Z",
    originalFileName: "registro.jpg",
  }) === "2026-09-09_14-47_foto-123_registro.jpg"
);
check(
  "nome do arquivo neutraliza caracteres inválidos",
  !buildSsmaDriveFileName({
    id: "foto-456",
    occurredAt: "2026-09-09T14:47:02Z",
    originalFileName: 'risco:/\\*?"<>|.png',
  }).includes(":"),
);

console.log(`SSMA DRIVE PHOTO SYNC: ${passed} verificações, 0 falhas`);
