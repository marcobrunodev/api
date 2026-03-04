DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'match_maps'
        AND column_name = 'mvp_steam_id'
    ) THEN
        ALTER TABLE "public"."match_maps" ADD COLUMN "mvp_steam_id" int8 NULL;
    END IF;
END $$;
