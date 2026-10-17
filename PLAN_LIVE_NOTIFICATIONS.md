# PLAN_LIVE_NOTIFICATIONS.md — живые уведомления: генераторы answer/like, карта кликов, «клик = прочитано»

**Статус: ВЫПОЛНЕН 2026-10-14 (заход 47; решения опроса: полный пакет, отметка →
своя модалка поддержки, «спасибо»/«получено» → профили человека).
Журнал: WORKLOG «Сделано», запись 47. Откат: rollbacks/filelist_baseline_2026-10-14_before_live_notifs.txt.**

## 0. Диагноз (анализ 2026-10-14, без кода)

1. Типы `answer` и `like` — декорация: рендерер и сиды n1/n2 есть, генераторов
   нет (createAnswer и лайк уведомлений не шлют).
2. Тупики: у answer/like нет questionId даже в сидах; support-семейство без
   переходов; report_status — осознанный тупик (цель могли удалить).
3. Клик не помечает прочитанным: только «отметить все»; бейдж считает уже
   просмотренное → ощущение мёртвого колокольчика.
Живое сегодня: reminder/purge/solution/new_question_tag (questionId), idea_*.

## 1. Генераторы (демо + реал best-effort, как notifyTagSubscribers*)

- **createAnswer:** после успеха, если автор ответа ≠ автору вопроса:
  type `answer`, payload {by, questionTitle, questionId, answerId} → автору
  вопроса. Себе за свой ответ — не шлём.
- **лайк (функция лайка supabase.mjs):** только на ПОСТАНОВКУ (снятие — тихо);
  автору контента, себе — нет; type `like`, payload {by, targetKey, questionId}:
  targetKey ∈ 'notifications.target_answer' | '…target_question' (i18n вместо
   сырых строк; сид n2 переводится на targetKey). questionId для лайка ответа =
  вопрос этого ответа (переход открывает страницу с ответом).
- Рендерер `like`: `${by} ${t('notifications.type_like')} ${t(targetKey)}`.

## 2. Карта кликов (notifications.mjs, open())

| Тип | Куда |
|---|---|
| idea_status / idea_reply | /ideas (уже есть) |
| answer / like / solution / reminder / purge / new_question_tag | /question/:payload.questionId |
| support, amount=0 («спасибо») | /u/:payload.donorId (профиль донора) |
| support, amount>0, !done (отметка автору) | своя модалка поддержки: openSupportModal({recipientUserId: me…}) — список отметок и «Получено ✓» в один клик |
| support, done (донору) | /u/:payload.authorId (профиль автора; authorId ДОБАВИТЬ в payload done) |
| report_status | не кликабельно (осознанно) |

- **Клик = прочитано:** новый экспорт `markNotificationRead(id)` (демо: read +
  persistDemo; реал: update одной строки); open() помечает, если !read, и
  обновляет store/бейдж до перехода.
- **Аффорданс:** кликабельные `.notif-item` получают cursor:pointer + шеврон
  «›» справа (span.notif-go); некликабельные — без шеврона и курсора.
  Признак кликабельности — общий хелпер isNavigable(n) (та же карта).
- Импорт support.mjs в notifications.mjs цикла не даёт (support не импортирует
  notifications).

## 3. Сиды и payload

- n1 (answer): + questionId (вопрос «Тёплый эволюционирующий пэд…» из сидов).
- n2 (like): target → targetKey='notifications.target_answer' + questionId
  вопроса своего ответа.
- support done payload: + authorId (для перехода донора в профиль автора).
- DEMO_DB_VERSION 15 → **16** (сиды меняются → старый снапшот должен
  пересоздать их; carry пользовательских уведомлений не трогаем).

## 4. i18n / справка

- +2 ключа: notifications.target_answer «твой ответ», target_question
  «твой вопрос» → 513 используемых.
- Новых интерактивных элементов с data-help нет (шеврон неинтерактивен,
  модалка поддержки уже покрыта) → каталог 112.

## 5. Тесты (ожидалка)

- Новый `test_notif_clicks.mjs` (~20 проверок): createAnswer → уведомление
  автору вопроса с questionId/answerId и его отсутствие при ответе себе;
  лайк ответа → уведомление автору с targetKey+questionId, снятие — тишина;
  лайк своего — тишина; клик по answer-уведомлению в панели → location =
  /question/:id и read=true (бейдж честный); клик по «спасибо» → /u/donor;
  клик по отметке → открыта своя модалка поддержки (.sup-marks в modal-root);
  клик по done → /u/author; клик по report_status → локация не меняется и
  шеврона нет; шеврон есть у кликабельных.
- Ассерты версии 15→16 в 5 тестах (donations/contacts/moderation/demo_persistence ×3).
- Итог-ожидалка: 35 модулей, 513 ключей, каталог 112, 36 тест-файлов.

## 6. Регламент

- Откат: `rollbacks/filelist_baseline_2026-10-14_before_live_notifs.txt`.
- Конвенции: экранирование, t() литералами, best-effort уведомлений в реале
  (сбой не рвёт основное действие).
- Бэклог: агрегация лайков/дайджест, группировка одинаковых за день,
  настройки уведомлений, превью длинного контента в панели.
