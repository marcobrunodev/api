-- Criar função set_current_timestamp_updated_at se não existir
CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"()
RETURNS TRIGGER AS $$
DECLARE
  _new record;
BEGIN
  _new := NEW;
  _new."updated_at" = NOW();
  RETURN _new;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger para updated_at na tabela discord_guilds
DROP TRIGGER IF EXISTS "set_public_discord_guilds_updated_at" ON "public"."discord_guilds";

CREATE TRIGGER "set_public_discord_guilds_updated_at"
BEFORE UPDATE ON "public"."discord_guilds"
FOR EACH ROW
EXECUTE PROCEDURE "public"."set_current_timestamp_updated_at"();

COMMENT ON TRIGGER "set_public_discord_guilds_updated_at" ON "public"."discord_guilds"
IS 'trigger to set value of column "updated_at" to current timestamp on row update';
