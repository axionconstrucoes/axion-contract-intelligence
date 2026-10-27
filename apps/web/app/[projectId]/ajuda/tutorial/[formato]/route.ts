import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";

import { getProject } from "@/lib/data";
import { TUTORIAL_FILES, isTutorialFormat } from "@/lib/help/tutorial-files";

// Entrega o tutorial do ACC (PDF/PPTX) só a usuários autenticados com acesso à obra: getProject usa a sessão do
// usuário e a RLS, então quem não participa da obra recebe 404. GET apenas lê — nunca altera estado.
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; formato: string }> }) {
  const { projectId, formato } = await params;
  if (!isTutorialFormat(formato) || !/^[0-9a-fA-F-]{36}$/.test(projectId)) {
    return new NextResponse("Não encontrado", { status: 404 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return new NextResponse("Não autenticado", { status: 401 });

  const project = await getProject(projectId);
  if (!project) return new NextResponse("Não encontrado", { status: 404 });

  const file = TUTORIAL_FILES[formato];
  let content: Buffer;
  try {
    content = await readFile(path.join(process.cwd(), "content", "tutorial", file.fileName));
  } catch {
    return new NextResponse("Arquivo indisponível", { status: 404 });
  }

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "content-type": file.contentType,
      "content-disposition": `${file.disposition}; filename="${file.fileName}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
