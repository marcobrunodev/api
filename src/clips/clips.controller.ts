import { Controller, Logger, Post, Req, Res, Headers } from "@nestjs/common";
import { Request, Response } from "express";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ClipsService } from "./clips.service";
import { ClipsQueues } from "./enums/ClipsQueues";
import { HasuraEvent } from "../hasura/hasura.controller";
import { HasuraEventData } from "../hasura/types/HasuraEventData";
import { ProcessClips } from "./jobs/ProcessClips";

interface MatchMapData {
  id: string;
  match_id: string;
  status: string;
}

@Controller("clips")
export class ClipsController {
  constructor(
    private readonly clipsService: ClipsService,
    private readonly logger: Logger,
    @InjectQueue(ClipsQueues.ProcessClips) private readonly processClipsQueue: Queue,
  ) {}

  /**
   * Hasura event handler for match_map status changes
   * Triggers clip processing when a match map finishes
   */
  @HasuraEvent()
  public async match_map_clips_trigger(data: HasuraEventData<MatchMapData>) {
    // Only process when status changes to Finished
    if (data.op !== "UPDATE") {
      return;
    }

    const oldStatus = data.old.status;
    const newStatus = data.new.status;

    // Only trigger when transitioning to Finished status
    if (newStatus !== "Finished" || oldStatus === "Finished") {
      return;
    }

    const matchId = data.new.match_id;
    const matchMapId = data.new.id;

    this.logger.log(`Match map finished, queuing clip processing`, {
      matchId,
      matchMapId,
    });

    // Add job to queue with a delay to allow demo upload to complete
    await this.processClipsQueue.add(
      ProcessClips.name,
      {
        matchId,
        matchMapId,
      },
      {
        delay: 60000, // 1 minute delay to allow demo upload
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 30000,
        },
      },
    );
  }

  /**
   * Webhook endpoint for Allstar callbacks
   * Allstar will POST clip status updates here
   */
  @Post("webhook/allstar")
  public async allstarWebhook(
    @Req() request: Request,
    @Res() response: Response,
    @Headers("authorization") authHeader: string,
  ) {
    try {
      // TODO: Validate authHeader against configured secret
      // const expectedAuth = await this.getWebhookAuthString();
      // if (authHeader !== expectedAuth) {
      //   return response.status(401).json({ error: "Unauthorized" });
      // }

      const payload = request.body;

      this.logger.log("Allstar webhook received", {
        event: payload.event,
        status: payload.status,
        requestId: payload.requestId,
      });

      await this.clipsService.processWebhook(payload);

      return response.status(200).json({ message: "OK" });
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error.message}`, {
        body: request.body,
      });
      return response.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Manual trigger to request clips for a specific match map
   * Useful for testing or re-processing
   */
  @Post("request/:matchId/:matchMapId")
  public async requestClips(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      const { matchId, matchMapId } = request.params;
      const { includePotg = true, includePlayerHighlights = true } =
        request.body;

      const demoUrl = await this.clipsService.getDemoUrl(matchMapId);

      if (!demoUrl) {
        return response.status(404).json({ error: "Demo not found" });
      }

      const results: any[] = [];

      // Request Play of the Game
      if (includePotg) {
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
          results.push({ type: "potg", requestId: potgResult.requestId });
        }
      }

      // Request Player Highlights for each player
      if (includePlayerHighlights) {
        const players = await this.clipsService.getMatchPlayers(matchId);

        for (const player of players) {
          const highlightResult =
            await this.clipsService.requestPlayerHighlights(
              demoUrl,
              matchId,
              matchMapId,
              player.steam_id,
              player.name,
            );

          if (highlightResult) {
            await this.clipsService.createPendingClip(
              matchId,
              matchMapId,
              highlightResult.requestId,
              "pmh",
              player.steam_id,
              player.name,
            );
            results.push({
              type: "pmh",
              requestId: highlightResult.requestId,
              steamId: player.steam_id,
            });
          }
        }
      }

      return response.status(200).json({
        message: "Clip requests submitted",
        results,
      });
    } catch (error) {
      this.logger.error(`Request clips error: ${error.message}`);
      return response.status(500).json({ error: error.message });
    }
  }

  /**
   * Get clips for a specific match
   */
  @Post("match/:matchId")
  public async getMatchClips(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    // This would typically be handled via GraphQL/Hasura directly
    // but included here for completeness
    return response.status(200).json({
      message: "Use GraphQL to query match_clips table",
    });
  }
}
