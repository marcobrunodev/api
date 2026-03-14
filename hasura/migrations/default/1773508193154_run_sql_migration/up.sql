CREATE OR REPLACE FUNCTION public.player_total_bananas(player_row public.players)
RETURNS INTEGER AS $$
    SELECT COALESCE(SUM(amount), 0)::INTEGER
    FROM public.player_bananas
    WHERE steam_id = player_row.steam_id;
$$ LANGUAGE sql STABLE;
