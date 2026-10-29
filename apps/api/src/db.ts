import { createDb, type Db } from "@mado/db";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { config } from "./config";

@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly app = createDb(config.databaseUrl);
  private purgeConn: ReturnType<typeof createDb> | null = null;

  get db(): Db {
    return this.app.db;
  }

  /** Connection as mado_purge, the only role with DELETE on core tables. Use for purge only. */
  get purgeDb(): Db {
    this.purgeConn ??= createDb(config.purgeDatabaseUrl, { max: 2 });
    return this.purgeConn.db;
  }

  async onApplicationShutdown() {
    await this.app.client.end({ timeout: 2 });
    await this.purgeConn?.client.end({ timeout: 2 });
  }
}
