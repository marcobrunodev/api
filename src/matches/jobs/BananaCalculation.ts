import { Job } from "bullmq";
import { WorkerHost } from "@nestjs/bullmq";
import { MatchQueues } from "../enums/MatchQueues";
import { UseQueue } from "../../utilities/QueueProcessors";
import { PostgresService } from "../../postgres/postgres.service";

@UseQueue("Matches", MatchQueues.BananaCalculation)
export class BananaCalculation extends WorkerHost {
  constructor(private readonly postgres: PostgresService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { matchId } = job.data;

    await this.postgres.query(
      `
      SELECT generate_player_bananas_for_match($1)
    `,
      [matchId],
    );
  }
}
