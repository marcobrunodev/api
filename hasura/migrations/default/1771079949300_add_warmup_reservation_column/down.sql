-- Remove warmup reservation column and index
DROP INDEX IF EXISTS idx_servers_reserved_for_warmup_guild_id;
ALTER TABLE "public"."servers" DROP COLUMN IF EXISTS "reserved_for_warmup_guild_id";
