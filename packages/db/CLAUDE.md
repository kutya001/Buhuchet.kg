# packages/db — схема, миграции, RLS, наполнение

## Миграции
- Схема таблиц — в `src/schema/*.ts` (Drizzle). После правки схемы: `pnpm db:generate` → в `migrations/` появляется SQL-файл; его читаем глазами и коммитим вместе со схемой.
- То, что Drizzle не генерирует (функции, роли, права, триггеры, особые индексы), — отдельной миграцией: `pnpm --filter @buhuchet/db exec drizzle-kit generate --custom --name=<что_делает>`, SQL пишем руками.
- Применённые миграции (уже в main) не правятся никогда — только новая миграция поверх. Хук запрещает их менять.
- `drizzle-kit push` запрещён. Миграции применяет `pnpm db:migrate`: локально и в CI — к своему PostgreSQL, на стенде и рабочем сайте — GitHub Actions при выпуске.
- Миграции делает одна сессия за раз (номера не должны конфликтовать).
- Расширения — только pg_trgm, pgcrypto, citext. Функции Supabase (`auth.uid()`, `auth.jwt()`, схема `storage`), pg_cron, Realtime — нельзя (`pnpm check:portability`).

## Организации и RLS
- Каждая таблица с данными организации: столбец `org_id uuid not null references organizations(id)`, `.enableRLS()` и политика `orgIsolation(t.orgId)` из `src/schema/rls.ts`.
- API в начале транзакции задаёт `app.org_id` и `app.user_id` (`withOrgContext`); политики сравнивают с `app.current_org_id()`.
- Приложение подключается ролью из `DATABASE_URL` — член `buhuchet_app` без права обходить RLS; владелец таблиц (`DATABASE_ADMIN_URL`) — только миграции и наполнение.
- В той же правке, что и таблица, — тест «чужая организация не видна» (пример — `src/rls.test.ts`).

## Данные
- Деньги — `bigint` тыйынов (`money()` из `src/schema/columns.ts`), даты сроков — `date` (строка `YYYY-MM-DD`), моменты — `timestamptz`.
- У изменяемых записей — `version integer` (защита от одновременной правки) и `created_at`/`updated_at`.
- История изменений (`audit_log`) пишется в той же транзакции, что и изменение (`src/history.ts`):
  - правка записи с версией — `updateWithHistory(tx, { table, entity, id, version, patch })`: блокирует запись, при устаревшей версии бросает `RecordChangedError` (чужая правка не затирается), иначе повышает `version`, ставит `updated_at`/`updated_by` и пишет «было → стало» по изменённым полям; правка без изменений ничего не пишет;
  - `patch` — только столбцы таблицы без служебных (иначе ошибка), собирается из явного списка полей формы; `key` — ключевой столбец, если он не `id` (учётная политика — `org_id`); `where` — условие области «Свои контрагенты» (вне области — «не найдена»); `changes` — изменения дочерних записей (права роли), которые тоже поднимают версию;
  - создание, удаление и прочие действия — `writeHistory(tx, { entity, entityId, action, changes?, reason? })`; сама запись при этом не меняется;
  - организация, автор и время ставит база из контекста `withOrgContext`, подменить их политика не даёт; без пользователя — «Система»; значения секретных полей (`isSecretField`: хеш пароля, `*Hash`, `*Token`, `*Secret`, плюс `secretFields`) не пишутся;
  - записи истории роль приложения не меняет и не удаляет (нет прав UPDATE и DELETE); новые виды записей и действия — в `HISTORY_ENTITIES` и `HISTORY_ACTIONS` из `@buhuchet/domain`.

## Наполнение
- `pnpm db:seed` — справочники платформы из `spec/data/refDB.json`, ГКЭД из `spec/data/gkedDB.json`, демо-организация из `spec/data/demoDB.json` (не на рабочем сайте). По умолчанию только добавляет недостающее; `--update` обновляет изменившиеся разделы (локально и на стенде после `pnpm spec:sync`).
- Модуль, у которого появляются таблицы, добавляет свой наполнитель демо-данных в `src/seed/demo.ts`.
- Записи демо-организации получают постоянный uuid `demoId(<вид>, <код из demoDB.json>)`: наполнители ссылаются друг на друга, как записи прототипа (у контрагента `resp: 'e3'` → `demoId('employee', 'e3')`). Демо-сотрудники входят паролем `DEMO_PASSWORD`.
- Каталог прав (`permissions`) и шаблоны ролей (`role_templates`) наполняются из refDB; набор прав — `PERMISSIONS` в `@buhuchet/domain`, при расхождении наполнение останавливается.

## Организации, пользователи, роли
- Новая организация — только через `createOrganization` (`src/organizations.ts`): роли из шаблонов, владелец, учётная политика в одной транзакции. Служебные команды: `pnpm db:create-org`, `pnpm db:create-admin`.
- Задача по расписанию берёт список организаций `orgIds(db)` (функция `app.org_ids()`) и работает с каждой в своей `withOrgContext`.
- Ссылки между записями организации — на пару `(id, org_id)` (составной внешний ключ), чтобы запись нельзя было связать с чужой организацией.

## Вход и сеансы
- Вход, проверка cookie и выход идут до того, как известна организация, поэтому `users` и `sessions` в это время читаются только функциями `app.auth_*` (миграция 0009, SECURITY DEFINER, `search_path` задан, выполняет только `buhuchet_app`) через обёртки `src/auth.ts`: `findLogin`, `recordLoginFailure`, `startSession`, `sessionByToken`, `endSession`, `changeOwnPassword`. Обходить RLS чтением таблиц нельзя; новая такая функция — тоже узкая, с `REVOKE … FROM PUBLIC`.
- В таблице сеансов — только SHA-256 токена; токен знает лишь cookie.
- Права и роль сотрудника для общего слоя API — `loadEmployeeAccess(tx, employeeId)` в `withOrgContext`; администратор платформы без организации — `withUserContext`.

## Тесты
- Тесты базы создают временную базу на сервере из `DATABASE_ADMIN_URL` (`createTestDatabase` из `src/testing.ts`), применяют миграции и удаляют базу в конце. Права и шаблоны ролей для `createOrganization` — `seedAccessReference(db)`.
- Без `DATABASE_URL` и `DATABASE_ADMIN_URL` тесты базы пропускаются; в CI (`REQUIRE_INTEGRATION_TESTS=1`) — падают.
