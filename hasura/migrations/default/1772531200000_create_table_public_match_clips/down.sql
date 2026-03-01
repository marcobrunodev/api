-- Drop trigger
DROP TRIGGER IF EXISTS "set_public_match_clips_updated_at" ON "public"."match_clips";

-- Drop indexes
DROP INDEX IF EXISTS "public"."match_clips_match_id_idx";
DROP INDEX IF EXISTS "public"."match_clips_match_map_id_idx";
DROP INDEX IF EXISTS "public"."match_clips_steam_id_idx";
DROP INDEX IF EXISTS "public"."match_clips_status_idx";
DROP INDEX IF EXISTS "public"."match_clips_clip_type_idx";
DROP INDEX IF EXISTS "public"."match_clips_allstar_clip_id_idx";

-- Drop table
DROP TABLE IF EXISTS "public"."match_clips";
