-- ============================================================
-- backend/src/schema.sql — схема SampleHelp без Supabase (Фаза A, заход 48).
-- Порт supabase/setup.sql + setup_part2.sql: таблицы и триггеры переносятся
-- почти как есть; УБРАНЫ: RLS-политики (вместо них backend/src/rules.js),
-- auth.users (своя таблица users), Realtime publication и Storage-политики
-- (Socket.IO в Фазе B, SSD-хранилище в storage.js).
-- Применяется идемпотентно: node src/migrate.js
-- ============================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------- Аутентификация (своя, JWT+bcrypt) ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists users_email_lower_idx on users (lower(email));

create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id);

create table if not exists reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------- Настройка владельца (порт owner_config, заход 43) ----------
create table if not exists owner_config (
  id int primary key default 1 check (id = 1),
  owner_email text not null default ''
);
insert into owner_config (id, owner_email) values (1, '')
  on conflict (id) do nothing;

-- ---------- Профили ----------
create table if not exists profiles (
  id uuid primary key references users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text,
  links jsonb not null default '[]',
  rating int not null default 0,
  solutions_count int not null default 0,
  purged_answers_count int not null default 0,
  cover_style text not null default 'depth',
  open_to_collab boolean default false,
  contact jsonb not null default '[]',
  contact_consent boolean not null default false,
  donate_methods jsonb not null default '[]',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_cover_style_check check (cover_style in ('depth','mirror','spectrum','wave','studio'))
);

-- Бутстрап админа по почте владельца (порт триггера захода 43)
create or replace function profiles_owner_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from owner_config oc
    where oc.owner_email <> ''
      and exists (select 1 from users u where u.id = new.id and lower(u.email) = lower(oc.owner_email))
  ) then
    new.is_admin := true;
  end if;
  return new;
end $$;
drop trigger if exists profiles_owner_admin on profiles;
create trigger profiles_owner_admin
  before insert on profiles
  for each row execute function profiles_owner_admin();

-- ---------- Контент ----------
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text, -- nullable: purge-заглушка обнуляет описание (как в setup.sql)
  audio_url text,
  audio_kind text,
  waveform_data jsonb,
  markers jsonb not null default '[]',
  synth text,
  category text,
  likes_count int not null default 0,
  answers_count int not null default 0,
  status text not null default 'open' check (status in ('open','solved')),
  solved_at timestamptz,
  purge_at timestamptz,
  reminder_24h boolean not null default false,
  reminder_3d boolean not null default false,
  purged boolean not null default false,
  purge_summary jsonb,
  created_at timestamptz not null default now()
);
create index if not exists questions_created_idx on questions (created_at desc);
create index if not exists questions_user_idx on questions (user_id);
-- для уже созданных БД (идемпотентность migrate.js)
alter table questions add column if not exists reminder_24h boolean not null default false;
alter table questions add column if not exists reminder_3d boolean not null default false;
alter table questions alter column description drop not null;

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  content text not null default '',
  audio_url text,
  audio_kind text,
  waveform_data jsonb,
  markers jsonb not null default '[]',
  links jsonb not null default '[]',
  preset_url text,
  preset_name text,
  sound_type text,
  difficulty text,
  tags jsonb not null default '[]',
  is_solution boolean not null default false,
  awarded_rep boolean not null default false,
  likes_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists answers_question_idx on answers (question_id, created_at);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_answer_idx on comments (answer_id, created_at);

