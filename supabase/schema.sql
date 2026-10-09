-- ============================================================
-- SampleHelp — схема базы данных Supabase (PostgreSQL)
-- Выполнить в SQL Editor проекта Supabase
-- ============================================================

-- ---------- ПРОФИЛИ ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text,
  links jsonb default '[]'::jsonb,              -- [{ platform, url }] — платформа распознаётся на клиенте
  rating int default 0,
  created_at timestamptz default now()
);

-- ---------- ВОПРОСЫ ----------
-- Тип звука / сложность / теги здесь НЕ храним:
-- спрашивающий не знает, что это за звук — их указывает отвечающий.
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  audio_url text,
  waveform_data jsonb,                          -- РЕАЛЬНЫЕ пики декодированного аудио
  synth text,                                   -- Serum / Phase Plant / … или пусто («не знаю»)
  status text default 'open',                   -- open / solved
  likes_count int default 0,
  answers_count int default 0,
  created_at timestamptz default now()
);

-- ---------- ОТВЕТЫ ----------
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null,
  links jsonb default '[]'::jsonb,              -- ссылки на туториалы/статьи
  preset_url text,                              -- .fxb/.json/.fxp в Supabase Storage
  preset_name text,
  sound_type text,                              -- Bass / Pad / Lead / FX … (определяет отвечающий)
  difficulty text,                              -- beginner / intermediate / advanced
  tags text[] default '{}',                     -- теги ответа
  is_solution boolean default false,
  likes_count int default 0,
  created_at timestamptz default now()
);

-- ---------- КОММЕНТАРИИ ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid references public.answers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- ---------- ЛАЙКИ ----------
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('question', 'answer')),
  target_id uuid not null,
  created_at timestamptz default now(),
  unique (user_id, target_type, target_id)
);

-- ---------- ИЗБРАННОЕ ----------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  status text default 'preparing',              -- preparing / ready
  created_at timestamptz default now(),
  unique (user_id, question_id)
);

-- ---------- СООБЩЕНИЯ ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  content text not null,
  read boolean default false,
  created_at timestamptz default now()
);
create index if not exists messages_dialog_idx
  on public.messages (sender_id, recipient_id, created_at desc);

-- ---------- СПРАВОЧНИКИ (общие для всех пользователей) ----------
-- Пользователь может добавить свой вариант через «+» — он виден всем
create table if not exists public.synth_catalog (
  name text primary key,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.daw_catalog (
  name text primary key,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Начальное наполнение справочников
insert into public.synth_catalog (name) values
  ('Serum'), ('Phase Plant'), ('Vital'), ('Massive X'), ('Diva'),
  ('Omnisphere'), ('Sylenth1'), ('Pigments')
on conflict (name) do nothing;

insert into public.daw_catalog (name) values
  ('FL Studio'), ('Ableton Live'), ('Logic Pro'), ('Reaper'), ('Cubase'),
  ('Studio One'), ('Bitwig Studio'), ('Pro Tools'), ('GarageBand'), ('Reason')
on conflict (name) do nothing;

-- ---------- УВЕДОМЛЕНИЯ ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,                           -- answer / like / new_question_tag / message
  payload jsonb default '{}'::jsonb,
  read boolean default false,
  created_at timestamptz default now()
);

-- ---------- ДОСТИЖЕНИЯ ----------
create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  achievement_type text not null,
  earned_at timestamptz default now(),
  unique (user_id, achievement_type)
);

-- ---------- НАВЫКИ И DAW ----------
create table if not exists public.user_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  skill_name text not null
);

create table if not exists public.user_software (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  software_name text not null                   -- название DAW из daw_catalog (или своя)
);

-- ---------- ПОДПИСКИ (авторы / теги) ----------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('author', 'tag')),
  target_id text not null,
  created_at timestamptz default now(),
  unique (user_id, target_type, target_id)
);

