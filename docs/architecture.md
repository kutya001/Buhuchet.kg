# Архитектура Buhuchet.kg

Коротко о том, как устроен код. Полный план (почему так, этапы, сроки) ведёт тред «Архитектура и план разработки» в файле «План разработки Buhuchet.kg»; здесь — то, что уже есть в репозитории.

## Схема

Браузер (ПК и телефон) → Next.js (`apps/web`) → API на Hono (`packages/api`, подключён catch-all роутом `/api/*`) → PostgreSQL и хранилище S3.

- Браузер не обращается к базе и хранилищу напрямую: только через API.
- Задачи по расписанию: площадка раз в минуту будит `/api/cron/tick` (Vercel Cron, cron на VPS) или `apps/worker` вызывает ту же функцию `runDueJobs`. Какие задачи пора выполнить, решает наш код по расписаниям в формате cron по времени Бишкека; слот задачи занимается строкой в `scheduler_runs`, поэтому повторный вызов ничего не дублирует, а пропущенный запуск догоняется.
- Telegram-вебхук — тоже маршрут API (появится в потоке Б).

## Пакеты

| Пакет | Что внутри | Зависит от |
| --- | --- | --- |
| `apps/web` | Next.js App Router, интерфейс, `vercel.json` (dub1, cron) | api, shared, ui |
| `apps/worker` | цикл раз в минуту для VPS, один файл после сборки | api, adapters |
| `packages/api` | Hono + @hono/zod-openapi, модули, задачи по расписанию, `/api/openapi.json` | adapters, db, domain, shared |
| `packages/domain` | бизнес-правила без базы и сети: деньги в тыйынах, даты по Бишкеку, дальше — сроки, отчёты, ГКЭД, тарифы | — |
| `packages/db` | Drizzle-схема, SQL-миграции, RLS, наполнение из `spec/data` | adapters (config) |
| `packages/adapters` | config, clock, storage (S3), scheduler, telegram, logger | domain |
| `packages/shared` | схемы Zod для API и форм | — |
| `packages/ui` | общие компоненты интерфейса | — |

## Данные и организации

- Таблицы организаций: `org_id`, RLS-политика `org_id = app.current_org_id()`. API открывает транзакцию через `withOrgContext`, который задаёт `app.org_id` и `app.user_id` (как `SET LOCAL`).
- Приложение подключается ролью из `DATABASE_URL` (член `buhuchet_app`, не владелец таблиц, не обходит RLS); владелец (`DATABASE_ADMIN_URL`) — только миграции и наполнение. `pnpm db:migrate` сам создаёт роль приложения с паролем из `DATABASE_URL`.
- Справочники платформы этапа 0 — `platform_reference` (разделы refDB.json как есть, с контрольной суммой и версией) и `gked_items` (ГКЭД 2022). Демо-организация «Бухгалтер Плюс» — `organizations` с постоянным `DEMO_ORG_ID`.

## Переносимость

С первого дня одно и то же приложение работает на Vercel + Supabase и в Docker на VPS (`docker compose --profile app up`). Каждая проверка PR собирает Docker-образы, поднимает PostgreSQL + MinIO + приложение + worker и гоняет сквозные тесты. Запреты (`@supabase/*`, `@vercel/*` вне adapters, функции Supabase в SQL, Edge Runtime, Server Actions, запись на диск, `process.env` вне config) проверяет `pnpm check:portability`.

## Проверки

- PR: `check` (типы, линтер, форматирование, переносимость, карта приёмки, миграции на чистой базе, отставание миграций от схемы, все тесты с покрытием ≥ 80 % для domain и api), `docker-e2e` (Docker как на VPS + Playwright на ПК и телефоне), `pr-policy` (в описании PR есть выводы агентов `spec-reviewer` и `security-reviewer`).
- Всё зелёное → `automerge` сливает PR (squash). Метка `hold` или черновик — не сливает; ветка отстала от main — просит обновить.
- Каждую ночь CI гоняется на main.
