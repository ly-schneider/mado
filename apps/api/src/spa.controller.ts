import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { config } from "./config";

const HASHED_ASSET = /\/assets\/.+-[\w-]{8,}\.\w+$/;

/**
 * Serves the SPA bundle. Must stay the last controller: it catches every GET that no other route took.
 * In dev the Vite server serves the SPA, so this redirects there.
 */
@Controller()
export class SpaController {
  private index: { html: string; mtime: number } | null = null;

  @Get(["/", "*path"])
  serve(@Req() req: Request, @Res() res: Response) {
    if (config.webDevUrl && !existsSync(join(config.webDist, "index.html"))) {
      return res.redirect(config.webDevUrl + req.originalUrl);
    }
    const file = normalize(join(config.webDist, decodeURIComponent(req.path)));
    if (file.startsWith(config.webDist) && req.path !== "/" && existsSync(file) && !file.endsWith("/")) {
      res.setHeader("Cache-Control", HASHED_ASSET.test(req.path) ? "public, max-age=31536000, immutable" : "no-cache");
      return res.sendFile(file);
    }
    // A stale index would point at assets that no longer exist after a rebuild.
    if (req.path.startsWith("/assets/")) return res.status(404).end();
    const indexPath = join(config.webDist, "index.html");
    const mtime = statSync(indexPath).mtimeMs;
    if (this.index?.mtime !== mtime) this.index = { html: readFileSync(indexPath, "utf8"), mtime };
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(this.index.html);
  }
}
