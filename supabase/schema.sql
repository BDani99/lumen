-- Lumen: complete baseline schema for a FRESH Supabase project.
--
-- Run once in the Dashboard SQL Editor (or via `supabase db query -f`) on an
-- empty project. It is the end state of everything in `migrations/` plus the
-- base tables (channels, video_projects, video_scenes) that the migrations
-- assume already exist. Existing databases keep using `migrations/`.
--
-- Not idempotent: it creates tables, so run it on an empty database only.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create or replace function public.set_user_id_from_auth()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$function$;

revoke execute on function public.set_user_id_from_auth() from public, anon, authenticated;

create table public.name_pool_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  categories jsonb not null default '[]'::jsonb,
  min_names_per_category integer not null default 20,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text default 'hu'::text,
  text_model text default 'gpt-4o-mini'::text,
  image_model text default 'gpt-image-2'::text,
  master_script_prompt text,
  master_image_prompt text,
  ai33_voice_settings jsonb,
  video_format text default '16:9'::text,
  created_at timestamptz default timezone('utc'::text, now()),
  sentences_per_image integer default 2,
  image_style text,
  use_stock_video boolean default false,
  image_prompt_base text,
  thumbnail_prompt text,
  auto_zoom_effect boolean default true,
  use_character_glossary_for_thumbnails boolean default true,
  auto_generate_thumbnail boolean default true,
  auto_zoom_level integer default 115,
  audio_volume integer default 100,
  user_id uuid references auth.users(id) on delete cascade,
  polish_model text,
  name_pools jsonb default '{}'::jsonb,
  video_generation_defaults jsonb default '{}'::jsonb,
  use_name_pools boolean not null default false,
  name_usage jsonb not null default '{}'::jsonb,
  name_pool_preset_id uuid references public.name_pool_presets(id) on delete set null,
  stock_settings jsonb not null default '{}'::jsonb,
  use_location_shots boolean not null default false,
  location_shot_sec double precision not null default 3
);

comment on column public.channels.use_name_pools is 'When true and each name pool category has >=20 entries, AI uses pools with usage-aware rotation';
comment on column public.channels.name_usage is 'Per-category map of name -> { lastUsed ISO, count } for rotation';

create table public.video_projects (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade,
  title text not null,
  status text default 'Draft'::text,
  generated_script text,
  character_glossary jsonb,
  srt_data jsonb,
  timeline_data jsonb,
  created_at timestamptz default timezone('utc'::text, now()),
  updated_at timestamptz default timezone('utc'::text, now()),
  is_flagged boolean default false,
  thumbnail_url text,
  generation_cost_usd double precision default 0,
  user_id uuid references auth.users(id) on delete cascade,
  exported_at timestamptz,
  pipeline text not null default 'classic'::text,
  pro_settings jsonb,
  pro_plan jsonb
);

create table public.video_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.video_projects(id) on delete cascade,
  scene_order integer not null,
  start_time double precision,
  end_time double precision,
  text_segment text,
  image_prompt text,
  image_url text,
  is_regenerating boolean default false,
  created_at timestamptz default timezone('utc'::text, now()),
  effect text,
  video_url text,
  location_name text,
  location_image_url text
);

create table public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  level text not null default 'info'::text
    constraint generation_logs_level_check check (level = any (array['info'::text, 'success'::text, 'warn'::text, 'error'::text])),
  stage text not null default 'general'::text,
  message text not null,
  meta jsonb default '{}'::jsonb
);

