import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { config } from "./config";
import { isDesktopOrigin } from "./lib/cookies";
import { securityHeaders } from "./lib/security-headers";

// Body parsing is off globally: oRPC and MCP read raw bodies, webhooks verify signatures on them.
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ["error", "warn", "log"] });
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(cookieParser());
// The desktop app loads the SPA from tauri://localhost and calls this server cross-origin with a session header.
app.enableCors({
  origin: (origin, cb) => cb(null, isDesktopOrigin(origin)), credentials: true,
  allowedHeaders: ["content-type", "x-mado-session"],
  exposedHeaders: ["x-mado-session"],
  maxAge: 600,
});
app.enableShutdownHooks();
await app.listen(config.port, "0.0.0.0");
console.log(`mado api on :${config.port} (${config.publicUrl})`);
