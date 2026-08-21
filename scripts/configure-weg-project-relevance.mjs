import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  "00000000-0000-4000-8000-000000000001";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`
    );
  }

  return value;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

/*
 * Atualiza somente o nome do projeto DEV.
 */
const { error: projectError } = await supabase
  .from("projects")
  .update({
    name: "[DEV] WEG - Fábrica de Fios - Linhares",
  })
  .eq("id", PROJECT_ID);

if (projectError) {
  throw new Error(projectError.message);
}

/*
 * IMPORTANTE:
 *
 * WEG e weg.net sao SUPPORTING.
 *
 * Eles NAO bastam para atribuir uma mensagem ao projeto,
 * pois existem outros projetos WEG.
 */
const identifiers = [
  {
    project_id: PROJECT_ID,
    kind: "CLIENT_DOMAIN",
    value: "weg.net",
    strength: "SUPPORTING",
    weight: 3,
  },

  {
    project_id: PROJECT_ID,
    kind: "CLIENT_NAME",
    value: "WEG",
    strength: "SUPPORTING",
    weight: 2,
  },

  {
    project_id: PROJECT_ID,
    kind: "PROJECT_NAME",
    value: "Fábrica de Fios",
    strength: "STRONG",
    weight: 12,
  },

  {
    project_id: PROJECT_ID,
    kind: "ALIAS",
    value: "WEG - Fábrica de Fios",
    strength: "STRONG",
    weight: 12,
  },

  {
    project_id: PROJECT_ID,
    kind: "ALIAS",
    value: "Fábrica de Fios - Linhares",
    strength: "STRONG",
    weight: 12,
  },

  {
    project_id: PROJECT_ID,
    kind: "ALIAS",
    value: "Fábrica de Fios WLI",
    strength: "STRONG",
    weight: 10,
  },

  {
    project_id: PROJECT_ID,
    kind: "PROJECT_CODE",
    value: "356-WEG LINHARES",
    strength: "STRONG",
    weight: 14,
  },
];

const { error } = await supabase
  .from("project_relevance_identifiers")
  .upsert(
    identifiers,
    {
      onConflict:
        "project_id,kind,value",
    }
  );

if (error) {
  throw new Error(error.message);
}

console.log("");
console.log(
  "OK - projeto DEV configurado como WEG - Fabrica de Fios - Linhares."
);

console.table(
  identifiers.map(
    ({
      kind,
      value,
      strength,
      weight
    }) => ({
      kind,
      value,
      strength,
      weight,
    })
  )
);
