import { Module } from "@nestjs/common";
import { WarmupServerService } from "./warmup-server.service";
import { HasuraModule } from "../../hasura/hasura.module";
import { RedisModule } from "../../redis/redis.module";
import { loggerFactory } from "../../utilities/LoggerFactory";

@Module({
  imports: [
    HasuraModule,
    RedisModule,
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
