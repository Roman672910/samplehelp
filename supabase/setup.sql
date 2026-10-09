-- ============================================================
-- SampleHelp — ПОЛНАЯ настройка базы Supabase одним скриптом
-- ============================================================
-- Как использовать:
--   Supabase Dashboard → SQL Editor → New query →
--   вставить ВЕСЬ этот файл → Run
--
-- Скрипт идемпотентен: его можно запускать сколько угодно раз.
-- Уже существующие таблицы/политики/бакеты не дублируются и
-- не вызывают ошибок. В конце выводится отчёт о состоянии БД.
-- ============================================================

-- ======================= ТАБЛИЦЫ =============================

-- ---------- ПРОФИЛИ ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text,
  links jsonb default '[]'::jsonb,              -- [{ platform, url }]
  rating int default 0,
  created_at timestamptz default now()
);

-- ---------- ВОПРОСЫ ----------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  audio_url text,
  waveform_data jsonb,
  synth text,
  status text default 'open',
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
  -- answers.links: [{ url, kind, label? }], kind: '' | 'video' | 'article' | 'docs' | 'preset' | 'other';
  -- label — своя пометка (при kind = 'other'). Старый формат ["https://…", …] обрабатывается
  -- на клиенте (normalizeLinks в public/js/links.mjs) — миграция данных не требуется.
  links jsonb default '[]'::jsonb,
  preset_url text,
  preset_name text,
  sound_type text,
  difficulty text,
  tags text[] default '{}',
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
  status text default 'preparing',
  created_at timestamptz default now(),
  unique (user_id, question_id)
);

-- ---------- СООБЩЕНИЯ ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  content text not null default '',
  read boolean default false,
  created_at timestamptz default now()
);
-- Аудио «ваш вариант звука» в ответах + маркеры на вейвформе вопроса
alter table public.answers add column if not exists audio_url text;
alter table public.answers add column if not exists waveform_data jsonb;
alter table public.questions add column if not exists markers jsonb default '[]'::jsonb;
alter table public.questions add column if not exists category text default 'unknown';

-- Маркеры «вот этот момент» в аудио ответов: [{ time: сек, note }] (не больше 2,
-- лимит CONFIG.MAX_MARKERS на клиенте)
alter table public.answers add column if not exists markers jsonb default '[]'::jsonb;
-- Отметки момента в комментариях убраны из продукта — удаляем колонку, если она уже создавалась
alter table public.comments drop column if exists marker_time;

-- Редактирование постов: отметка «(изменено)» для вопросов / ответов / комментариев
alter table public.questions add column if not exists edited_at timestamptz;
alter table public.answers add column if not exists edited_at timestamptz;
alter table public.comments add column if not exists edited_at timestamptz;

-- Расширения чата: аудио-вложения, реакции, отметка о редактировании
alter table public.messages add column if not exists audio_url text;
alter table public.messages add column if not exists waveform_data jsonb;
alter table public.messages add column if not exists reactions jsonb default '[]'::jsonb;
alter table public.messages add column if not exists edited_at timestamptz;
create index if not exists messages_dialog_idx
  on public.messages (sender_id, recipient_id, created_at desc);

-- ---------- СПРАВОЧНИКИ (общие для всех) ----------
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

-- ---------- УВЕДОМЛЕНИЯ ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,
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
  software_name text not null
);

-- ---------- АРСЕНАЛ (мои плагины/синтезаторы) ----------
create table if not exists public.user_arsenal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  item_name text not null
);

-- ---------- ШОУКЕЙС «МОЁ ЗВУЧАНИЕ» (до 3 треков) ----------
create table if not exists public.user_showcase (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null default '',
  audio_url text not null,
  waveform_data jsonb,
  created_at timestamptz default now()
);

-- Статус «открыт к коллаборациям» в профиле
alter table public.profiles add column if not exists open_to_collab boolean default false;

-- Стиль обложки профиля: пользователь выбирает один из пяти вариантов
-- вейвформы (генераторы — public/js/covers.mjs). NULL/неизвестное значение
-- на клиенте трактуется как 'depth' (DEFAULT_COVER_STYLE).
alter table public.profiles add column if not exists cover_style text default 'depth';

-- Ограничение — отдельным блоком: «add column if not exists» не добавляет
-- constraint к уже существующей колонке, а так скрипт остаётся идемпотентным
-- и подтягивает проверку при повторном запуске.
alter table public.profiles drop constraint if exists profiles_cover_style_check;
alter table public.profiles add constraint profiles_cover_style_check
  check (cover_style is null
         or cover_style in ('depth', 'mirror', 'spectrum', 'wave', 'studio'));

