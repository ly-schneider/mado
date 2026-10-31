import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Migrations run as the owner role; the app and purge roles only get the grants in roles.sql.
const url = process.env.DATABASE_OWNER_URL ?? "postgres://mado_owner:mado@localhost:5442/mado";
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await client.unsafe(readFileSync(new URL("./roles.sql", import.meta.url), "utf8"));

// roles.sql creates the roles with the dev password. Set the real ones from the URLs the app connects
// with, on every start, so the database never needs separate setup and changing a password just takes a restart.
for (const [role, envUrl] of [
  ["mado_app", process.env.DATABASE_URL],
  ["mado_purge", process.env.DATABASE_PURGE_URL],
] as const) {
  if (!envUrl) continue;
  const u = new URL(envUrl);
  if (u.username !== role || !u.password) continue;
  // ALTER ROLE takes no bind parameters; the role name comes from the list above.
  const password = decodeURIComponent(u.password).replaceAll("'", "''");
  await client.unsafe(`ALTER ROLE ${role} PASSWORD '${password}'`);
}
await client.end();
console.log("migrated");
