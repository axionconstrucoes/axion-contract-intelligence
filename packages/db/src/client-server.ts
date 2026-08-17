import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Usa a publishable key e a sessão do usuário via cookies, sempre sob RLS.
 * Este é o caminho padrão para acesso aos dados contratuais do AXION.
 *
 * Nunca usa a secret key.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components podem não permitir escrita de cookies.
            // A renovação de sessão será tratada futuramente por proxy.ts.
          }
        },
      },
    }
  );
}