-- ---------- ПОДПИСКИ ----------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('author', 'tag')),
  target_id text not null,
  created_at timestamptz default now(),
  unique (user_id, target_type, target_id)
);

-- ---------- ДОНАТЫ / ПОДДЕРЖКА ----------
-- recipient_user_id = NULL означает «поддержать проект».
-- status: intent (намерение, текущая заглушка) / paid / refunded —
-- paid будет выставляться вебхуком платёжного провайдера.
create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid references public.profiles(id) on delete set null,
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'RUB',
  message text,
  status text not null default 'intent',
  created_at timestamptz default now()
);

-- ---------- МОНЕТИЗАЦИЯ (заготовки, не используются активно) ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  price numeric(10,2) not null default 0,
  currency text default 'USD',
  file_path text,
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

-- ==================== НАЧАЛЬНОЕ НАПОЛНЕНИЕ ====================

insert into public.synth_catalog (name) values
  ('Serum'), ('Phase Plant'), ('Vital'), ('Massive X'), ('Diva'),
  ('Omnisphere'), ('Sylenth1'), ('Pigments')
on conflict (name) do nothing;

insert into public.daw_catalog (name) values
  ('FL Studio'), ('Ableton Live'), ('Logic Pro'), ('Reaper'), ('Cubase'),
  ('Studio One'), ('Bitwig Studio'), ('Pro Tools'), ('GarageBand'), ('Reason')
on conflict (name) do nothing;

-- ==================== RLS ================================

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
alter table public.user_arsenal enable row level security;
alter table public.user_showcase enable row level security;
alter table public.donations enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.subscriptions_premium enable row level security;
alter table public.affiliate_links enable row level security;

-- Политики пересоздаются при каждом запуске (drop if exists → create)

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles for select using (true);
drop policy if exists "profiles_own_write" on public.profiles;
create policy "profiles_own_write" on public.profiles for update using (auth.uid() = id);
drop policy if exists "profiles_own_insert" on public.profiles;
create policy "profiles_own_insert" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "questions_public_read" on public.questions;
create policy "questions_public_read" on public.questions for select using (true);
drop policy if exists "questions_auth_insert" on public.questions;
create policy "questions_auth_insert" on public.questions for insert with check (auth.uid() = user_id);
drop policy if exists "questions_own_update" on public.questions;
create policy "questions_own_update" on public.questions for update using (auth.uid() = user_id);
drop policy if exists "questions_own_delete" on public.questions;
create policy "questions_own_delete" on public.questions for delete using (auth.uid() = user_id);

drop policy if exists "answers_public_read" on public.answers;
create policy "answers_public_read" on public.answers for select using (true);
drop policy if exists "answers_auth_insert" on public.answers;
create policy "answers_auth_insert" on public.answers for insert with check (auth.uid() = user_id);
drop policy if exists "answers_own_update" on public.answers;
create policy "answers_own_update" on public.answers for update using (auth.uid() = user_id);
drop policy if exists "answers_own_delete" on public.answers;
create policy "answers_own_delete" on public.answers for delete using (auth.uid() = user_id);
-- Автор вопроса может помечать «✓ Решение» в ответах на свой вопрос
drop policy if exists "answers_question_owner_update" on public.answers;
create policy "answers_question_owner_update" on public.answers for update
  using (exists (
    select 1 from public.questions q
    where q.id = answers.question_id and q.user_id = auth.uid()
  ));

drop policy if exists "comments_public_read" on public.comments;
create policy "comments_public_read" on public.comments for select using (true);
drop policy if exists "comments_auth_insert" on public.comments;
create policy "comments_auth_insert" on public.comments for insert with check (auth.uid() = user_id);
-- Автор может редактировать и удалять свой комментарий
drop policy if exists "comments_own_update" on public.comments;
create policy "comments_own_update" on public.comments for update using (auth.uid() = user_id);
drop policy if exists "comments_own_delete" on public.comments;
create policy "comments_own_delete" on public.comments for delete using (auth.uid() = user_id);

