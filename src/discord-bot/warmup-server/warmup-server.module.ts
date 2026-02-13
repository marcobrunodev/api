import { Module, forwardRef } from "@nestjs/common";
import { WarmupServerService } from "./warmup-server.service";
import { HasuraModule } from "../../hasura/hasura.module";
import { RedisModule } from "../../redis/redis.module";
import { RconModule } from "../../rcon/rcon.module";
import { loggerFactory } from "../../utilities/LoggerFactory";

@Module({
  imports: [
    HasuraModule,
    RedisModule,
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
