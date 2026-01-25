DROP INDEX IF EXISTS "public"."matches_discord_guild_id_idx";

ALTER TABLE "public"."matches" DROP COLUMN "discord_guild_id";
