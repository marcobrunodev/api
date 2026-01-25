ALTER TABLE "public"."matches" ADD COLUMN IF NOT EXISTS "discord_guild_id" TEXT;

CREATE INDEX IF NOT EXISTS "matches_discord_guild_id_idx" ON "public"."matches" ("discord_guild_id");
