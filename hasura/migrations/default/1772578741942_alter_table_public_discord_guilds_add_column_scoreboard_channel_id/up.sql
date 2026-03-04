DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'discord_guilds'
        AND column_name = 'scoreboard_channel_id'
    ) THEN
        ALTER TABLE "public"."discord_guilds" ADD COLUMN "scoreboard_channel_id" text NULL;
    END IF;
END $$;
