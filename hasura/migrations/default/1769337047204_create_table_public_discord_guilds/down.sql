-- Remover foreign key da tabela matches
ALTER TABLE "public"."matches"
DROP CONSTRAINT IF EXISTS "matches_discord_guild_id_fkey";

-- Remover índices
DROP INDEX IF EXISTS "public"."discord_guilds_owner_id_idx";

-- Remover tabela
DROP TABLE "public"."discord_guilds";