create table if not exists likes (
  user_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('question','answer')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create table if not exists favorites (
  user_id uuid not null references users(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- ---------- ЛС ----------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  content text not null default '',
  ref jsonb,
  read boolean not null default false,
  reactions jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists messages_pair_idx on messages (sender_id, recipient_id, created_at desc);

-- ---------- Уведомления / достижения / подписки ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create table if not exists achievements (
  user_id uuid not null references users(id) on delete cascade,
  achievement_type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, achievement_type)
);

create table if not exists subscriptions (
  user_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('author','tag')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- ---------- Справочники и словари пользователя ----------
create table if not exists synth_catalog (
  name text primary key,
  added_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists daw_catalog (
  name text primary key,
  created_at timestamptz not null default now()
);
create table if not exists user_software (
  user_id uuid not null references users(id) on delete cascade,
  software_name text not null,
  primary key (user_id, software_name)
);
create table if not exists user_arsenal (
  user_id uuid not null references users(id) on delete cascade,
  item_name text not null,
  primary key (user_id, item_name)
);

-- ---------- Донаты (модель A: деньги мимо платформы) ----------
create table if not exists donations (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references users(id) on delete cascade,
  donor_id uuid references users(id) on delete cascade,
  amount int not null check (amount >= 0),
  currency text not null default 'RUB',
  message text not null default '',
  kind text not null default 'thanks' check (kind in ('thanks','paid')),
  status text not null default 'done' check (status in ('intent','done')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists donations_recipient_idx on donations (recipient_user_id, created_at desc);

-- ---------- Жалобы и модерация ----------
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('question','answer','comment','profile')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','offense','copyright','fraud','other')),
  note text not null default '',
  status text not null default 'new' check (status in ('new','dismissed','actioned')),
  moderator_note text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, target_type, target_id)
);

-- ---------- Идеи (заход 38) ----------
create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 10 and 1000),
  status text not null default 'new' check (status in ('new','in_work','done','rejected')),
  dev_reply text not null default '',
  dev_reply_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists idea_votes (
  idea_id uuid not null references ideas(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);

-- ============================================================
-- Триггеры-счётчики (порт setup_part2.sql без изменений семантики)
-- ============================================================
create or replace function bump_like_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ttype text := coalesce(new.target_type, old.target_type);
  tid uuid := coalesce(new.target_id, old.target_id);
begin
  if ttype = 'question' then
    update questions
       set likes_count = (select count(*) from likes
                          where target_type = 'question' and target_id = tid)
     where id = tid;
  elsif ttype = 'answer' then
    update answers
       set likes_count = (select count(*) from likes
                          where target_type = 'answer' and target_id = tid)
     where id = tid;
  end if;
  return null;
end $$;

create or replace function bump_answers_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  qid uuid := coalesce(new.question_id, old.question_id);
begin
  update questions
     set answers_count = (select count(*) from answers where question_id = qid)
   where id = qid;
  return null;
end $$;

drop trigger if exists likes_bump on likes;
create trigger likes_bump
after insert or delete on likes
for each row execute function bump_like_counts();

drop trigger if exists answers_bump on answers;
create trigger answers_bump
after insert or delete on answers
for each row execute function bump_answers_count();

-- Удаление ответа-решения возвращает вопросу статус «открыт»
create or replace function answers_delete_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_solution then
    update questions
       set status = 'open', solved_at = null, purge_at = null
     where id = old.question_id;
  end if;
  return null;
end $$;

drop trigger if exists answers_delete_cleanup on answers;
create trigger answers_delete_cleanup
after delete on answers
for each row execute function answers_delete_cleanup();

-- Решённый/удалённый вопрос закрыт для новых ответов (страховка на уровне БД)
create or replace function answers_no_new_on_solved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from questions
              where id = new.question_id and (status = 'solved' or purged)) then
    raise exception 'question is solved — answers are closed';
  end if;
  return new;
end $$;

drop trigger if exists answers_no_new_on_solved on answers;
create trigger answers_no_new_on_solved
before insert on answers
for each row execute function answers_no_new_on_solved();

-- Фаза C (заход 48): edited_at — в setup.sql Supabase колонки были, UI рисует
-- метку «(изменено)» у вопросов/ответов/комментариев/сообщений
alter table questions add column if not exists edited_at timestamptz;
alter table answers add column if not exists edited_at timestamptz;
alter table comments add column if not exists edited_at timestamptz;
alter table messages add column if not exists edited_at timestamptz;
-- Фаза C: статус избранного («готовлюсь ответить» / «готово») — как в setup.sql
alter table favorites add column if not exists status text not null default 'preparing';

-- ============================================================
-- Сиды справочников (Фаза C): стартовый набор = демо-сидам фронта,
-- чтобы онбординг/автокомплит не были пустыми на свежей БД. Идемпотентно.
-- ============================================================
insert into synth_catalog (name) values
  ('Serum'), ('Phase Plant'), ('Vital'), ('Massive X'), ('Diva'),
  ('Omnisphere'), ('Sylenth1'), ('Pigments')
on conflict (name) do nothing;

insert into daw_catalog (name) values
  ('FL Studio'), ('Ableton Live'), ('Logic Pro'), ('Reaper'), ('Cubase'),
  ('Studio One'), ('Bitwig Studio'), ('Pro Tools'), ('GarageBand'), ('Reason')
on conflict (name) do nothing;
