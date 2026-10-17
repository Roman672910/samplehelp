# PLAN_IDEAS.md — «💡 Идеи»: предложения пользователей + связь с разработчиком

**Статус: ВЫПОЛНЕН 2026-10-14 (заход 38; решения опроса: видят все /
пишут и голосуют залогиненные; голосование с топ/новые; связь с разработчиком =
публичный ответ в карточке + кнопка ЛС; статусы — полный цикл с уведомлениями).
Журнал: WORKLOG «Сделано», запись 38. Откат: rollbacks/filelist_baseline_2026-10-14_before_ideas.txt.**

## 0. Контекст и мотивация

До запуска нет поведенческой аналитики; окно идей — источник роадмапа от
лояльных пользователей и публичное доказательство живости продукта. Заход
собирается из ГОТОВЫХ узлов, а не параллельной вселенной: петля обратной связи
(заход 36: решение → уведомление автору), механика лайков (голоса), паттерны
карточек/сортировок/модалок ленты, ЛС для личного канала. Новый модуль экрана
`ideas.mjs` (35-й), новая сущность `ideas` + голоса, новый роут `/ideas`,
иконка 💡 в шапке ПОСЛЕ колокольчика.

## 1. Модель данных

### 1.1 SQL (setup.sql / setup_part1.sql идемпотентно; schema.sql — комментарий)
- `public.ideas`: id uuid pk default gen_random_uuid(); author_id uuid
  references auth.users on delete cascade; title text not null + check
  (char_length(title) between 3 and 120); body text not null + check
  (char_length(body) between 10 and 1000); status text not null default 'new'
  + check (status in ('new','in_work','done','rejected')); dev_reply text
  not null default ''; dev_reply_at timestamptz; created_at timestamptz
  default now().
- `public.idea_votes`: idea_id uuid references public.ideas on delete cascade;
  user_id uuid references auth.users on delete cascade; created_at;
  primary key (idea_id, user_id) — один голос на пользователя.
- RLS: ideas_public_read using (true) (витрина открыта и анониму);
  ideas_auth_insert with check (auth.uid() = author_id);
  ideas_author_delete using (author_id = auth.uid());
  ideas_admin_update using (is_admin-подзапрос, как в reports_admin_update);
  ideas_admin_delete using (тот же is_admin-подзапрос);
  idea_votes_public_read using (true); idea_votes_auth_insert with check
  (auth.uid() = user_id); idea_votes_auth_delete using (user_id = auth.uid()).

### 1.2 Демо-слой (урок захода 20: новая коллекция ОБЯЗАНА войти в миграцию)
- `DEMO.ideas` — 4 честных сида из реального бэклога продукта (не пустышка):
  «Паритет чипов подписки во всех списках» (new, 2 голоса), «Квота localStorage
  / экспорт демо-базы» (in_work + dev_reply), «Форма DMCA-жалобы по Этапу 3»
  (done + dev_reply), «Светлая тема» (rejected + dev_reply «не раньше юрлица:
  приоритеты РСЯ/152-ФЗ»). `DEMO.idea_votes` под них.
- `DEMO_DB_VERSION = 15`; `migrateDemo`: carry('ideas') + перенос idea_votes
  с дедупом по составному ключу + чистка «висяков» (голоса за несуществующие
  идеи); пользовательские идеи переживают пересид (тест).
- Слой данных supabase.mjs (демо + реал ветки): `fetchIdeas(sort)` ('top' |
  'new'; топ = голоса desc, created_at desc), `fetchIdeaVotesMine()` (мои
  голоса за экран), `createIdea({title, body})`, `toggleIdeaVote(id)` (голос
  есть → снять, нет → поставить; возвращает новый счётчик), `setIdeaStatus(id,
  status)` (админ; при смене — уведомление автору), `setIdeaReply(id, text)`
  (админ; пустой текст = очистить ответ; при непустом — уведомление автору),
  `deleteIdea(id)` (автор или админ), `fetchDevContact()` — профиль админа
  (is_admin) для кнопки ЛС (реал: select with limit 1; демо: u-demo).

## 2. UI

### 2.1 Шапка (index.html)
- Кнопка 💡 `#btn-ideas` СРАЗУ после колокольчика (перед «?»), `data-help=
  "ideas_btn"`, aria-label «Идеи продукта»; navigate('/ideas'). Бейджа в MVP
  нет (судьбу идей закрывают уведомления).

### 2.2 Экран /ideas (router + main.mjs → ideas.mjs renderIdeas)
- page-head: «💡 Идеи продукта» + сабтайт «Предлагайте, что сделать дальше —
  разработчик читает всё и отвечает публично»; кнопка «✚ Предложить идею»
  (requireAuth; анониму — модалка входа).