drop policy if exists "likes_public_read" on public.likes;
create policy "likes_public_read" on public.likes for select using (true);
drop policy if exists "likes_own_write" on public.likes;
create policy "likes_own_write" on public.likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "favorites_own" on public.favorites;
create policy "favorites_own" on public.favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages_participants_read" on public.messages;
create policy "messages_participants_read" on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "messages_auth_send" on public.messages;
create policy "messages_auth_send" on public.messages for insert
  with check (auth.uid() = sender_id);
drop policy if exists "messages_recipient_update" on public.messages;
create policy "messages_recipient_update" on public.messages for update
  using (auth.uid() = recipient_id);
-- Отправитель может редактировать (content, edited_at) и удалять свои сообщения
drop policy if exists "messages_sender_update" on public.messages;
create policy "messages_sender_update" on public.messages for update
  using (auth.uid() = sender_id);
drop policy if exists "messages_sender_delete" on public.messages;
create policy "messages_sender_delete" on public.messages for delete
  using (auth.uid() = sender_id);

drop policy if exists "synth_catalog_public_read" on public.synth_catalog;
create policy "synth_catalog_public_read" on public.synth_catalog for select using (true);
drop policy if exists "synth_catalog_auth_insert" on public.synth_catalog;
create policy "synth_catalog_auth_insert" on public.synth_catalog for insert with check (auth.role() = 'authenticated');

drop policy if exists "daw_catalog_public_read" on public.daw_catalog;
create policy "daw_catalog_public_read" on public.daw_catalog for select using (true);
drop policy if exists "daw_catalog_auth_insert" on public.daw_catalog;
create policy "daw_catalog_auth_insert" on public.daw_catalog for insert with check (auth.role() = 'authenticated');

drop policy if exists "notifications_own" on public.notifications;
drop policy if exists "notifications_own_read" on public.notifications;
create policy "notifications_own_read" on public.notifications for select using (auth.uid() = user_id);
-- Вставка: уведомление создаёт ДРУГОЙ пользователь (автор вопроса помечает
-- решение, лайкнувший и т.д.) — поэтому insert для всех авторизованных
drop policy if exists "notifications_auth_insert" on public.notifications;
create policy "notifications_auth_insert" on public.notifications for insert with check (auth.role() = 'authenticated');
drop policy if exists "notifications_own_update" on public.notifications;
create policy "notifications_own_update" on public.notifications for update using (auth.uid() = user_id);
drop policy if exists "notifications_own_delete" on public.notifications;
create policy "notifications_own_delete" on public.notifications for delete using (auth.uid() = user_id);

drop policy if exists "achievements_public_read" on public.achievements;
create policy "achievements_public_read" on public.achievements for select using (true);
drop policy if exists "achievements_own_insert" on public.achievements;
create policy "achievements_own_insert" on public.achievements for insert with check (auth.uid() = user_id);

drop policy if exists "skills_own" on public.user_skills;
create policy "skills_own" on public.user_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "skills_public_read" on public.user_skills;
create policy "skills_public_read" on public.user_skills for select using (true);

drop policy if exists "software_own" on public.user_software;
create policy "software_own" on public.user_software for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "software_public_read" on public.user_software;
create policy "software_public_read" on public.user_software for select using (true);

drop policy if exists "subscriptions_own" on public.subscriptions;
create policy "subscriptions_own" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "arsenal_own" on public.user_arsenal;
create policy "arsenal_own" on public.user_arsenal for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "arsenal_public_read" on public.user_arsenal;
create policy "arsenal_public_read" on public.user_arsenal for select using (true);

drop policy if exists "showcase_public_read" on public.user_showcase;
create policy "showcase_public_read" on public.user_showcase for select using (true);
drop policy if exists "showcase_own_write" on public.user_showcase;
create policy "showcase_own_write" on public.user_showcase for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Донаты: счётчики публичны, вставка — любому авторизованному донору
drop policy if exists "donations_public_read" on public.donations;
create policy "donations_public_read" on public.donations for select using (true);
drop policy if exists "donations_auth_insert" on public.donations;
create policy "donations_auth_insert" on public.donations for insert with check (auth.uid() = donor_id);

