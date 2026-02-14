import { Module, forwardRef } from "@nestjs/common";
import { WarmupServerService } from "./warmup-server.service";
import { HasuraModule } from "../../hasura/hasura.module";
import { RedisModule } from "../../redis/redis.module";
import { RconModule } from "../../rcon/rcon.module";
import { CacheModule } from "../../cache/cache.module";
import { EncryptionModule } from "../../encryption/encryption.module";
import { loggerFactory } from "../../utilities/LoggerFactory";

@Module({
  imports: [
    HasuraModule,
    RedisModule,
    CacheModule,
    EncryptionModule,
    forwardRef(() => RconModule),
  ],
  providers: [
    WarmupServerService,
    loggerFactory(),
  ],
  exports: [
    WarmupServerService,
  ],
})
export class WarmupServerModule {}