- Блок связи с разработчиком (в окне идей, как просил заказчик): карточка
  `.idea-dev` «Личный вопрос, не идея? 💬 Написать разработчику» + подсказка,
  что админ платформы отвечает и здесь, и в ЛС; `data-help="ideas_dev_dm"`;
  клик → requireAuth → navigate('/messages/<dev_id>') (ЛС существуют).
- Sort-tabs: «Топ» / «Новые» (как в ленте).
- Карточка идеи `.idea-card`: заголовок; бейдж статуса (new — никель,
  in_work — медь, done — зелёный, rejected — приглушённый); текст идеи
  (escapeHtml + переносы, без markdown); автор @name + timeAgo; кнопка-голос
  «▲ N» (aria-pressed, анониму — requireAuth); блок «🛠 Ответ разработчика»
  (если dev_reply непустой: текст + timeAgo); свои действия: автору — «🗑
  Удалить»; админу — кнопки смены статуса («→ В работу» / «✓ Готово» /
  «✗ Отклонено», по контексту текущего) и инлайн-поле ответа + «Ответить»
  (`data-help="idea_admin"` на блоке контролов).

### 2.3 Модалка «Предложить идею» (utils.openModal)
- Поля: заголовок (3–120, инлайн-ошибка после blur как в контактах), описание
  (10–1000); «Отправить» → createIdea → тост + карточка встаёт в список;
  дублей не дедупим (бэклог: слияние).

### 2.4 Уведомления (петля захода 36, но с позитивными исходами)
- `idea_status`: payload {status, ideaTitle}; тексты-факты по статусам:
  «Ваша идея «…» — принята в работу» / «— реализована, смотрите /ideas» /
  «— отклонена: спасибо, но сейчас не потянем» (rejected-текст честный, без
  имитации заботы); иконка 💡 в TYPE_ICONS; клик → navigate('/ideas').
- `idea_reply`: payload {ideaTitle} — «Разработчик ответил на вашу идею «…»»;
  клик → '/ideas'.
- Уведомляется ТОЛЬКО автор идеи; админ-сменщик — нет.

## 3. i18n (ru-only) и справка

- ~35 новых ключей: ideas.* (title, subtitle, suggest, form_title, form_
  title_ph, form_body_ph, send, sent, invalid_title, invalid_body, empty,
  tab_top, tab_new, vote, status_new, status_in_work, status_done, status_
  rejected, dev_reply, dev_dm_title, dev_dm_hint, dev_dm_btn, delete_own,
  admin_statuses, admin_reply_ph, admin_reply_btn, admin_reply_cleared,
  deleted) + notifications.type_idea_status_new/in_work/done/rejected +
  notifications.type_idea_reply + helpPage.sections.ideas (9-я секция /help:
  зачем окно, как голосовать, где ответ разработчика, как написать лично).
- Каталог справки +5: ideas_btn, idea_form, idea_vote, idea_dev_dm,
  idea_admin → 110 пунктов.
- test_help: секций 8 → 9 (ассерт обновить).

## 4. Тесты (ожидалка)

- Новый `test_ideas.mjs` (~30 проверок): аноним читает список и сиды; анониму
  «Предложить»/голос → вход; создание (валидации 3–120/10–1000); голос toggle
  и единственность; сортировки топ/новые; админ: статус → уведомление автору
  (и его отсутствие у посторонних), ответ → уведомление, очистка ответа;
  автор удаляет свою, админ удаляет любую; fetchDevContact = админ; пересид
  v14→v15 переносит пользовательскую идею и голоса (урок захода 20).
- test_dom: порядок иконок шапки (колокольчик → 💡 → «?»); test_help: 9 секций
  + текст новой; check_keys/check_help_catalog по конвенции.
- Итог-ожидалка: 35 модулей, ~512 ключей, каталог 110, 34 тест-файла.

## 5. Регламент и риски

- Все новые интерактивные элементы — с data-help и help.items (конвенция).
- Экранирование везде; t() только литералами (тернарники разводить).
- DEMO_DB_VERSION 15 + carry идей/голосов в migrateDemo (иначе пересид съест
  пользовательские идеи — баг захода 20).
- Rejected-идеи НЕ скрываем (прозрачность судьбы); уведомление об отклонении
  честное.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_ideas.txt`.

## 6. Бэклог (не в заход 38)

Комментарии сообщества к идеям; теги; дедуп/слияние дубликатов; роадмап-страница
«готово» отдельным списком; жалобы на идеи (спам-идеи админ удаляет напрямую);
редактирование своей идеи (сейчас — только удаление); бейдж на 💡 по своим
статусам (пока достаточно уведомлений).
