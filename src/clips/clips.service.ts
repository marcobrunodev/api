import { Injectable, Logger } from "@nestjs/common";
import { HasuraService } from "../hasura/hasura.service";

interface AllstarMetadata {
  key: string;
  value: string;
}

interface AllstarClipRequest {
  demoUrl: string;
  webhookUrl: string;
  metadata?: AllstarMetadata[];
  steamId?: string;
  username?: string;
}

interface AllstarClipResponse {
  message: string;
  requestId: string;
}

interface AllstarWebhookPayload {
  event: "clip";
  _id: string;
  clipUrl: string;
  username?: string;
  steamid?: string;
  status: "Submitted" | "Processed" | "Error" | "Pruned";
  clipTitle?: string;
  clipLength?: number;
  roundNumber?: number;
  matchId?: string;
  demoUrl?: string;
  createdDate?: string;
  updated?: string;
  clipSnapshotURL?: string;
  clipImageThumbURL?: string;
  requestId: string;
  onDemand?: boolean;
  message?: string;
  metadata?: AllstarMetadata[];
  additionalData?: AllstarMetadata[];
}

@Injectable()
export class ClipsService {
  private readonly ALLSTAR_API_URL = "https://prt.allstar.gg";

  constructor(
    private readonly hasura: HasuraService,
    private readonly logger: Logger,
  ) {}

