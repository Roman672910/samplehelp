# PLAN_ROLES_LOGIN.md — роли и вход: владелец-админ по OWNER_EMAIL, демо-тумблер ролей, строка роли в меню

**Статус: ВЫПОЛНЕН 2026-10-14 (заход 43; решения опроса: бутстрап админа =
OWNER_EMAIL; демо-переключатель = тумблер в подвале; строка роли в меню).
Журнал: WORKLOG «Сделано», запись 43. Откат: rollbacks/filelist_baseline_2026-10-14_before_roles.txt.**

## 0. Контекст (факты на момент спеки)

- Демо: любой email/пароль → сессия u-demo, который в сидах is_admin:true —
  «админом» в демо является каждый вошедший, опыт обычного пользователя
  посмотреть нельзя.
- Бой: Supabase Auth (email+пароль / OAuth) + онбординг; is_admin=false по
  умолчанию; админ — только ручной SQL в Dashboard; клиентский самоповышен
  закрыт column-грантами (заход 36).
- Явных признаков «кто я» нет: роль угадывается по пункту «🛡 Модерация».

## 1. Бой: админ = аккаунт с почтой владельца (OWNER_EMAIL)

Единственный автоматический путь в админы — серверный, по почте из настройки
в БД. Клиентских путей нет и не появляется.

- Таблица-настройка (правится без пересоздания функции):
  `create table if not exists public.owner_config (id int primary key default 1
  check (id = 1), owner_email text not null default '');`
  + `insert … values ('') on conflict do nothing`.
  Владелец после развёртывания вписывает свою почту:
  `update public.owner_config set owner_email = 'you@domain.ru';`
- BEFORE INSERT триггер на profiles (SECURITY DEFINER, search_path=public):
  если email нового пользователя (из auth.users) совпадает с owner_email
  (регистронезависимо) — NEW.is_admin := true. Иначе флаг не трогается.
  Пустой owner_email = бутстрап выключен (только ручной SQL).
- Команда «применить сейчас» для случая, когда профиль владельца УЖЕ создан
  до вписывания почты (идемпотентно, в SETUP.md):
  `update public.profiles set is_admin = true where id = (select id from
  auth.users u where lower(u.email) = (select lower(owner_email) from
  public.owner_config where owner_email <> ''));`
- Дополнительные модераторы позже — ручным SQL (раздел SETUP.md уже есть).
- SETUP.md: шаг в Части 2/3 — вписать owner_email ДО первого входа; чек-лист
  проверки: вход под почтой владельца → строка роли и «🛡 Модерация»; вход под
  другой почтой → обычного пользователя; попытка самоповышения → 42501 (заход 36).

## 2. Демо: тумблер ролей в подвале (только IS_DEMO)

- Рядом с #demo-indicator: кнопка-тумблер `#demo-role-switch`
  («Роль: разработчик» / «Роль: пользователь»); в бою не рендерится вовсе.
- supabase.mjs: `export function setDemoRole(isAdmin)` (демо-only): правит
  is_admin у строки u-demo в DEMO.profiles и в объекте сессии,
  localStorage-сессия + persistDemo, invalidateProfileCache('u-demo');
  возвращает обновлённого user; в бою — no-op false.
- main.mjs: бинд тумблера: setDemoRole → setState({user}) → toast
  (demo.role_toast_dev/user) → handleRoute() (текущий экран перерисовывается:
  меню/модерация/админ-контролы реагируют сразу).
- data-help="demo_role" + help.items.demo_role (каталог +1 → 112).
- i18n: demo.role_switch, demo.role_dev, demo.role_user, demo.role_toast_dev,
  demo.role_toast_user (+5 листьев).
- DEMO_DB_VERSION не повышается (флаг сессионный, схема и сиды не меняются;
  migrateDemo is_admin не переносит — поведение прежнее).

## 3. Строка роли в меню аватара (бой + демо)

- В auth.mjs над пунктом «🛡 Модерация» для is_admin: нема активная строка
  `🛡 Вы админ платформы` (i18n auth.role_admin; class .role-note — приглушённая,
  не кнопка). Неинтерактивна → data-help не нужен.
- Обычный пользователь не видит ничего нового (отсутствие строки = норма).

## 4. Обычные пользователи

Поток входа не меняется (email+пароль / OAuth + онбординг 3 шага; демо —
мгновенный вход любым email). В SETUP.md Часть 3 — абзац «две роли»: путь
владельца (owner_email → админ) и путь пользователя (регистрация → обычный
профиль), что каждой роли видно/не видно.

## 5. Тесты (ожидалка)

- test_user_menu (или test_auth_i18n) +секция: строка роли у админа есть /
  у обычного нет; setDemoRole(true/false) меняет is_admin сессии и строку
  профиля в демо-базе, повторный вызов идемпотентен; в бою no-op (ветка не
  исполняется в jsdom-демо — ассерт только демо).
- test_dom + статика: #demo-role-switch рендерится только при IS_DEMO
  (ассерт по коду main.mjs: бинд под условием IS_DEMO) + CSS .role-note.
- test_moderation: guard /moderation после setDemoRole(false) разворачивает
  на главную (роль реально снялась).
- SQL-триггер в jsdom не проверяется: чек-лист в SETUP.md (владелец → админ,
  чужой email → нет, 42501 на самоповышение).
- Итог-ожидалка: 35 модулей, ~512 ключей, каталог 112, 34 тест-файла.

## 6. Регламент

- Откат: `rollbacks/filelist_baseline_2026-10-14_before_roles.txt`.
- Конвенции: новые интерактивы с data-help; t() литералами; экранирование.
- Бэклог: несколько owner-почт (список), аудит входов админа, 2FA владельца
  (рекомендация текстом в SETUP.md без кода).
