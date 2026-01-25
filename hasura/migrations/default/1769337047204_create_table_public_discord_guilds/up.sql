CREATE TABLE IF NOT EXISTS "public"."discord_guilds" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "owner_id" TEXT,
  "category_channel_id" TEXT,
  "queue_mix_channel_id" TEXT,
  "afk_channel_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "discord_guilds_owner_id_idx" ON "public"."discord_guilds" ("owner_id");

-- Adicionar foreign key na tabela matches (apenas se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_discord_guild_id_fkey'
  ) THEN
    ALTER TABLE "public"."matches"
    ADD CONSTRAINT "matches_discord_guild_id_fkey"
    FOREIGN KEY ("discord_guild_id")
    REFERENCES "public"."discord_guilds"("id")
    ON UPDATE CASCADE
    ON DELETE SET NULL;
  END IF;
END $$;
