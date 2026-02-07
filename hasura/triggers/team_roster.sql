CREATE OR REPLACE FUNCTION public.tbi_team_roster() RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
DECLARE
    _owner_steam_id bigint;
    _existing_team_count int;
BEGIN
    -- Check if player is already in another team (can only be in one team)
    SELECT COUNT(*) INTO _existing_team_count
    FROM team_roster
    WHERE player_steam_id = NEW.player_steam_id;

    IF _existing_team_count > 0 THEN
        RAISE EXCEPTION 'Player can only be part of one team';
    END IF;

    NEW.role = 'Member';

    SELECT owner_steam_id INTO _owner_steam_id FROM teams WHERE id = NEW.team_id;

    IF _owner_steam_id = NEW.player_steam_id THEN 
        NEW.role = 'Admin';
        RETURN NEW;
    END IF;

   IF current_setting('hasura.user')::jsonb ->> 'x-hasura-role' IN ('admin', 'administrator') THEN
        RETURN NEW;
    END IF;

    INSERT INTO team_invites (team_id, steam_id, invited_by_player_steam_id)
        VALUES (NEW.team_id, NEW.player_steam_id, (current_setting('hasura.user')::jsonb->>'x-hasura-user-id')::bigint);

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tbi_team_roster ON public.team_roster;
CREATE TRIGGER tbi_team_roster BEFORE INSERT ON public.team_roster FOR EACH ROW EXECUTE FUNCTION public.tbi_team_roster();