create table public.pro_shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  shot_index integer not null,
  start_sec double precision not null default 0,
  end_sec double precision not null default 0,
  source_kind text not null default 'ai_image'::text,
  asset_url text,
  overlay_url text,
  prompt text,
  search_query text,
  narration_text text,
  keywords jsonb default '[]'::jsonb,
  ken_burns jsonb,
  attribution text,
  status text not null default 'planned'::text,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.dictionary_owners (
  dictionary_id integer primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table public.rate_limit_hits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  route_key text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index channels_user_id_idx on public.channels using btree (user_id);
create index dictionary_owners_user_id_idx on public.dictionary_owners using btree (user_id);
create index generation_logs_project_id_created_at_idx on public.generation_logs using btree (project_id, created_at);
create index name_pool_presets_user_id_idx on public.name_pool_presets using btree (user_id);
create index pro_shots_project_idx on public.pro_shots using btree (project_id, shot_index);
create index rate_limit_hits_user_route_time_idx on public.rate_limit_hits using btree (user_id, route_key, created_at desc);
create index video_projects_pipeline_idx on public.video_projects using btree (pipeline);
create index video_projects_user_id_created_at_idx on public.video_projects using btree (user_id, created_at desc);
create index video_projects_user_id_idx on public.video_projects using btree (user_id);

create trigger channels_set_user_id before insert on public.channels for each row execute function public.set_user_id_from_auth();
create trigger name_pool_presets_set_user_id before insert on public.name_pool_presets for each row execute function public.set_user_id_from_auth();
create trigger video_projects_set_user_id before insert on public.video_projects for each row execute function public.set_user_id_from_auth();

alter table public.channels enable row level security;
alter table public.dictionary_owners enable row level security;
alter table public.generation_logs enable row level security;
alter table public.name_pool_presets enable row level security;
alter table public.pro_shots enable row level security;
alter table public.rate_limit_hits enable row level security;
alter table public.video_projects enable row level security;
alter table public.video_scenes enable row level security;

-- Own-row policies
create policy channels_select_own on public.channels for select to authenticated using (auth.uid() = user_id);
create policy channels_insert_own on public.channels for insert to authenticated with check (auth.uid() = user_id);
create policy channels_update_own on public.channels for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy channels_delete_own on public.channels for delete to authenticated using (auth.uid() = user_id);

create policy video_projects_select_own on public.video_projects for select to authenticated using (auth.uid() = user_id);
create policy video_projects_insert_own on public.video_projects for insert to authenticated with check (auth.uid() = user_id);
create policy video_projects_update_own on public.video_projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy video_projects_delete_own on public.video_projects for delete to authenticated using (auth.uid() = user_id);

create policy name_pool_presets_select_own on public.name_pool_presets for select to authenticated using (auth.uid() = user_id);
create policy name_pool_presets_insert_own on public.name_pool_presets for insert to authenticated with check (auth.uid() = user_id);
create policy name_pool_presets_update_own on public.name_pool_presets for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy name_pool_presets_delete_own on public.name_pool_presets for delete to authenticated using (auth.uid() = user_id);

create policy dictionary_owners_all_own on public.dictionary_owners for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy rate_limit_hits_select_own on public.rate_limit_hits for select to authenticated using (auth.uid() = user_id);

-- Child tables: owned through their project
create policy video_scenes_select_own on public.video_scenes for select to authenticated using (exists (select 1 from public.video_projects p where p.id = video_scenes.project_id and p.user_id = auth.uid()));
create policy video_scenes_insert_own on public.video_scenes for insert to authenticated with check (exists (select 1 from public.video_projects p where p.id = video_scenes.project_id and p.user_id = auth.uid()));
create policy video_scenes_update_own on public.video_scenes for update to authenticated using (exists (select 1 from public.video_projects p where p.id = video_scenes.project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.video_projects p where p.id = video_scenes.project_id and p.user_id = auth.uid()));
create policy video_scenes_delete_own on public.video_scenes for delete to authenticated using (exists (select 1 from public.video_projects p where p.id = video_scenes.project_id and p.user_id = auth.uid()));

create policy generation_logs_select_own on public.generation_logs for select to authenticated using (exists (select 1 from public.video_projects p where p.id = generation_logs.project_id and p.user_id = auth.uid()));
create policy generation_logs_insert_own on public.generation_logs for insert to authenticated with check (exists (select 1 from public.video_projects p where p.id = generation_logs.project_id and p.user_id = auth.uid()));
create policy generation_logs_update_own on public.generation_logs for update to authenticated using (exists (select 1 from public.video_projects p where p.id = generation_logs.project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.video_projects p where p.id = generation_logs.project_id and p.user_id = auth.uid()));
create policy generation_logs_delete_own on public.generation_logs for delete to authenticated using (exists (select 1 from public.video_projects p where p.id = generation_logs.project_id and p.user_id = auth.uid()));

create policy pro_shots_select_own on public.pro_shots for select to authenticated using (exists (select 1 from public.video_projects p where p.id = pro_shots.project_id and p.user_id = auth.uid()));
create policy pro_shots_insert_own on public.pro_shots for insert to authenticated with check (exists (select 1 from public.video_projects p where p.id = pro_shots.project_id and p.user_id = auth.uid()));
create policy pro_shots_update_own on public.pro_shots for update to authenticated using (exists (select 1 from public.video_projects p where p.id = pro_shots.project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.video_projects p where p.id = pro_shots.project_id and p.user_id = auth.uid()));
create policy pro_shots_delete_own on public.pro_shots for delete to authenticated using (exists (select 1 from public.video_projects p where p.id = pro_shots.project_id and p.user_id = auth.uid()));

-- Realtime (the editor subscribes to video_scenes as well, so it is included here)
alter publication supabase_realtime add table public.generation_logs;
alter publication supabase_realtime add table public.video_projects;
alter publication supabase_realtime add table public.video_scenes;

-- Table privileges for the API roles. Newer Supabase projects do not grant
-- these automatically; without them every query fails with "permission
-- denied". `anon` gets nothing: the app never reads tables without a session,
-- and RLS is a second line of defence for `authenticated`.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
