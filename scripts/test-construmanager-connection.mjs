// Live read-only connection test for Construmanager.
// No database writes, migrations, e-mail sends or API mutation calls.
//
// Usage:
// node --env-file=apps/web/.env.local scripts/test-construmanager-connection.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { createConstrumanagerClient } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

console.log("");
console.log("CONSTRUMANAGER - LIVE READ-ONLY TEST");
console.log("====================================");

try {
  const client = createConstrumanagerClient();

  const auth = await client.authenticate();

  check("Login/Auth accepted credentials", auth.status.id === 1);
  check("authenticated user is valid", auth.user.id > 0);
  check("companyId is 1645", auth.user.companyId === 1645);
  check(
    "intermediate token received without printing it",
    typeof auth.user.token === "string" &&
      auth.user.token.length >= 10
  );

  const token = await client.getAccessToken(auth.user.token);

  check(
    "Token/Get returned Bearer access token",
    typeof token.access_token === "string" &&
      token.access_token.length >= 10
  );

  check(
    "access token lifetime is close to 24 hours",
    Number(token.expires_in) >= 80000 &&
      Number(token.expires_in) <= 90000
  );

  const worksResponse = await client.listWorks(
    token.access_token,
    auth.user.companyId
  );

  check("Obra/List returned API status OK", worksResponse.status.id === 0);
  check("Obra/List returned at least one work", worksResponse.listWork.length > 0);

  const weg = worksResponse.listWork.find(
    (work) => work.id === 34164
  );

  check("WEG work 34164 exists", Boolean(weg));

  check(
    "WEG work has expected name",
    weg?.name === "WEG Linhares ES - Fábrica de Fios"
  );

  console.log("");
  console.log(`Works returned: ${worksResponse.listWork.length}`);

  if (weg) {
    console.log(`Pilot work: ${weg.id} - ${weg.name}`);
  }
} catch (error) {
  console.log("");
  console.log("FAIL Connection test aborted");
  console.log(
    error instanceof Error ? error.message : String(error)
  );
  failed += 1;
}

console.log("");
console.log("====================================");
console.log(`RESULT: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