drop policy if exists "products_public_read" on public.products;
create policy "products_public_read" on public.products for select using (true);
drop policy if exists "products_seller_write" on public.products;
create policy "products_seller_write" on public.products for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
drop policy if exists "orders_own_read" on public.orders;
create policy "orders_own_read" on public.orders for select using (auth.uid() = buyer_id);
drop policy if exists "premium_own_read" on public.subscriptions_premium;
create policy "premium_own_read" on public.subscriptions_premium for select using (auth.uid() = user_id);
drop policy if exists "affiliate_own" on public.affiliate_links;
create policy "affiliate_own" on public.affiliate_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ==================== СЧЁТЧИКИ (ТРИГГЕРЫ) ==================
-- Лайки и число ответов пересчитываются на стороне БД.
-- Клиенту не нужно править чужие строки (иначе это блокирует RLS).
--
-- Примечание о формате public.answers.links (колонка определена выше):
--   [{ url, kind, label? }], kind: '' | 'video' | 'article' | 'docs' | 'preset' | 'other';
--   label — своя пометка (при kind = 'other'). Старый формат ["https://…", …]
--   обрабатывается на клиенте (normalizeLinks в public/js/links.mjs) — миграция не нужна.

create or replace function public.bump_like_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ttype text := coalesce(new.target_type, old.target_type);
  tid uuid := coalesce(new.target_id, old.target_id);
begin
  if ttype = 'question' then
    update public.questions
       set likes_count = (select count(*) from public.likes
                          where target_type = 'question' and target_id = tid)
     where id = tid;
  elsif ttype = 'answer' then
    update public.answers
       set likes_count = (select count(*) from public.likes
                          where target_type = 'answer' and target_id = tid)
     where id = tid;
  end if;
  return null;
end $$;

create or replace function public.bump_answers_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  qid uuid := coalesce(new.question_id, old.question_id);
begin
  update public.questions
     set answers_count = (select count(*) from public.answers where question_id = qid)
   where id = qid;
  return null;
end $$;

drop trigger if exists likes_bump on public.likes;
create trigger likes_bump
after insert or delete on public.likes
for each row execute function public.bump_like_counts();

drop trigger if exists answers_bump on public.answers;
create trigger answers_bump
after insert or delete on public.answers
for each row execute function public.bump_answers_count();

-- Удаление ответа-решения возвращает вопросу статус «открыт»
create or replace function public.answers_delete_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_solution then
    update public.questions set status = 'open' where id = old.question_id;
  end if;
  return null;
end $$;

drop trigger if exists answers_delete_cleanup on public.answers;
create trigger answers_delete_cleanup
after delete on public.answers
for each row execute function public.answers_delete_cleanup();

-- ==================== REALTIME =============================
-- (идемпотентно: добавляем таблицы в публикацию только если их там нет)

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

-- ==================== STORAGE ==============================

-- Бакеты: аудио вопросов, пресеты, аватары — публичные;
-- файлы маркетплейса — приватные
insert into storage.buckets (id, name, public) values
  ('question-audio', 'question-audio', true),
  ('presets', 'presets', true),
  ('avatars', 'avatars', true),
  ('marketplace-files', 'marketplace-files', false)
on conflict (id) do nothing;

drop policy if exists "public_read_media" on storage.objects;
create policy "public_read_media" on storage.objects
  for select using (bucket_id in ('question-audio', 'presets', 'avatars'));

drop policy if exists "auth_upload" on storage.objects;
create policy "auth_upload" on storage.objects
  for insert with check (
    bucket_id in ('question-audio', 'presets', 'avatars', 'marketplace-files')
    and auth.role() = 'authenticated'
  );

