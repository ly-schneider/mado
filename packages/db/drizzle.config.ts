import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "postgres://mado_owner:mado@localhost:5442/mado" },
});
