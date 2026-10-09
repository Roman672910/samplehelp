-- ============================================================
-- SampleHelp — бакеты Storage + политики доступа
-- Выполнить в SQL Editor ПОСЛЕ schema.sql
-- Скрипт идемпотентен: можно запускать повторно — политики
-- пересоздаются, бакеты не дублируются.
-- ============================================================

-- Бакеты: аудио вопросов, пресеты и аватары — публичные;
-- файлы маркетплейса — приватные (доступ через RLS после активации монетизации)
insert into storage.buckets (id, name, public) values
  ('question-audio', 'question-audio', true),
  ('presets', 'presets', true),
  ('avatars', 'avatars', true),
  ('marketplace-files', 'marketplace-files', false)
on conflict (id) do nothing;

-- Пересоздание политик (drop if exists → create)
drop policy if exists "public_read_media" on storage.objects;
drop policy if exists "auth_upload" on storage.objects;
drop policy if exists "own_update" on storage.objects;
drop policy if exists "own_delete" on storage.objects;

-- Публичное чтение загруженного контента
create policy "public_read_media" on storage.objects
  for select using (bucket_id in ('question-audio', 'presets', 'avatars'));

-- Загрузка — только авторизованными пользователями
create policy "auth_upload" on storage.objects
  for insert with check (
    bucket_id in ('question-audio', 'presets', 'avatars', 'marketplace-files')
    and auth.role() = 'authenticated'
  );

-- Обновление/удаление — только своих файлов (первый сегмент пути = user id)
create policy "own_update" on storage.objects
  for update using (
    bucket_id in ('question-audio', 'presets', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own_delete" on storage.objects
  for delete using (
    bucket_id in ('question-audio', 'presets', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Проверка: какие бакеты в итоге существуют
select id, public from storage.buckets order by id;