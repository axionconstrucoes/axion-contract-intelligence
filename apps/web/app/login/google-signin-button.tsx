"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@axion/db/browser";

export function GoogleSignInButton({ next }: { next?: string } = {}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    // "next" já veio validado do server component (page.tsx) — mesmo
    // assim só é usado para montar a URL de retorno, revalidado de novo
    // no callback (auth/callback/route.ts) antes de qualquer redirect.
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) {
      callbackUrl.searchParams.set("next", next);
    }
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });
  }

  return (
    <Button type="button" className="w-full" onClick={handleClick} disabled={loading}>
      {loading ? "Redirecionando para o Google..." : "Entrar com Google"}
    </Button>
  );
}
