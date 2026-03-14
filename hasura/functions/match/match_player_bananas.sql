CREATE OR REPLACE FUNCTION generate_player_bananas_for_match(_match_id UUID) RETURNS INTEGER AS $$
DECLARE
    match_record public.matches;
    player_record RECORD;
    _player_lineup_id UUID;
    _is_winner BOOLEAN;
    _is_tournament BOOLEAN;
    _multiplier INTEGER;
    _bananas INTEGER;
    _breakdown JSONB;
    _knife_kills INTEGER;
    _taser_kills INTEGER;
    _is_mvp BOOLEAN;
    _player_damage BIGINT;
    _max_damage BIGINT;
    _player_utility_damage BIGINT;
    _max_utility_damage BIGINT;
    _player_team_damage BIGINT;
    _team_kills INTEGER;
    _player_headshots INTEGER;
    _player_total_kills INTEGER;
    _hs_rate FLOAT;
    _ace_count INTEGER;
    _clutch_count INTEGER;
    _records_created INTEGER := 0;
    _participated_bananas INTEGER;
    _win_bananas INTEGER;
    _knife_bananas INTEGER;
    _taser_bananas INTEGER;
    _mvp_bananas INTEGER;
    _most_damage_bananas INTEGER;
    _most_utility_damage_bananas INTEGER;
    _hs_rate_bananas INTEGER;
    _ace_bananas INTEGER;
    _clutch_bananas INTEGER;
    _team_damage_penalty INTEGER;
    _team_kill_penalty INTEGER;
