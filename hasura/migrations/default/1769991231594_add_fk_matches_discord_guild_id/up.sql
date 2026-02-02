ALTER TABLE "public"."matches"
ADD CONSTRAINT "matches_discord_guild_id_fkey"
FOREIGN KEY ("discord_guild_id")
REFERENCES "public"."discord_guilds"("id")
ON UPDATE CASCADE
ON DELETE SET NULL;
