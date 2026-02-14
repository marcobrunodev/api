-- Add column to track warmup server reservations (no FK constraint since it's a guild ID, not a match ID)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'servers'
        AND column_name = 'reserved_for_warmup_guild_id'
    ) THEN
        ALTER TABLE "public"."servers" ADD COLUMN "reserved_for_warmup_guild_id" text NULL;
    END IF;
END $$;

-- Add index for faster lookups (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_servers_reserved_for_warmup_guild_id ON "public"."servers" ("reserved_for_warmup_guild_id");
