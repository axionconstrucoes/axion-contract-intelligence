"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

export async function login(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  const nextDestination = sanitizeInternalRedirect(formData.get("next"), "/projetos");

  const nextParam = nextDestination === "/projetos" ? "" : `&next=${encodeURIComponent(nextDestination)}`;

  if (typeof email !== "string" || typeof password !== "string") {
    redirect(`/login?error=invalid_credentials${nextParam}`);
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    redirect(`/login?error=invalid_credentials${nextParam}`);
  }

  redirect(nextDestination);
}
