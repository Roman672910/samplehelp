# План: «Контакты + Оплата» вместо «Навыков»

Дата: 2026-10-11. Статус: **ВЫПОЛНЕН ЦЕЛИКОМ** — заход A выполнен и поправлен
заказчиком (§0.2), **заход B (кликабельные #теги) выполнен 2026-10-13**:
шапка профиля возвращена к прежнему виду, контакты открываются модалкой по
бейджу-кнопке «🤝 Открыт к коллаборациям», ряд «💳 Оплата» и флаг
`payment_markers` удалены; #теги ответов и тег синтезатора в ленте —
чипы-кнопки подписки (`tagSubChipHtml`, capture-делегирование,
`new_question_tag`-уведомления подписчикам — см. §4.5 и `WORKLOG.md`).
Проект зелёный: 33 модуля, 426 ключей, 95 пунктов
справки, 31 тест (`test_tag_subscribe.mjs` — 43 проверки), `DEMO_DB_VERSION = 10`.

> ⚠️ **Устарело (2026-10-11, следующий заход):** разделы про способы приёма
> ниже описывают 8 видов (`MAX_METHODS = 6`, крипта, «Перейти» по ссылкам,
> «Показать реквизиты»). Заказчик сократил их до **двух — СБП и банковская
> карта**; правила вынесены в `public/js/donate.mjs`, кнопка ☕ и модалка
> называются «Поддержать автора». Актуальная спека —
> `PLAN_SUPPORT_PERSIST_NAV.md`, реализация описана в `WORKLOG.md`.

**Заход B ВЫПОЛНЕН (2026-10-13)** — кликабельные теги (§4.5) + чистка
`subscriptions.mjs` (мёртвые `tagSubscribeButtonHtml`/`isTagSubscribed` удалены,
вместо них чип-API) + тест `test_tag_subscribe.mjs`; детали — в `WORKLOG.md` →
«✅ Сделано» (верхняя запись).

Заменяет фичу «Навыки» (`user_skills`, `profiles.skills`) на два полезных блока:
**контактную информацию** и **платёжную информацию**.

## 0.1 Поправки, принятые при реализации (согласованы 2026-10-11)

| # | Было в плане | Стало | Почему |
|---|--------------|-------|--------|
| а | `visibility`: `all` / `members` / `hidden` + селектор в настройках | Поле в схеме осталось (`members` \| `hidden`), **селектора в UI нет** — контакты всегда только для зарегистрированных; `normalizeContacts()` ужесточает `all` и мусор до `members` | Решение №3 и так звучит как «только зарегистрированным»; вариант «Всем» открывал телефон/e-mail парсерам в один клик и обходил маску. Меньше UI, меньше ключей, меньше веток в тестах |
| б | 8 типов контакта (+`whatsapp`) | **7 типов**: telegram, email, phone, discord, website, vk, other | Для аудитории RU WhatsApp мёртв, всё прочее покрывает `other` |
| в | «Возможность пожаловаться на профиль уже есть» | **Не было** — добавлено: `reports.target_type += 'profile'`, `reports.reason += 'fraud'`, кнопка ⚑ в шапке чужого профиля, у модератора «✓ Разобрано» вместо «Удалить контент», защита от жалобы на себя | Ряд «💳 Оплата» без кнопки жалобы — дыра: показываем реквизиты, а пожаловаться на мошенника некуда |
| г | Онбординг — в заходе B | Перенесён в **заход A** | Шаг 3 онбординга писал `skills`; оставить его было нельзя — после удаления навыков онбординг бы сломался |
| д | Помощь: 84 → 87 | Факт: **84 → 94** | Новые интерактивные элементы (кнопки «Показать», «Написать», «⚙️ Изменить», «Показать реквизиты», ⚑ на профиле, оба тумблера, «✓ Разобрано») по конвенции проекта обязаны иметь `help.items.*` |
| е | Лимит способов приёма | `MAX_METHODS = 6` в `support.mjs` + фильтр `manualKind` из сохраняемого патча | Раньше лимита не было, а служебный флаг уезжал в jsonb |

## 0.2 Поправка заказчика после захода A (2026-10-11, тот же день)

> Формулировка: «лучше оставить как было до этого, но убрать навыки, и если открыт
> к коллаборациям — просто сделать кнопку кликабельной».

| # | Было по плану (§4.1–§4.2) | Стало | Почему |
|---|---------------------------|-------|--------|
| ж | В шапке два новых ряда: «📇 Контакты» и «💳 Оплата» (4 полосы) | **Ряды убраны.** Шапка как прежде: `🎛️ DAW` + `🧰 Арсенал` | Шапка перегружалась «анкетой»; контакты и реквизиты — не характеристика, а действие «напиши мне» |
| з | Бейдж `🤝 Открыт к коллаборациям` — декоративный `<span>` | **Кнопка** `#btn-collab` → модалка «Как связаться» (`openContactsModal`) | Бейдж обещает «мне можно писать» — теперь это правда; данные захода A не пропали |
| и | Ряд «💳 Оплата» с маркерами + тумблер `payment_markers` + колонка в схеме | **Удалено полностью** (колонка снимается `drop column if exists`), вход в реквизиты — кнопка ☕ | Дублировало модалку «Оплата и поддержка»; лишний флаг и лишний пункт настроек |
| к | Видимость: `contact_consent` + залогинен | Видимость: **`open_to_collab` И `contact_consent`** + залогинен (`canSeeContact`) | Бейдж стал единственной точкой входа: нет бейджа — показывать негде и незачем |
| л | Онбординг писал `contact` + `contact_consent` | + галочка `#ob-collab` → `open_to_collab` | Иначе контакт, записанный в онбординге, не увидел бы никто |

Сохранено из захода A без изменений: `contacts.mjs` (типы, валидация, маски,
`normalizeContacts`, `canSeeContact`, редактор), колонки `contact` /
`contact_consent`, шаг 3 онбординга, жалоба `fraud` на профиль, крипто-способ
оплаты, `MAX_CONTACTS` / `MAX_METHODS = 6`.

---

## 0. Зафиксированные решения (выбор заказчика)

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Что такое «платёжная информация» | **Маркеры в шапке + реквизиты по кнопке.** Публично видно только *какие* способы принимает человек («СБП · Boosty · USDT»), сами номера/карты — по кнопке «Показать реквизиты» (существующая модалка поддержки). Донаты переосмысляются как «оплата». |
| 2 | Как хранить контакты | **Отдельный блок «Контакты»** (`profiles.contact`): Telegram, e-mail, телефон, Discord, сайт. Блок «Ссылки» остаётся про портфолио (где слушать/смотреть). |
| 3 | Кому показывать | **Только зарегистрированным + маска с кнопкой «Показать».** Анонимам контакты не видны вовсе; e-mail и телефон маскируются до раскрытия; при сохранении — чекбокс согласия на публичный показ. |
| 4 | Онбординг и теги | **Шаг 3 онбординга → «Как с вами связаться?»** (один контакт, можно пропустить). **Подписка на тег переезжает на теги ответов/вопросов** — кликабельный тег в любой карточке, для всех залогиненных. |

---

## 1. Почему навыки убираем без сожаления

Навыки сейчас — это:

- строка `🏷️ Навыки` в шапке профиля (`profile.mjs:293-298`);
- чипсы-редактор в настройках (`profile.mjs:745-746`, `986-1012`);
- шаг 3 онбординга (`auth.mjs:408-416`, `501-503`);
- таблица `user_skills` + 2 RLS-политики в `schema.sql`, `setup.sql`, `setup_part1.sql`;
- демо-словарь `DEMO.skills`, `DEMO_PERSIST_KEYS`, `migrateDemo`, get/updateProfile в обоих режимах (`supabase.mjs:216, 329, 400, 1710, 1731-1752, 1778-1795`);
- 4 ключа ru.json + `help.items.set_skills`;
- проверка чипсов в `tmp_tests/test_settings_autosave.mjs:148-156`.

Единственная функция сверх отображения — **клик по чипсу = подписка на тег**, и она
срабатывает только при `editable` (`profile.mjs:436-444`), то есть **подписаться
можно лишь на свой собственный навык**. Кнопка `renderTagSubscribeButton`
(`subscriptions.mjs`) не вызывается нигде — мёртвый код. Поиска и фильтрации по
навыкам нет. Плюс навыки дублируют `🎛️ DAW` + `🧰 Арсенал` + bio и не
нормализованы («синтез» / «Synth» / «sound design» = три несвязанных тега).

→ Удаляем целиком, а подписку на теги **чиним**, перенося точку входа на теги
ответов (`answers.tags text[]`, рендерятся в `question.mjs:660`) и на тег вопроса
(`questions.synth`). Уведомление `new_question_tag` и сайдбар-блок «Теги»
наконец получают смысл.

---

## 2. Модель данных

### 2.1 Новое в `profiles`

```sql
alter table public.profiles
  add column if not exists contact jsonb default '[]'::jsonb,        -- [{ kind, value, label?, visibility }]
  add column if not exists contact_consent boolean default false,    -- согласие на показ (152-ФЗ)
  add column if not exists payment_markers boolean default true;     -- показывать маркеры способов оплаты в шапке
```

Формат записи контакта:

```jsonc
{
  "kind": "telegram",        // telegram | email | phone | discord | website | vk | whatsapp | other
  "value": "@annasynth",     // ≤ 200 символов
  "label": "по работе",      // ≤ 40 символов, необязательно
  "visibility": "members"    // all | members | hidden, по умолчанию members
}
```

Правила:

- **Лимит: 6 контактов** и **6 способов оплаты** (сейчас у `donate_methods` лимита нет — добавляем).
- `visibility = all` — показывать всем, включая анонимов (имеет смысл для Telegram/сайта).
- `contact_consent = false` → контакты не видны никому, кроме владельца (в настройках — с предупреждением).
- `value` для `website` — только `http(s):` (переиспользуем `isValidLinkUrl` из `links.mjs`; `javascript:` и прочее отклоняем).

### 2.2 Существующее, что используем как есть

`profiles.donate_methods jsonb` — `[{ kind, value, label }]`,
`DONATE_KINDS = ['sbp','card','yoomoney','boosty','donationalerts','telegram','other']`.

Изменения:

- **+ новый тип `crypto`** (USDT TRC-20 / BTC / TON — сейчас крипта падает в безликий `other`);
- `detectDonateKind` дополнить: `TRC20`/`T…`-адреса, `ton.`, `btc`, `usdt` → `crypto`;
- заголовки/подписи: «Поддержка мне» → **«Оплата и поддержка»**, модалка «Поддержать участника» → «Оплата и поддержка» (дисклеймер усиливаем, см. §6);
- в шапке профиля — **только названия способов**, значения — через модалку.

### 2.3 Удаляем

```sql
drop policy if exists "skills_own" on public.user_skills;
drop policy if exists "skills_public_read" on public.user_skills;
drop table if exists public.user_skills cascade;
```

`setup.sql` идемпотентен, поэтому `drop … if exists` безопасен для уже развёрнутых баз.
Правки вносим в **три** файла: `supabase/setup.sql`, `supabase/setup_part1.sql`,
`supabase/schema.sql` (справочная копия). В `SETUP.md` — строка в списке «что добавляет
новая версия».

### 2.4 Демо-режим

- `DEMO_DB_VERSION: 6 → 7` (v7: контакты и оплата вместо навыков);
- `DEMO.skills` → удалить; сиды контактов в `DEMO.profiles` (поля `contact`, `contact_consent`, `payment_markers`);
- `DEMO_MIGRATE_PROFILE_FIELDS` += `contact`, `contact_consent`, `payment_markers` (переживут пересид);
- `DEMO_PERSIST_KEYS` — `skills` убрать;
- `migrateDemo()` — цикл `['software','skills','arsenal']` → `['software','arsenal']`;
- ~~`USER_EDITABLE_FIELDS` += …~~ — такого списка в коде нет (в демо-режиме
  `updateProfile` делает `Object.assign` целиком), править нечего;
- `getProfile`/`updateProfile`: убрать ветки `user_skills`, добавить `contact` (в обоих режимах — демо и Supabase).

Примеры сидов:

| Пользователь | Контакты | Оплата |
|---|---|---|
| `u-anna` AnnaSynth | Telegram `@annasynth` (all), e-mail `anna@nullsea.ru` (members) | СБП, ЮMoney, Boosty |
| `u-max` MaxWavetable | Telegram `@maxwavetable` (all), телефон `+7 911 222-33-44` (members) | СБП, USDT TRC-20 |
| `u-lena` LenaFX | Discord `lenafx` (members), сайт `https://lenafx.ru` (all) | Boosty |
| `u-demo` | Telegram `@samplehelp_demo` (members) | — |

---

## 3. Видимость и маскирование (ядро задачи)

Новый модуль **`public/js/contacts.mjs`** (32-й модуль, `npm run check` → 32).

```js
export const CONTACT_KINDS = ['telegram','email','phone','discord','website','vk','whatsapp','other'];
export const MAX_CONTACTS = 6;

export function detectContactKind(value)   // @user / t.me → telegram; @ → e-mail; +7… → phone; discord.gg|user#1234 → discord; http(s) → website|vk|whatsapp
export function validateContact(c)         // → { ok, errorKey } : формат, длина, http(s)-only, дубли
export function normalizeContacts(list)    // чистка/приведение из БД (старые/кривые записи → отбрасываем)
export function needsMask(kind)            // true только для email и phone
export function maskEmail(v)               // anna@nullsea.ru → a•••@nullsea.ru
export function maskPhone(v)               // +7 911 222-33-44 → +7 9•• •••-••-44
export function maskValue(kind, v)
export function canSeeContact({ viewer, profile, contact })  // матрица ниже → {show, masked, owner}
export function contactHref(c)             // mailto: / tel: / t.me / vk.com / http(s) — только безопасные
export function contactChipHtml(c, ctx)    // чип: иконка + значение/маска + «Показать»/«⧉»/«↗»
export function contactsRowHtml({ profile, viewer })   // ряд «📇 Контакты» для шапки
export function paymentRowHtml({ profile, viewer, methods }) // ряд «💳 Оплата» (только маркеры)
export function bindContactsBlock(root, ctx) // делегирование «Показать» / «Скопировать» / «Написать»
export function copyContactValue(v)        // clipboard → execCommand → тост со значением
export function contactKindOptions(sel)  // опции <select> типов
export function contactEditorRowHtml(c, i) // строка редактора в настройках (сетка .donate-row)
```

Факт: `whatsapp` в `CONTACT_KINDS` нет (поправка б), `MAX_VALUE_LEN = 200`,
`MAX_LABEL_LEN = 40`, `CONTACT_ICONS` — эмодзи (✈️ ✉️ 📞 🎧 🌐 🔷 🔗).

Матрица `canSeeContact`:

| Кто смотрит | `visibility: all` | `visibility: members` | `visibility: hidden` |
|---|---|---|---|
| Владелец | видит значение | видит значение | видит значение (+ пометка «скрыт») |
| Аноним | видит значение | **не видит контакт** | не видит |
| Участник | видит значение | видит (e-mail/телефон — **маска** до клика «Показать») | не видит |
| Любой, при `contact_consent = false` | не видит (кроме владельца) | не видит | не видит |

Дополнительно:

- «Показать» для анонима → `requireAuth()` (модалка входа), не раскрытие;
- раскрытие — локальное (`revealed` в замыкании блока), в DOM значение лежит в `data-full` **только для залогиненных**, для анонимов не рендерится вообще;
- «Скопировать» — через общий `copyValue`-паттерн из `support.mjs` (с фолбэком на `textarea` для небезопасного контекста);
- «Написать» — открывает существующий диалог `messages.mjs` (💬), если контакт = Telegram/сайт — ведёт наружу через `externalHref()` с `rel="noopener noreferrer"`.

> ⚠️ **Честное ограничение.** Сейчас строку профиля целиком отдаёт RLS
> (`profiles_public_read: using (true)`), поэтому «скрыто от анонимов» и маска —
> защита **клиентская**: от случайного взгляда и наивных парсеров, но не от
> человека, открывшего DevTools или сырой ответ PostgREST. Полноценное решение —
> на Этапе 3 (боевой режим): вью `profiles_public` без `contact` + RPC
> `reveal_contact(profile_id, kind)` с проверкой `auth.uid()`, логированием и
> rate-limit. Записываем в WORKLOG → «Открытые вопросы», чтобы не потерять.

---

## 4. Интерфейс

### 4.1 Шапка профиля (было → стало)

> ⚠️ **Устарело (§0.2):** ряды «Контакты» и «Оплата» из шапки убраны тем же днём.
> Фактический результат — ниже.

```
БЫЛО                                   СТАЛО (факт после поправки §0.2)
🎛️ DAW      [Ableton][Serum]…          🎛️ DAW      [Ableton][Serum]…      (без изменений)
🧰 Арсенал  [tag][tag]                 🧰 Арсенал  [tag][tag]             (без изменений)
🏷️ Навыки   [tag][tag]   ← удалить     (строка удалена, ничего взамен)
Имя  👑 1240  🤝 Открыт к коллаб.      Имя  👑 1240  [🤝 Открыт к коллаборациям] ← КНОПКА
                                       └ клик → модалка «Как связаться»:
                                         ✈️ @annasynth ⧉ ↗ | ✉️ a•••@nullsea.ru [Показать] ⧉ | 💬 Написать
```

- бейдж — `<button id="btn-collab" data-help="collab_badge" aria-haspopup="dialog">`,
  рендерится только при `open_to_collab`; анониму клик открывает окно входа (`requireAuth`);
- модалка — `openContactsModal()` из `contacts.mjs`: чипы те же, что были в ряду
  (`data-help="profile_contacts"`, `contact_reveal`, `contact_write`), владельцу —
  значения без маски и «⚙️ Изменить» (`contact_edit_btn`) вместо «Написать»;
- пусто: владельцу «Контакты не указаны», чужим «Участник не оставил контактов»;
- ряда «Оплата» нет: реквизиты — кнопка ☕ (`#btn-support-user`) → модалка
  «Оплата и поддержка» (`support.mjs`).

### 4.2 Настройки профиля

```
📇 Контакты                                                     [?]
   ☑ Показывать мои контакты зарегистрированным участникам
     (текст-подсказка про 152-ФЗ и что e-mail/телефон скрыты маской)
   ┌────────────────────────────────────────────────────────────┐
   │ ▾ Telegram │ @annasynth        │ подпись… │ ▾ Всем     │ ✕ │
   │ ▾ E-mail   │ anna@nullsea.ru   │ по работе│ ▾ Участн.  │ ✕ │
   └────────────────────────────────────────────────────────────┘
   ＋ Добавить контакт   ·   не больше 6   ·   подсказка об автоопределении типа

💳 Оплата и поддержка                                           [?]
   Подсказка: «Деньги идут напрямую вам — платформа платежей не
   проводит и не выступает гарантом.»
   ☑ Показывать в профиле, какие способы я принимаю (без номеров)
   ┌ ▾ СБП    │ +7 921 000-11-22 │ СБП │ ✕ ┐
   ┌ ▾ Крипто │ TQn9…USDT TRC-20 │ USDT│ ✕ ┐
   ＋ Добавить способ   ·   не больше 6
```

- блок навыков (`#ed-skills`, `redrawSkills`) удаляем вместе с его автосохранением;
- ⚠️ **поправка §0.2:** тумблер «Показывать в профиле, какие способы я принимаю»
  (`#ed-payment-markers`) и ключ `payment.markers_toggle` удалены; у блока
  «Контакты» два предупреждения — `#ed-consent-warn` (согласие) и `#ed-collab-warn`
  (бейдж выключен → контакты видите только вы) + подсказка `profile.collab_hint`;
- контакты сохраняются через ту же очередь `saveQueue`/`scheduleSave(400)` — патч `currentPatch()` += `contact`, `contact_consent` (~~`payment_markers`~~ удалён);
- ошибки валидации — подсказкой под строкой + `toast`, невалидная запись в БД не уходит;
- `data-help`: `set_contact`, `set_payment` (бывший `set_donate` сохраняем как алиас? **нет** — переименовываем ключ в `set_payment` и обновляем каталог).

### 4.3 Онбординг, шаг 3

```
Как с вами связаться?
Одного способа достаточно — остальные добавите в настройках.

  ▾ Telegram   [ @username или ссылка t.me/… ]

  [ Пропустить ]            [ Готово 🚀 ]

Контакты видят только зарегистрированные участники.
```

- поле необязательное: «Пропустить» закрывает онбординг без записи;
- при заполнении → `updateProfile({ bio, software, contact: [c], contact_consent: true })`;
- текст `auth.onboarding_skills` → `auth.onboarding_contact`.

### 4.4 Модалка оплаты (бывшая `openSupportModal`)

- заголовок: «Оплата и поддержка · @username»;
- состав без изменений: «Перейти» / «Скопировать» / «Сказать спасибо» / счётчик ☕;
- дисклеймер усилить: *«SampleHelp не проводит платежи, не проверяет получателя и не выступает гарантом сделки. Проверяйте реквизиты перед переводом.»*;
- вход из шапки чужого профиля (☕) и из нового ряда «Оплата»;
- «Поблагодарить» под ответами — без изменений.

### 4.5 Кликабельные теги (подписки) — ✅ ВЫПОЛНЕНО 2026-10-13

> Итог реализации (детали — `WORKLOG.md`, верхняя запись «Сделано»): чипы —
> `tagSubChipHtml` из `subscriptions.mjs` (`button.tag.tag-sub`,
> `data-sub-tag`, `data-help="tag_subscribe"`, `aria-pressed`, «✓ #tag» у
> подписанного); обработчик — один capture-слушатель на document
> (`initTagSubscriptions()` из main.mjs) с `stopPropagation` и guard'ом режима
> справки; кэш — `store.subscriptions`, один `fetchSubscriptions()` на экран
> (`refreshTagSubsCache` в renderFeed/renderQuestion); сайдбар-блок
> перерисовывается по `subsBlockHost.isConnected`; `tagSubscribeButtonHtml`
> удалён (не подошёл по разметке — вариант, предусмотренный спекой);
> сверх спеки — генератор `new_question_tag`-уведомлений в `createQuestion`.

- `question.mjs:660` — `#tag` в карточке ответа → `<button class="tag tag-sub" data-sub-tag="…" title="Подписаться на тег">`;
- тег вопроса (`q.synth` в ленте `feed.mjs:166`) — так же;
- обработчик: `requireAuth()` → `toggleTagSubscription()` → перерисовать чип (`✓ #tag`) + обновить сайдбар-блок «Подписки», если он на экране;
- состояние «подписан» — из `fetchSubscriptions()` (кэш в `store`);
- `renderTagSubscribeButton` в `subscriptions.mjs` — либо задействуем, либо удаляем (решение при реализации: удалить, если не подойдёт по разметке);
- клик по тегу **не** должен триггерить плеер/модалку карточки — `stopPropagation`.

---

## 5. Локализация (`public/locales/ru.json`)

**Удалить (5):** `profile.skills`, `profile.skills_ph`, `profile.no_skills`,
`auth.onboarding_skills`, `help.items.set_skills`.

**Добавить (~40):**

- `profile.contacts`, `contacts_empty`, `contacts_login`, `contact_add`, `contact_value_ph`,
  `contact_label_ph`, `contact_limit`, `contact_consent`, `contact_consent_hint`,
  `contact_show`, `contact_hide`, `contact_write`, `contact_invalid_email`,
  `contact_invalid_phone`, `contact_invalid_username`, `contact_invalid_url`,
  `contact_invalid_dup`, `contact_kind_{telegram,email,phone,discord,website,vk,whatsapp,other}` (8),
  `contact_vis_{all,members,hidden}` (3);
- `profile.payment_title`, `payment_none`, `payment_show`, `payment_markers_toggle`,
  `payment_markers_hint`, `payment_edit`;
- `support.kind_crypto`, `support.disclaimer_strong`;
- `auth.onboarding_contact`, `onboarding_contact_hint`, `onboarding_contact_skip`,
  `onboarding_contact_privacy`;
- `common.tag_subscribe`, `common.tag_subscribed`;
- `help.items.{profile_contacts, profile_payment, set_contact, set_payment, tag_subscribe}`;
- `help.faq` — обновить раздел про профиль и раздел `donate` → «Оплата и контакты»
  (страница `/help`, 8 секций: правим текст секции «Поддержка», добавляем абзац про приватность контактов).

Итог по чекеру `check_keys.cjs`: 391 → ~426.

**Help-каталог:** 84 → **87** записей (−`set_skills`; +`profile_contacts`,
+`profile_payment`, +`set_contact`, +`tag_subscribe`; `set_donate` → `set_payment`).
Все новые интерактивные элементы получают `data-help`, иначе
`check_help_catalog.cjs` не пропустит.

---

## 6. Безопасность, приватность, модерация

1. **152-ФЗ (персональные данные).** Телефон и e-mail — ПДн. Публикуем только при
   `contact_consent = true` (чекбокс с внятным текстом, по умолчанию **выключен** для
   новых записей? — нет: по умолчанию `false`, но при добавлении контакта в онбординге
   согласие проставляется явно). Пункт в Terms of Service — на Этапе 3 (страниц ещё нет,
   фиксируем в WORKLOG как обязательство).
2. **Скрапинг/спам.** Анонимам контакты не отдаём; e-mail/телефон — маска до клика.
   Серверная выдача по RPC + rate-limit — Этап 3 (см. §3).
3. **Мошенничество.** Никаких формулировок «безопасная сделка», «гарантия», «эскроу».
   Усиленный дисклеймер в модалке оплаты. Возможность пожаловаться на профиль уже есть
   (`reports` + `moderation.mjs`) — в жалобу добавляем причину «мошенничество/реквизиты»
   (проверить список причин при реализации).
4. **Инъекции и мусор.** Все значения через `escapeHtml()`; ссылки — только `http(s)` и
   через `externalHref()`; whitelist `kind`-ов на входе (`normalizeContacts` отбрасывает
   неизвестные); лимиты длины 200/40 и количества 6+6.
5. **Свои данные в чужих руках.** В настройках — явная пометка, какие контакты видны всем
   (`visibility: all`), чтобы пользователь случайно не открыл телефон анонимам.

---

## 7. Тесты (`tmp_tests/`)

| Файл | Что делаем |
|---|---|
| **`test_contacts.mjs`** (новый) | `detectContactKind` (t.me/@user/e-mail/+7/discord.gg/`user#1234`/https/vk/wa.me/мусор); `validateContact` (длина, формат, `javascript:`-URL, дубли); `maskEmail`/`maskPhone` (точный формат); матрица `canSeeContact` (владелец/аноним/участник × all/members/hidden × consent); лимит 6 (7-я запись отклоняется); рендер ряда: аноним не видит `data-full`; «Показать» раскрывает залогиненному |
| **`test_tag_subscribe.mjs`** (новый) | клик по `#tag` в карточке ответа → `toggleSubscription('tag', …)`; повторный клик → отписка; аноним → `requireAuth`; `stopPropagation` (плеер не запускается) |
| `test_settings_autosave.mjs` | блок «чипсы навыков» (стр. 148-156) → блок «контакты»: добавление строки, автосохранение `contact` в профиль, снятие чекбокса согласия |
| `test_donations.mjs` | + `detectDonateKind('TQn9…') === 'crypto'`; + лимит 6; + заголовок «Оплата и поддержка»; + маркеры в шапке **без значений**; + усиленный дисклеймер |
| `test_demo_migration.mjs` | v6 → v7: `contact`/`contact_consent`/`payment_markers` переносятся из старого снапшота, `skills` больше не переносится |
| `test_help.mjs` | каталог 87 записей, новых `data-help` нет без описаний |

Плюс обязательный прогон: все 29 тестов, `node tmp_tests/check_keys.cjs`,
`node tmp_tests/check_help_catalog.cjs`, `npm run check` (32 модуля), smoke сервера,
скан CJK-загрязнений по изменённым файлам.

---

## 8. Порядок работ (чек-лист) — статус на 2026-10-11

**Заход A — ✅ выполнен целиком:**

1. ✅ `npm install && npm install jsdom --no-save` (node_modules между ходами не живут).
   ✅ Откатный снимок перед правками: `../filelist_baseline_2026-10-11_before_contacts.txt`
   (гита в проекте нет — точка восстановления одна).
2. ✅ SQL: `setup.sql`, `setup_part1.sql`, `schema.sql` — `drop user_skills` + политики,
   `alter profiles add contact/contact_consent` (~~`payment_markers`~~ — добавлялся
   здесь же и снят поправкой §0.2: `drop column if exists`), расширение CHECK у
   `reports` (`profile` / `fraud` через `drop constraint if exists … add constraint …`);
   `supabase/SETUP.md` — пункт «📇 Контакты вместо навыков» + онбординг в проверке.
3. ✅ `supabase.mjs`: `DEMO_DB_VERSION` 7 → **8** (поправка §0.2), сиды контактов и
   крипто-способа, `DEMO_PERSIST_KEYS`, `migrateDemo` (`['software','arsenal']`),
   `DEMO_MIGRATE_PROFILE_FIELDS` (+`contact`, `contact_consent`; `payment_markers`
   убран), `fetchProfile` (нормализация `contact` и `open_to_collab`),
   `updateProfile` (без `user_skills`), жалобы на профиль
   (`demoReportTarget` / `fetchReports` / `removeReportedContent`).
4. ✅ `contacts.mjs` (32-й модуль) + CSS (`.contact-chip`, `.contact-row.invalid`,
   `.row-error`; ~~`.contacts-row`, `.pay-markers`, `.pay-marker`~~ удалены поправкой
   §0.2, вместо них `.contacts-modal-list/-actions`, hover/focus у `.collab-badge`).
5. ✅ `support.mjs`: `crypto` (+ автоопределение адресов), `MAX_METHODS = 6`,
   заголовок «Оплата и поддержка», `support.disclaimer_strong`.
6. ✅ `profile.mjs`: ~~ряды «📇 Контакты» и «💳 Оплата»~~ → бейдж-кнопка и модалка
   (§0.2), редакторы в настройках (контакты + согласие; ~~маркеры оплаты~~),
   обработчики «Показать»/«Скопировать»/«Написать»/«Изменить», ⚑ на чужом профиле,
   удалён обработчик клика по навыкам.
7. ✅ `auth.mjs`: шаг 3 онбординга «Как с вами связаться?» (+ «Пропустить»).
8. ✅ **ЗАХОД B (2026-10-13):** `question.mjs` + `feed.mjs` — кликабельные теги
   (`tagSubChipHtml`: `button.tag.tag-sub[data-sub-tag][data-help="tag_subscribe"]`);
   `subscriptions.mjs` — мёртвый `tagSubscribeButtonHtml` УДАЛЁН (разметка
   `.toggle-chip`/`data-tag-sub` не подходила карточкам — вместо него чип-API:
   `tagSubChipHtml`/`isTagSubscribedCached`/`syncTagChips`/`refreshTagSubsCache`/
   `initTagSubscriptions`); сверх спеки — генератор уведомлений
   `new_question_tag` в `createQuestion` (демо + реал); тест
   `test_tag_subscribe.mjs` (43 проверки). Итог: 33 модуля, 426 ключей,
   95 пунктов справки, 31 тест / 1252 проверки.
9. ✅ `ru.json`: −5 ключей навыков, + разделы `contact` и `payment`,
   + `support.kind_crypto`/`disclaimer_strong`, + `report.reason_fraud`/`target_profile`/`self`,
   + `moderation.action_taken(_toast)`, + ключи онбординга; `helpPage.sections.*` переписаны.
   Итог захода A: 391 → 414 ключей, справка 84 → 94. **После поправки §0.2:
   415 ключей** (−4 `payment.*`, +11 новых) **и 92 пункта справки**
   (−`profile_payment*`, −`set_payment_markers`, +`collab_badge`, +`contact_edit_btn`).
10. ✅ Тесты: новый `test_contacts.mjs` (116 проверок → **170** после поправки §0.2),
    переписаны `test_settings_autosave` (секция навыков → контакты), `test_donations`
    (crypto, лимит, заголовок, дисклеймер, ~~маркеры в шапке~~ → вход через ☕),
    `test_moderation` (v8, 5 причин, жалоба на профиль), `test_demo_migration`
    (перенос `contact`/`contact_consent`/`open_to_collab`, удалённый флаг не воскресает).
    Прогон: **28 тестов** + `check_keys` + `check_help_catalog` + `npm run check` —
    зелёные; смоук сервера (`/`, `/js/contacts.mjs`, `/locales/ru.json`,
    `/css/style.css`, `/u/u-anna`, sitemap) ✓; CJK-скан изменённых файлов чист.
11. ✅ Доки: `WORKLOG.md` (статус, «В работе» = заход B, запись в «Сделано»,
    «Открытые вопросы» += серверный `reveal_contact` и Terms/152-ФЗ,
    «Важные заметки» += правила по контактам/ПДн и про экземпляры демо-базы в тестах),
    `README.md` (дерево модулей, фичи «Контакты и оплата», «Жалобы», «Оплата и поддержка»,
    каталог 92), `supabase/SETUP.md`, `tmp_tests/README.md`, этот план (§0.1, §0.2).
    ✅ `/home/user/PROJECT_ANALYSIS.md` — запись **(18)** и поправка **(19)**.
12. ✅ `npm run filelist` → `present_file /home/user/filelist_with_content.txt`.

**Заход A′ — поправка заказчика (§0.2), ✅ выполнен 2026-10-11:**
снятие рядов из шапки → бейдж-кнопка + `openContactsModal` → `canSeeContact` +=
`open_to_collab` → удаление `payment_markers` (SQL/сиды/настройки/тесты) →
галочка `#ob-collab` в онбординге → CSS бейджа и модалки → локали и каталог
справки → тесты (`test_contacts` 170, `test_donations` 7–8, `test_demo_migration`,
`test_moderation` v8) → доки (WORKLOG с пометкой в записи захода A, README,
SETUP.md, tmp_tests/README, этот план, PROJECT_ANALYSIS (19)) → снимок.
Откатная точка: `../filelist_baseline_2026-10-11_before_collab_badge.txt`.

**Ожидаемые счётчики после захода B:** 32 модуля, ~417 ключей, 93 пункта справки,
29 тестов.

Оценка захода A по факту: ~14 файлов + 3 SQL + 1 новый модуль + 1 новый тест.

---

## 9. Что сознательно НЕ делаем сейчас

- прайс-лист услуг и система заказов/сделок (обсуждали — отложили);
- серверная выдача контактов через RPC + rate-limit (Этап 3, боевой режим);
- верификация получателя платежа, эскроу, «безопасная сделка»;
- страницы Terms/Privacy/DMCA с пунктом о ПДн (Этап 3);
- подтверждение e-mail/телефона по коду (нет SMTP/SMS-провайдера);
- импорт контактов из внешних сервисов.
