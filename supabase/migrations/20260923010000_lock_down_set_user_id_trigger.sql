-- set_user_id_from_auth() is a SECURITY DEFINER trigger function (used by
-- name_pool_presets' BEFORE INSERT trigger). Supabase's advisor flags it as
-- callable by anon/authenticated via RPC. Real exploitability is near zero —
-- it's declared RETURNS trigger, which Postgres refuses to execute outside
-- an actual trigger context — but revoking direct EXECUTE closes the
-- advisor warning for free and doesn't affect the trigger itself (a firing
-- trigger doesn't need the invoking role to hold EXECUTE on the function).
REVOKE EXECUTE ON FUNCTION public.set_user_id_from_auth() FROM PUBLIC, anon, authenticated;