drop policy if exists "own_update" on storage.objects;
create policy "own_update" on storage.objects
  for update using (
    bucket_id in ('question-audio', 'presets', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own_delete" on storage.objects;
create policy "own_delete" on storage.objects
  for delete using (
    bucket_id in ('question-audio', 'presets', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- ЖИЗНЕННЫЙ ЦИКЛ РЕШЁННОГО ВОПРОСА
-- • mark_solution(answer, question) — отметить/снять решение:
--   статус, таймер удаления (7 дней), +25 репутации помощнику
--   (один раз за ответ), уведомление
-- • run_question_lifecycle() — периодический проход (клиент
--   вызывает при старте): удаление просроченных решённых вопросов
--   (содержимое → заглушка purge_summary, файл audio в Storage
--   удаляется, автору — финальное уведомление) и напоминания
--   автору нерешённого вопроса (24 ч и 3 дня после первого ответа)
-- • Вечная статистика: profiles.solutions_count (награды за решения)
--   и profiles.purged_answers_count (ответы, ушедшие в архив)
-- Идемпотентно: можно запускать повторно
-- ============================================================

-- ---------- Колонки ----------
alter table public.questions add column if not exists solved_at timestamptz;
alter table public.questions add column if not exists purge_at timestamptz;
alter table public.questions add column if not exists purged boolean not null default false;
alter table public.questions add column if not exists purge_summary jsonb;
alter table public.questions add column if not exists reminder_24h boolean not null default false;
alter table public.questions add column if not exists reminder_3d boolean not null default false;
alter table public.answers add column if not exists awarded_rep boolean not null default false;
alter table public.profiles add column if not exists solutions_count int not null default 0;
alter table public.profiles add column if not exists purged_answers_count int not null default 0;

-- Индекс для периодического прохода (только неархивные с таймером)
create index if not exists questions_purge_at_idx
  on public.questions (purge_at) where purged = false;

-- ---------- Отметить / снять решение ----------
create or replace function public.mark_solution(p_answer uuid, p_question uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  q_owner uuid;
  q_title text;
  a_owner uuid;
  v_rep constant int := 25; -- синхронно с CONFIG.SOLUTION_REP в js/config.mjs
begin
  select user_id, title into q_owner, q_title
    from public.questions where id = p_question;
  if q_owner is null then
    raise exception 'question % not found', p_question;
  end if;
  if auth.uid() is null or auth.uid() <> q_owner then
    raise exception 'only the question author can mark the solution';
  end if;

  -- Сбрасываем текущую отметку решения
  update public.answers set is_solution = false
   where question_id = p_question and is_solution;

  if p_answer is null then
    -- «Отменить решение»: вопрос снова открыт, таймер удаления снят
    update public.questions
       set status = 'open', solved_at = null, purge_at = null
     where id = p_question;
    return;
  end if;

  select user_id into a_owner
    from public.answers where id = p_answer and question_id = p_question;
  if a_owner is null then
    raise exception 'answer % not found', p_answer;
  end if;

  update public.answers set is_solution = true where id = p_answer;

  -- Таймер удаления ставится при ПЕРВОЙ отметке;
  -- смена лучшего ответа его не сбрасывает
  update public.questions
     set status = 'solved',
         solved_at = coalesce(solved_at, now()),
         purge_at = coalesce(purge_at, now() + interval '7 days')
   where id = p_question;

  -- Репутация и уведомление помощнику (не самоответ, награда — один раз)
  if a_owner <> q_owner then
    update public.answers set awarded_rep = true
     where id = p_answer and awarded_rep = false;
    if found then
      update public.profiles
         set rating = coalesce(rating, 0) + v_rep,
             solutions_count = coalesce(solutions_count, 0) + 1
       where id = a_owner;
      insert into public.notifications (user_id, type, payload)
      values (a_owner, 'solution', jsonb_build_object(
        'by', coalesce((select username from public.profiles where id = auth.uid()), ''),
        'questionTitle', coalesce(q_title, ''),
        'questionId', p_question,
        'rep', v_rep));
    end if;
  end if;
end $$;

-- ---------- Периодический проход: удаление по таймеру + напоминания ----------
create or replace function public.run_question_lifecycle()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  qp record;
  qr record;
  best_id uuid;
  best_name text;
  n_answers int;
  v_qa text[];
  v_ps text[];
begin
  -- 1) Удаление решённых вопросов с истёкшим сроком (→ заглушка)
  for qp in
    select id, user_id, title, solved_at
      from public.questions
     where purged = false and purge_at is not null and purge_at <= now()
  loop
    select a.user_id, p.username into best_id, best_name
      from public.answers a
      left join public.profiles p on p.id = a.user_id
     where a.question_id = qp.id and a.is_solution
     limit 1;
    select count(*) into n_answers from public.answers where question_id = qp.id;

    -- Вечная статистика отвечающих: сколько их ответов ушло в архив
    update public.profiles p
       set purged_answers_count = coalesce(p.purged_answers_count, 0) + c.cnt
      from (select user_id, count(*)::int as cnt
              from public.answers
             where question_id = qp.id
             group by user_id) c
     where p.id = c.user_id;

    -- Пути файлов в Storage: аудио вопроса/ответов и пресеты
    select coalesce(array_agg(pth), '{}') into v_qa from (
      select split_part(a.audio_url, '/question-audio/', 2) as pth
        from public.answers a
       where a.question_id = qp.id and a.audio_url like '%/question-audio/%'
      union all
      select split_part(q.audio_url, '/question-audio/', 2)
        from public.questions q
       where q.id = qp.id and q.audio_url like '%/question-audio/%'
    ) s where pth <> '';
    select coalesce(array_agg(pth), '{}') into v_ps from (
      select split_part(a.preset_url, '/presets/', 2) as pth
        from public.answers a
       where a.question_id = qp.id and a.preset_url like '%/presets/%'
    ) s where pth <> '';

    delete from storage.objects
     where (bucket_id = 'question-audio' and name = any (v_qa))
        or (bucket_id = 'presets' and name = any (v_ps));

    -- Лайки вопроса и его ответов, затем сами ответы (комментарии — каскад)
    delete from public.likes
     where (target_type = 'question' and target_id = qp.id)
        or (target_type = 'answer' and target_id in
            (select id from public.answers where question_id = qp.id));
    delete from public.answers where question_id = qp.id;

    -- Превращаем вопрос в заглушку (избранное и ссылки сохраняются —
    -- ведут на страницу-архив)
    update public.questions
       set purged = true,
           purge_summary = jsonb_build_object(
             'purged_at', now(),
             'solved_at', qp.solved_at,
             'answers_count', n_answers,
             'best_username', best_name,
             'best_user_id', best_id,
             'rep', 25),
           title = '',
           description = null,
           audio_url = null,
           waveform_data = null,
           markers = '[]'::jsonb,
           synth = null,
           category = null,
           likes_count = 0
     where id = qp.id;

    -- Финальное уведомление автору вопроса
    insert into public.notifications (user_id, type, payload)
    values (qp.user_id, 'purge', jsonb_build_object(
      'questionId', qp.id,
      'questionTitle', coalesce(qp.title, ''),
      'answersCount', n_answers,
      'bestUsername', coalesce(best_name, ''),
      'purgedAt', now()));
  end loop;

  -- 2) Напоминания автору нерешённого вопроса с ЧУЖИМИ ответами:
  --    одно через 24 часа после первого ответа, второе — через 3 дня,
  --    затем тишина
  for qr in
    select qq.id, qq.user_id, qq.title, qq.reminder_24h, qq.reminder_3d,
           min(a.created_at) as first_answer
      from public.questions qq
      join public.answers a
        on a.question_id = qq.id and a.user_id <> qq.user_id
     where qq.purged = false
       and qq.status = 'open'
       and (qq.reminder_24h = false or qq.reminder_3d = false)
     group by qq.id, qq.user_id, qq.title, qq.reminder_24h, qq.reminder_3d
  loop
    if qr.reminder_24h = false and now() >= qr.first_answer + interval '24 hours' then
      insert into public.notifications (user_id, type, payload)
      values (qr.user_id, 'reminder', jsonb_build_object(
        'questionId', qr.id, 'questionTitle', coalesce(qr.title, '')));
      update public.questions set reminder_24h = true where id = qr.id;
    end if;
    if qr.reminder_3d = false and now() >= qr.first_answer + interval '3 days' then
      insert into public.notifications (user_id, type, payload)
      values (qr.user_id, 'reminder', jsonb_build_object(
        'questionId', qr.id, 'questionTitle', coalesce(qr.title, '')));
      update public.questions set reminder_3d = true where id = qr.id;
    end if;
  end loop;
end $$;

-- Удаление ответа-решения отменяет решение И таймер удаления вопроса
create or replace function public.answers_delete_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_solution then
    update public.questions
       set status = 'open', solved_at = null, purge_at = null
     where id = old.question_id;
  end if;
  return null;
end $$;

-- Права вызова: только авторизованные (mark_solution дополнительно
-- проверяет, что вызвавший — автор вопроса)
revoke execute on function public.mark_solution(uuid, uuid) from public, anon;
grant execute on function public.mark_solution(uuid, uuid) to authenticated;
revoke execute on function public.run_question_lifecycle() from public, anon;
grant execute on function public.run_question_lifecycle() to authenticated;

-- Решённый вопрос закрыт для новых ответов (форма в UI отключена,
-- триггер страхует на уровне БД)
create or replace function public.answers_no_new_on_solved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.questions
              where id = new.question_id and (status = 'solved' or purged)) then
    raise exception 'question is solved — answers are closed';
  end if;
  return new;
end $$;

drop trigger if exists answers_no_new_on_solved on public.answers;
create trigger answers_no_new_on_solved
before insert on public.answers
for each row execute function public.answers_no_new_on_solved();

-- ==================== ОТЧЁТ ================================
-- В результатах выполнения вы увидите два списка:

select 'таблицы' as what, table_name as name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select 'бакеты' as what, id as name
from storage.buckets
order by id;