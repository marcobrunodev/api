CREATE TABLE public.player_bananas (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    steam_id BIGINT NOT NULL,
    match_id UUID NOT NULL,
    amount INTEGER NOT NULL,
    breakdown JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (steam_id) REFERENCES public.players(steam_id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (match_id) REFERENCES public.matches(id) ON UPDATE CASCADE ON DELETE CASCADE,
    UNIQUE (steam_id, match_id)
);
