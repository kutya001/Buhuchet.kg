---
name: db-migration
description: Новая таблица или изменение схемы базы Buhuchet.kg — Drizzle-схема, SQL-миграция, org_id и RLS, тест изоляции организаций, наполнитель демо-данных.
---

# Миграция базы

Миграции делает одна сессия за раз. Применённые миграции (уже в main) не меняются никогда — хук не даст.

## Порядок
1. Схема — `packages/db/src/schema/<модуль>.ts`, экспорт в `schema/index.ts`.
   - Таблица организации: `orgId: uuid('org_id').notNull().references(() => organizations.id)`, `...timestamps()`, `version: recordVersion()`, `.enableRLS()` и политика `orgIsolation('<таблица>_isolation', t.orgId)`.
   - Деньги — `money('<поле>')` (тыйыны, bigint); сроки — `date('<поле>', { mode: 'string' })`; моменты — `timestamp(..., { withTimezone: true })`.
   - Индексы под фильтры списков: `org_id` первым столбцом; поиск по тексту — `gin_trgm_ops`.
   - Справочники платформы (общие для всех организаций) — без `org_id`, но запись только для администратора платформы через API.
2. `pnpm db:generate` → прочитать SQL в `packages/db/migrations/NNNN_*.sql` глазами: нет ли удаления данных, RLS включён, политика есть.
3. То, что Drizzle не генерирует (функции, триггеры, права, частичные индексы): `pnpm --filter @buhuchet/db exec drizzle-kit generate --custom --name=<что_делает>` и SQL руками. Новые таблицы получают права роли `buhuchet_app` автоматически (default privileges).
4. Запрещено в SQL: `auth.uid()`, `auth.jwt()`, схема `storage`, pg_cron, pg_net, Realtime; расширения — только pg_trgm, pgcrypto, citext (`pnpm check:portability`).
5. Изменение с потерей данных (удаление столбца, смена типа) — в два PR: сначала код перестаёт использовать, потом миграция удаляет. Откат — новой миграцией.
6. Тест изоляции в `packages/db/src/<модуль>.test.ts` или в тестах API — по образцу `packages/db/src/rls.test.ts`:
   - строки организации Б не видны в контексте организации А (`withOrgContext`);
   - нельзя изменить и создать строку чужой организации;
   - без контекста не видно ничего.
7. Демо-данные: функция в `packages/db/src/seed/demo.ts` из `spec/data/demoDB.json` с `DEMO_ORG_ID`, безопасная при повторе (`onConflictDoNothing`); вызвать из `seedAll`.
8. `pnpm db:migrate && pnpm db:seed --update && pnpm --filter @buhuchet/db test` — зелёные. CI проверяет, что `pnpm db:generate` после схемы ничего не создаёт (миграции не отстали от схемы).
