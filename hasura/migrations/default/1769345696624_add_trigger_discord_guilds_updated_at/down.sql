-- Remover trigger da tabela discord_guilds
DROP TRIGGER IF EXISTS "set_public_discord_guilds_updated_at" ON "public"."discord_guilds";
