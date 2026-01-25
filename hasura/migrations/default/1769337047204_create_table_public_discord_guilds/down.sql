-- Remover foreign key da tabela matches
ALTER TABLE "public"."matches"
DROP CONSTRAINT IF EXISTS "matches_discord_guild_id_fkey";

-- Remover trigger
DROP TRIGGER IF EXISTS "set_public_discord_guilds_updated_at" ON "public"."discord_guilds";

-- Remover índices
DROP INDEX IF EXISTS "public"."discord_guilds_owner_id_idx";

-- Remover tabela
DROP TABLE IF EXISTS "public"."discord_guilds";
