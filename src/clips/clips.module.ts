import { Module } from "@nestjs/common";
import { ClipsController } from "./clips.controller";
import { ClipsService } from "./clips.service";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ClipsQueues } from "./enums/ClipsQueues";
import { loggerFactory } from "../utilities/LoggerFactory";
import { Queue } from "bullmq";
import { ProcessClips } from "./jobs/ProcessClips";
import { S3Module } from "src/s3/s3.module";
import { HasuraModule } from "src/hasura/hasura.module";
import { getQueuesProcessors } from "src/utilities/QueueProcessors";

@Module({
  imports: [
    S3Module,
    HasuraModule,
    BullModule.registerQueue({
      name: ClipsQueues.ProcessClips,
    }),
    BullBoardModule.forFeature({
      name: ClipsQueues.ProcessClips,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [ClipsController],
  providers: [
    ClipsService,
    ProcessClips,
    ...getQueuesProcessors("Clips"),
    loggerFactory(),
  ],
  exports: [ClipsService],
})
export class ClipsModule {
  constructor(
    @InjectQueue(ClipsQueues.ProcessClips) processClipsQueue: Queue,
  ) {
    if (process.env.RUN_MIGRATIONS) {
      return;
    }

    // Note: Clips are triggered by match end events, not on a schedule
    // The queue is used for async processing when match maps finish
  }
}