BEGIN
    -- Get the match record
    SELECT * INTO match_record FROM matches WHERE id = _match_id;

    IF match_record IS NULL THEN
        RETURN 0;
    END IF;

    -- Skip canceled matches
    IF match_record.status = 'Canceled' THEN
        RETURN 0;
    END IF;

    -- Skip matches without a winning_lineup_id (ties have no winner but players still participated)
    -- We still process for participation bananas even without a winner

    -- Check if this is a tournament match
    SELECT EXISTS(
        SELECT 1 FROM tournament_brackets tb
        JOIN tournament_stages ts ON tb.tournament_stage_id = ts.id
        WHERE tb.match_id = _match_id
    ) INTO _is_tournament;

    _multiplier := CASE WHEN _is_tournament THEN 2 ELSE 1 END;

    -- Delete any existing bananas for this match to avoid duplicates
    DELETE FROM player_bananas WHERE match_id = _match_id;

    -- Pre-calculate max damage across all players in the match (for "most damage" bonus)
    SELECT MAX(total_dmg) INTO _max_damage
    FROM (
        SELECT pd.attacker_steam_id, SUM(pd.damage) as total_dmg
        FROM player_damages pd
        JOIN match_lineup_players mlp ON pd.attacker_steam_id = mlp.steam_id
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id IS NOT NULL
          AND (mlp.match_lineup_id = match_record.lineup_1_id OR mlp.match_lineup_id = match_record.lineup_2_id)
          AND NOT EXISTS (
              SELECT 1 FROM player_damages pd2
              WHERE pd2.match_id = pd.match_id
                AND pd2.attacker_steam_id = pd.attacker_steam_id
                AND pd2.attacked_steam_id IS NOT NULL
                AND pd2.attacker_steam_id != pd2.attacked_steam_id
                AND EXISTS (
                    SELECT 1 FROM match_lineup_players mlp2
                    WHERE mlp2.steam_id = pd2.attacked_steam_id
                      AND mlp2.match_lineup_id = mlp.match_lineup_id
                )
                AND pd2.id = pd.id
          )
        GROUP BY pd.attacker_steam_id
    ) sub;

    -- Pre-calculate max utility damage across all players
    SELECT MAX(total_util_dmg) INTO _max_utility_damage
    FROM (
        SELECT pd.attacker_steam_id, SUM(pd.damage) as total_util_dmg
        FROM player_damages pd
        JOIN match_lineup_players mlp ON pd.attacker_steam_id = mlp.steam_id
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id IS NOT NULL
          AND (mlp.match_lineup_id = match_record.lineup_1_id OR mlp.match_lineup_id = match_record.lineup_2_id)
          AND pd."with" IN ('hegrenade', 'molotov', 'incgrenade', 'inferno', 'decoy', 'flashbang', 'smokegrenade')
        GROUP BY pd.attacker_steam_id
    ) sub;

    -- Recalculate max damage properly (excluding team damage)
    SELECT MAX(total_dmg) INTO _max_damage
    FROM (
        SELECT pd.attacker_steam_id, SUM(pd.damage) as total_dmg
        FROM player_damages pd
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id IS NOT NULL
        GROUP BY pd.attacker_steam_id
    ) sub;

    -- Get all players in this match
    FOR player_record IN
        SELECT DISTINCT p.steam_id
        FROM players p
        JOIN match_lineup_players mlp ON p.steam_id = mlp.steam_id
        WHERE mlp.match_lineup_id = match_record.lineup_1_id
           OR mlp.match_lineup_id = match_record.lineup_2_id
    LOOP
        _bananas := 0;
        _breakdown := '{}'::JSONB;

        -- Determine which lineup the player is in
        SELECT mlp.match_lineup_id INTO _player_lineup_id
        FROM match_lineup_players mlp
        WHERE mlp.steam_id = player_record.steam_id
          AND (mlp.match_lineup_id = match_record.lineup_1_id OR mlp.match_lineup_id = match_record.lineup_2_id)
        LIMIT 1;

        -- Check if player's team won
        _is_winner := (match_record.winning_lineup_id IS NOT NULL AND match_record.winning_lineup_id = _player_lineup_id);

        -- 1. Participation: +10 (player was in the match that finished)
        _participated_bananas := 10 * _multiplier;
        _bananas := _bananas + _participated_bananas;
        _breakdown := _breakdown || jsonb_build_object('participated', _participated_bananas);

        -- 2. Win: +20
        IF _is_winner THEN
            _win_bananas := 20 * _multiplier;
            _bananas := _bananas + _win_bananas;
            _breakdown := _breakdown || jsonb_build_object('win', _win_bananas);
        END IF;

        -- 3. Knife kills: +5 per kill
        SELECT COUNT(*) INTO _knife_kills
        FROM player_kills
        WHERE match_id = _match_id
          AND attacker_steam_id = player_record.steam_id
          AND "with" LIKE 'knife%';

        IF _knife_kills > 0 THEN
            _knife_bananas := _knife_kills * 5 * _multiplier;
            _bananas := _bananas + _knife_bananas;
            _breakdown := _breakdown || jsonb_build_object('knife_kills', _knife_bananas);
        END IF;

        -- 4. Taser kills: +3 per kill
        SELECT COUNT(*) INTO _taser_kills
        FROM player_kills
        WHERE match_id = _match_id
          AND attacker_steam_id = player_record.steam_id
          AND "with" = 'taser';

        IF _taser_kills > 0 THEN
            _taser_bananas := _taser_kills * 3 * _multiplier;
            _bananas := _bananas + _taser_bananas;
            _breakdown := _breakdown || jsonb_build_object('taser_kills', _taser_bananas);
        END IF;

        -- 5. MVP: +8
        SELECT EXISTS(
            SELECT 1 FROM match_maps
            WHERE match_id = _match_id
              AND mvp_steam_id = player_record.steam_id
        ) INTO _is_mvp;

        IF _is_mvp THEN
            _mvp_bananas := 8 * _multiplier;
            _bananas := _bananas + _mvp_bananas;
            _breakdown := _breakdown || jsonb_build_object('mvp', _mvp_bananas);
        END IF;

        -- 6. Most damage in match: +5
        SELECT COALESCE(SUM(pd.damage), 0) INTO _player_damage
        FROM player_damages pd
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id = player_record.steam_id;

        IF _player_damage > 0 AND _player_damage = _max_damage THEN
            _most_damage_bananas := 5 * _multiplier;
            _bananas := _bananas + _most_damage_bananas;
            _breakdown := _breakdown || jsonb_build_object('most_damage', _most_damage_bananas);
        END IF;

        -- 7. Most utility damage: +5
        SELECT COALESCE(SUM(pd.damage), 0) INTO _player_utility_damage
        FROM player_damages pd
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id = player_record.steam_id
          AND pd."with" IN ('hegrenade', 'molotov', 'incgrenade', 'inferno', 'decoy', 'flashbang', 'smokegrenade');

        IF _player_utility_damage > 0 AND _player_utility_damage = _max_utility_damage THEN
            _most_utility_damage_bananas := 5 * _multiplier;
            _bananas := _bananas + _most_utility_damage_bananas;
            _breakdown := _breakdown || jsonb_build_object('most_utility_damage', _most_utility_damage_bananas);
        END IF;

        -- 8. Headshot rate > 60%: +3
        SELECT COUNT(*) INTO _player_total_kills
        FROM player_kills
        WHERE match_id = _match_id
          AND attacker_steam_id = player_record.steam_id;

        SELECT COUNT(*) INTO _player_headshots
        FROM player_kills
        WHERE match_id = _match_id
          AND attacker_steam_id = player_record.steam_id
          AND headshot = true;

        IF _player_total_kills >= 5 THEN  -- Minimum 5 kills to qualify
            _hs_rate := _player_headshots::FLOAT / _player_total_kills::FLOAT;
            IF _hs_rate > 0.6 THEN
                _hs_rate_bananas := 3 * _multiplier;
                _bananas := _bananas + _hs_rate_bananas;
                _breakdown := _breakdown || jsonb_build_object('headshot_rate', _hs_rate_bananas);
            END IF;
        END IF;

        -- 9. Ace (5 kills in a round): +8 per ace
        SELECT COUNT(*) INTO _ace_count
        FROM (
            SELECT pk.round, COUNT(*) as kills_in_round
            FROM player_kills pk
            WHERE pk.match_id = _match_id
              AND pk.attacker_steam_id = player_record.steam_id
            GROUP BY pk.round
            HAVING COUNT(*) >= 5
        ) aces;

        IF _ace_count > 0 THEN
            _ace_bananas := _ace_count * 8 * _multiplier;
            _bananas := _bananas + _ace_bananas;
            _breakdown := _breakdown || jsonb_build_object('aces', _ace_bananas);
        END IF;

        -- 10. Clutch (last alive in team and won the round): +5 per clutch
        -- A clutch is when a player gets kills while being the last alive on their team
        -- We approximate this by finding rounds where the player got kills and all teammates died
        SELECT COUNT(*) INTO _clutch_count
        FROM (
            SELECT pk_round.round
            FROM (
                SELECT DISTINCT pk.round
                FROM player_kills pk
                WHERE pk.match_id = _match_id
                  AND pk.attacker_steam_id = player_record.steam_id
            ) pk_round
            WHERE (
                -- Count teammates who died this round (excluding the player)
                SELECT COUNT(DISTINCT pk2.attacked_steam_id)
                FROM player_kills pk2
                JOIN match_lineup_players mlp ON pk2.attacked_steam_id = mlp.steam_id
                WHERE pk2.match_id = _match_id
                  AND pk2.round = pk_round.round
                  AND mlp.match_lineup_id = _player_lineup_id
                  AND pk2.attacked_steam_id != player_record.steam_id
            ) >= (
                -- Total teammates (excluding the player) minus 1
                SELECT COUNT(*) - 1
                FROM match_lineup_players mlp
                WHERE mlp.match_lineup_id = _player_lineup_id
                  AND mlp.steam_id IS NOT NULL
            )
            -- And the player got at least 1 kill in that round
            AND (
                SELECT COUNT(*)
                FROM player_kills pk3
                WHERE pk3.match_id = _match_id
                  AND pk3.round = pk_round.round
                  AND pk3.attacker_steam_id = player_record.steam_id
            ) >= 1
        ) clutches;

        IF _clutch_count > 0 THEN
            _clutch_bananas := _clutch_count * 5 * _multiplier;
            _bananas := _bananas + _clutch_bananas;
            _breakdown := _breakdown || jsonb_build_object('clutches', _clutch_bananas);
        END IF;

        -- PENALTIES (no tournament multiplier)

        -- 11. Team damage: -2 per 100 damage
        SELECT COALESCE(SUM(pd.damage), 0) INTO _player_team_damage
        FROM player_damages pd
        JOIN match_lineup_players mlp ON pd.attacked_steam_id = mlp.steam_id
        WHERE pd.match_id = _match_id
          AND pd.attacker_steam_id = player_record.steam_id
          AND pd.attacker_steam_id != pd.attacked_steam_id
          AND mlp.match_lineup_id = _player_lineup_id;

        IF _player_team_damage >= 100 THEN
            _team_damage_penalty := -2 * (_player_team_damage / 100)::INTEGER;
            _bananas := _bananas + _team_damage_penalty;
            _breakdown := _breakdown || jsonb_build_object('team_damage', _team_damage_penalty);
        END IF;

        -- 12. Team kills: -5 per TK
        SELECT COUNT(*) INTO _team_kills
        FROM player_kills pk
        JOIN match_lineup_players mlp ON pk.attacked_steam_id = mlp.steam_id
        WHERE pk.match_id = _match_id
          AND pk.attacker_steam_id = player_record.steam_id
          AND pk.attacker_steam_id != pk.attacked_steam_id
          AND mlp.match_lineup_id = _player_lineup_id;

        IF _team_kills > 0 THEN
            _team_kill_penalty := -5 * _team_kills;
            _bananas := _bananas + _team_kill_penalty;
            _breakdown := _breakdown || jsonb_build_object('team_kills', _team_kill_penalty);
        END IF;

        -- Add tournament multiplier flag to breakdown
        IF _is_tournament THEN
            _breakdown := _breakdown || jsonb_build_object('tournament_multiplier', true);
        END IF;

        -- Insert the record
        INSERT INTO player_bananas (
            steam_id,
            match_id,
            amount,
            breakdown,
            created_at
        ) VALUES (
            player_record.steam_id,
            match_record.id,
            _bananas,
            _breakdown,
            COALESCE(match_record.ended_at, now())
        );

        _records_created := _records_created + 1;
    END LOOP;

    RETURN _records_created;
END;
$$ LANGUAGE plpgsql;