  /**
   * Request Play of the Game clip from Allstar
   * Best moment of the entire match (algorithm chooses)
   */
  async requestPotg(
    demoUrl: string,
    matchId: string,
    matchMapId: string,
  ): Promise<AllstarClipResponse | null> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      this.logger.warn("Allstar webhook URL not configured");
      return null;
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.logger.warn("Allstar API key not configured");
      return null;
    }

    const payload: AllstarClipRequest = {
      demoUrl,
      webhookUrl,
      metadata: [
        { key: "match_id", value: matchId },
        { key: "match_map_id", value: matchMapId },
        { key: "clip_type", value: "potg" },
      ],
    };

    return this.makeRequest("/cs/clip/potg", payload, apiKey);
  }

  /**
   * Request Player Match Highlights from Allstar
   * Highlights for a specific player in the match
   */
  async requestPlayerHighlights(
    demoUrl: string,
    matchId: string,
    matchMapId: string,
    steamId: string,
    username: string,
  ): Promise<AllstarClipResponse | null> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      this.logger.warn("Allstar webhook URL not configured");
      return null;
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.logger.warn("Allstar API key not configured");
      return null;
    }

    const payload: AllstarClipRequest = {
      demoUrl,
      webhookUrl,
      steamId,
      username,
      metadata: [
        { key: "match_id", value: matchId },
        { key: "match_map_id", value: matchMapId },
        { key: "clip_type", value: "pmh" },
        { key: "steam_id", value: steamId },
      ],
    };

    return this.makeRequest("/cs/clip/pmh", payload, apiKey);
  }

  /**
   * Request Best Play clip for a specific player
   */
  async requestBestPlay(
    demoUrl: string,
    matchId: string,
    matchMapId: string,
    steamId: string,
    username: string,
  ): Promise<AllstarClipResponse | null> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      this.logger.warn("Allstar webhook URL not configured");
      return null;
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.logger.warn("Allstar API key not configured");
      return null;
    }

    const payload: AllstarClipRequest = {
      demoUrl,
      webhookUrl,
      steamId,
      username,
      metadata: [
        { key: "match_id", value: matchId },
        { key: "match_map_id", value: matchMapId },
        { key: "clip_type", value: "bp" },
        { key: "steam_id", value: steamId },
      ],
    };

    return this.makeRequest("/cs/clip/bp", payload, apiKey);
  }

  /**
   * Process webhook callback from Allstar
   */
  async processWebhook(payload: AllstarWebhookPayload): Promise<void> {
    this.logger.log(`Allstar webhook received: ${payload.status}`, {
      requestId: payload.requestId,
      clipId: payload._id,
      status: payload.status,
    });

    if (payload.status === "Error") {
      this.logger.error(`Allstar clip error: ${payload.message}`, {
        requestId: payload.requestId,
      });
      await this.updateClipStatus(payload.requestId, "error", payload.message);
      return;
    }

    if (payload.status === "Submitted") {
      await this.updateClipStatus(payload.requestId, "processing");
      return;
    }

    if (payload.status === "Processed") {
      await this.saveProcessedClip(payload);
      return;
    }
  }

  /**
   * Save processed clip to database
   */
  private async saveProcessedClip(
    payload: AllstarWebhookPayload,
  ): Promise<void> {
    // Extract match_id and match_map_id from metadata
    const matchId = this.getMetadataValue(payload, "match_id");
    const matchMapId = this.getMetadataValue(payload, "match_map_id");
    const clipType = this.getMetadataValue(payload, "clip_type");
    const steamId = payload.steamid || this.getMetadataValue(payload, "steam_id");

    if (!matchId || !matchMapId) {
      this.logger.error("Missing match_id or match_map_id in webhook payload", {
        requestId: payload.requestId,
      });
      return;
    }

    // Extract kill count and other metadata
    const killCount = this.getMetadataValue(payload, "CS_Kill Count");
    const headshots = this.getMetadataValue(payload, "CS_Headshots");
    const weapons = this.getMetadataValue(payload, "CS_Weapons");
    const map = this.getMetadataValue(payload, "CS_Map");

    await this.hasura.mutation({
      insert_match_clips_one: {
        __args: {
          object: {
            match_id: matchId,
            match_map_id: matchMapId,
            allstar_clip_id: payload._id,
            allstar_request_id: payload.requestId,
            clip_url: payload.clipUrl,
            clip_type: clipType || "potg",
            status: "processed",
            steam_id: steamId,
            player_name: payload.username,
            clip_title: payload.clipTitle,
            clip_length: payload.clipLength,
            round_number: payload.roundNumber,
            thumbnail_url: payload.clipImageThumbURL,
            snapshot_url: payload.clipSnapshotURL,
            kill_count: killCount ? parseInt(killCount) : null,
            headshots: headshots ? parseInt(headshots) : null,
            weapons: weapons,
            map_name: map,
            metadata: payload.metadata || payload.additionalData,
          },
          on_conflict: {
            constraint: "match_clips_allstar_request_id_key",
            update_columns: [
              "allstar_clip_id",
              "clip_url",
              "status",
              "clip_title",
              "clip_length",
              "round_number",
              "thumbnail_url",
              "snapshot_url",
              "kill_count",
              "headshots",
              "weapons",
              "map_name",
              "metadata",
              "updated_at",
            ],
          },
        },
        id: true,
      },
    });

    this.logger.log(`Clip saved: ${payload._id}`, {
      matchId,
      matchMapId,
      clipType,
      steamId,
    });
  }

  /**
   * Update clip status in database
   */
  private async updateClipStatus(
    requestId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.hasura.mutation({
      update_match_clips: {
        __args: {
          where: {
            allstar_request_id: { _eq: requestId },
          },
          _set: {
            status,
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          },
        },
        affected_rows: true,
      },
    });
  }

  /**
   * Create initial clip record when requesting from Allstar
   */
  async createPendingClip(
    matchId: string,
    matchMapId: string,
    requestId: string,
    clipType: string,
    steamId?: string,
    playerName?: string,
  ): Promise<void> {
    await this.hasura.mutation({
      insert_match_clips_one: {
        __args: {
          object: {
            match_id: matchId,
            match_map_id: matchMapId,
            allstar_request_id: requestId,
            clip_type: clipType,
            status: "pending",
            steam_id: steamId,
            player_name: playerName,
          },
        },
        id: true,
      },
    });
  }

  /**
   * Get players from a match for requesting individual highlights
   */
  async getMatchPlayers(
    matchId: string,
  ): Promise<Array<{ steam_id: string; name: string }>> {
    // Get lineups for this match first
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: matchId,
        },
        lineup_1_id: true,
        lineup_2_id: true,
      },
    });

    if (!matches_by_pk) {
      return [];
    }

    const lineupIds = [
      matches_by_pk.lineup_1_id,
      matches_by_pk.lineup_2_id,
    ].filter(Boolean);

    if (lineupIds.length === 0) {
      return [];
    }

    const { match_lineup_players } = await this.hasura.query({
      match_lineup_players: {
        __args: {
          where: {
            match_lineup_id: { _in: lineupIds },
          },
        },
        steam_id: true,
        player: {
          name: true,
        },
      },
    });

    return match_lineup_players.map((p: any) => ({
      steam_id: p.steam_id,
      name: p.player?.name || "Unknown",
    }));
  }

  /**
   * Get demo URL for a match map
   */
  async getDemoUrl(matchMapId: string): Promise<string | null> {
    const { match_map_demos } = await this.hasura.query({
      match_map_demos: {
        __args: {
          where: {
            match_map_id: { _eq: matchMapId },
          },
          limit: 1,
        },
        download_url: true,
      },
    });

    return match_map_demos[0]?.download_url || null;
  }

  private getMetadataValue(
    payload: AllstarWebhookPayload,
    key: string,
  ): string | null {
    const allMetadata = [
      ...(payload.metadata || []),
      ...(payload.additionalData || []),
    ];
    const item = allMetadata.find((m) => m.key === key);
    return item?.value || null;
  }

  private async getApiKey(): Promise<string | null> {
    const { settings } = await this.hasura.query({
      settings: {
        __args: {
          where: { name: { _eq: "allstar_api_key" } },
        },
        value: true,
      },
    });
    return settings[0]?.value || process.env.ALLSTAR_API_KEY || null;
  }

  private async getWebhookUrl(): Promise<string | null> {
    const { settings } = await this.hasura.query({
      settings: {
        __args: {
          where: { name: { _eq: "allstar_webhook_url" } },
        },
        value: true,
      },
    });
    return settings[0]?.value || process.env.ALLSTAR_WEBHOOK_URL || null;
  }

  private async makeRequest(
    endpoint: string,
    payload: AllstarClipRequest,
    apiKey: string,
  ): Promise<AllstarClipResponse | null> {
    try {
      const response = await fetch(`${this.ALLSTAR_API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Allstar API error: ${response.status}`, {
          endpoint,
          error: errorText,
        });
        return null;
      }

      return (await response.json()) as AllstarClipResponse;
    } catch (error) {
      this.logger.error(`Allstar API request failed: ${error.message}`, {
        endpoint,
      });
      return null;
    }
  }
}
