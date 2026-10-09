-- ============================================================
-- SampleHelp — ЧАСТЬ 2: триггеры счётчиков, Realtime, Storage
-- Запускать ПОСЛЕ setup_part1.sql (SQL Editor → New query → Run)
-- ============================================================

-- ==================== СЧЁТЧИКИ (ТРИГГЕРЫ) ==================
-- Лайки и число ответов пересчитываются на стороне БД.
-- Клиенту не нужно править чужие строки (иначе это блокирует RLS).
--
-- Примечание о формате public.answers.links (колонка определена в части 1):
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

-- Маркеры «вот этот момент» в аудио ответов: [{ time: сек, note }] (не больше 2,
-- лимит CONFIG.MAX_MARKERS на клиенте)
alter table public.answers add column if not exists markers jsonb default '[]'::jsonb;
-- Отметки момента в комментариях убраны из продукта — удаляем колонку, если она уже создавалась
alter table public.comments drop column if exists marker_time;
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