-- ============================================================
-- МОНЕТИЗАЦИЯ (структура заложена, не используется активно)
-- Активация — флаг ENABLE_MONETIZATION в config.mjs
-- ============================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  price numeric(10,2) not null default 0,
  currency text default 'USD',
  file_path text,                               -- защищённый путь в Storage (RLS)
  synth text,
  created_at timestamptz default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  buyer_id uuid references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null,
  commission numeric(10,2) not null default 0,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.subscriptions_premium (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  plan text default 'monthly',
  active boolean default false,
  started_at timestamptz,
  expires_at timestamptz
);

create table if not exists public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  plugin_name text not null,
  url text not null,
  clicks int default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.favorites enable row level security;
alter table public.messages enable row level security;
alter table public.synth_catalog enable row level security;
alter table public.daw_catalog enable row level security;
alter table public.notifications enable row level security;
alter table public.achievements enable row level security;
alter table public.user_skills enable row level security;
alter table public.user_software enable row level security;
alter table public.subscriptions enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.subscriptions_premium enable row level security;
alter table public.affiliate_links enable row level security;

-- Публичное чтение: профили, вопросы, ответы, комментарии, справочники
create policy "profiles_public_read" on public.profiles for select using (true);
create policy "profiles_own_write" on public.profiles for update using (auth.uid() = id);
create policy "profiles_own_insert" on public.profiles for insert with check (auth.uid() = id);

create policy "questions_public_read" on public.questions for select using (true);
create policy "questions_auth_insert" on public.questions for insert with check (auth.uid() = user_id);
create policy "questions_own_update" on public.questions for update using (auth.uid() = user_id);
create policy "questions_own_delete" on public.questions for delete using (auth.uid() = user_id);

create policy "answers_public_read" on public.answers for select using (true);
create policy "answers_auth_insert" on public.answers for insert with check (auth.uid() = user_id);
create policy "answers_own_update" on public.answers for update using (auth.uid() = user_id);

create policy "comments_public_read" on public.comments for select using (true);
create policy "comments_auth_insert" on public.comments for insert with check (auth.uid() = user_id);

create policy "likes_public_read" on public.likes for select using (true);
create policy "likes_own_write" on public.likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "favorites_own" on public.favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Приватные сообщения: видны только участникам диалога
create policy "messages_participants_read" on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);
create policy "messages_auth_send" on public.messages for insert
  with check (auth.uid() = sender_id);
create policy "messages_recipient_update" on public.messages for update
  using (auth.uid() = recipient_id);

-- Справочники: чтение всем, добавление — авторизованным
create policy "synth_catalog_public_read" on public.synth_catalog for select using (true);
create policy "synth_catalog_auth_insert" on public.synth_catalog for insert with check (auth.role() = 'authenticated');
create policy "daw_catalog_public_read" on public.daw_catalog for select using (true);
create policy "daw_catalog_auth_insert" on public.daw_catalog for insert with check (auth.role() = 'authenticated');

create policy "notifications_own" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "achievements_public_read" on public.achievements for select using (true);
create policy "achievements_own_insert" on public.achievements for insert with check (auth.uid() = user_id);

create policy "skills_own" on public.user_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "skills_public_read" on public.user_skills for select using (true);

create policy "software_own" on public.user_software for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "software_public_read" on public.user_software for select using (true);

create policy "subscriptions_own" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Монетизация: чтение каталога публичное, заказы — только свои,
-- файлы пресетов в Storage защищены отдельными RLS-политиками бакета
create policy "products_public_read" on public.products for select using (true);
create policy "products_seller_write" on public.products for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "orders_own_read" on public.orders for select using (auth.uid() = buyer_id);
create policy "premium_own_read" on public.subscriptions_premium for select using (auth.uid() = user_id);
create policy "affiliate_own" on public.affiliate_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- REALTIME ----------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;

-- ---------- ХРАНИЛИЩА (создать бакеты) ----------
-- insert into storage.buckets (id, name, public) values
--   ('question-audio', 'question-audio', true),
--   ('presets', 'presets', true),
--   ('avatars', 'avatars', true),
--   ('marketplace-files', 'marketplace-files', false);  -- приватный (RLS)