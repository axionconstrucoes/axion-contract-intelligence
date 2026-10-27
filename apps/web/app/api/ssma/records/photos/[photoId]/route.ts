import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";

// Abre uma foto de registro SSMA por URL assinada de curta duração. A autorização é a do próprio
// usuário: a linha da foto só é visível (RLS) para membros ativos da obra; sem ela, 404. GET apenas
// lê — nunca altera estado.
export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(photoId)) return new NextResponse("Não encontrado", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return new NextResponse("Não autenticado", { status: 401 });

  const { data: photo } = await supabase.from("ssma_field_record_photos").select("storage_bucket, storage_path").eq("id", photoId).maybeSingle();
  if (!photo) return new NextResponse("Não encontrado", { status: 404 });

  const { data } = await supabase.storage.from(photo.storage_bucket).createSignedUrl(photo.storage_path, 120);
  if (!data?.signedUrl) return new NextResponse("Arquivo indisponível", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "cache-control": "private, no-store" } });
}
