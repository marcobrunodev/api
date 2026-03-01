import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { WorkerHost } from "@nestjs/bullmq";
import { ClipsQueues } from "../enums/ClipsQueues";
import { UseQueue } from "../../utilities/QueueProcessors";
import { HasuraService } from "../../hasura/hasura.service";
import { ClipsService } from "../clips.service";

interface ProcessClipsJobData {
  matchId: string;
  matchMapId: string;
}

@UseQueue("Clips", ClipsQueues.ProcessClips)
export class ProcessClips extends WorkerHost {
  constructor(
    private readonly hasura: HasuraService,
    private readonly clipsService: ClipsService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<ProcessClipsJobData>): Promise<number> {
    const { matchId, matchMapId } = job.data;

    this.logger.log(`Processing clips for match ${matchId}, map ${matchMapId}`);

    try {
      // Check if clips feature is enabled
      const isEnabled = await this.isClipsEnabled();
      if (!isEnabled) {
        this.logger.log("Clips feature is disabled, skipping");
        return 0;
      }

      // Get demo URL
      const demoUrl = await this.clipsService.getDemoUrl(matchMapId);
      if (!demoUrl) {
        this.logger.warn(`No demo found for match map ${matchMapId}`);
        return 0;
      }

      let clipsRequested = 0;

      // Request Play of the Game
      const potgResult = await this.clipsService.requestPotg(
        demoUrl,
        matchId,
        matchMapId,
      );

      if (potgResult) {
        await this.clipsService.createPendingClip(
          matchId,
          matchMapId,
          potgResult.requestId,
          "potg",
        );
        clipsRequested++;
        this.logger.log(`POTG requested: ${potgResult.requestId}`);
      }

      // Get players and request highlights for each
      const players = await this.clipsService.getMatchPlayers(matchId);

      for (const player of players) {
        // Request Best Play for each player
        const bpResult = await this.clipsService.requestBestPlay(
          demoUrl,
          matchId,
          matchMapId,
          player.steam_id,
          player.name,
        );

        if (bpResult) {
          await this.clipsService.createPendingClip(
            matchId,
            matchMapId,
            bpResult.requestId,
            "bp",
            player.steam_id,
            player.name,
          );
          clipsRequested++;
          this.logger.log(
            `Best Play requested for ${player.name}: ${bpResult.requestId}`,
          );
        }

        // Small delay to avoid rate limiting
        await this.delay(500);
      }

      this.logger.log(
        `Clips processing complete: ${clipsRequested} clips requested`,
      );

      return clipsRequested;
    } catch (error) {
      this.logger.error(`Error processing clips: ${error.message}`, {
        matchId,
        matchMapId,
        error: error.stack,
      });
      throw error;
    }
  }

  private async isClipsEnabled(): Promise<boolean> {
    const { settings } = await this.hasura.query({
      settings: {
        __args: {
          where: { name: { _eq: "clips_enabled" } },
        },
        value: true,
      },
    });

    const value = settings[0]?.value;
    return value === "true" || value === "1";
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
