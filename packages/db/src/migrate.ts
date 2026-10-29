import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Migrations run as the owner role; the app and purge roles only get the grants in roles.sql.
const url = process.env.DATABASE_OWNER_URL ?? "postgres://mado_owner:mado@localhost:5442/mado";
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await client.unsafe(readFileSync(new URL("./roles.sql", import.meta.url), "utf8"));
await client.end();
console.log("migrated");
