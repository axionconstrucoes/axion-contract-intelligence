import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase privilegiado — usa a secret key e ignora RLS.
 *
 * Reservado para jobs administrativos e conectores internos futuros (Gmail,
 * Google Drive, Diário de Obra, Construmanager, ERP...).
 *
 * Nunca deve ser usado em Server Actions normais acionadas por um usuário —
 * isso pularia RBAC e RLS. Todo dado contratual do AXION acionado por um
 * usuário passa por createSupabaseServerClient(), não por este cliente.
 */
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL não está definida — createSupabaseAdminClient não pode ser inicializado."
    );
  }

  if (!supabaseSecretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY não está definida — createSupabaseAdminClient não pode ser inicializado."
    );
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
