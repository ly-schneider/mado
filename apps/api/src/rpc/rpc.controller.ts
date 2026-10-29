import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService, sessionToken } from "../services/auth.service";
import { RouterService } from "./router.service";

@Controller()
export class RpcController {
  constructor(
    private readonly auth: AuthService,
    private readonly routerService: RouterService,
  ) {}

  @All(["rpc", "rpc/*path"])
  async handle(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.userFromSession(sessionToken(req));
    const { matched } = await this.routerService.handler.handle(req, res, {
      prefix: "/rpc",
      context: { req, res, actor: user ? this.auth.userActor(user) : null, ip: req.ip ?? null },
    });
    if (!matched) res.status(404).end();
  }
}
