import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para uso no browser — usa a publishable key, nunca a secret key.
 * Reservado para UI de autenticação (login/signup). Dado contratual do AXION nunca
 * é lido/escrito por aqui: sempre via Server Components, Server Actions ou Route
 * Handlers, usando createSupabaseServerClient().
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
