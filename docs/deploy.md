# Развёртывание: стенд и рабочий сайт

Этап 0 проверен локально и в CI (Docker). Аккаунты оформляет заказчик; ключи и пароли задаются только в настройках окружения (Vercel, GitHub), не в чат и не в репозиторий.

## Схема
- Ветка `main` — тестовый стенд `test.buhuchet.kg`: сюда автослиянием приходят все PR. Ветка `production` — рабочий сайт `buhuchet.kg`: обновляется только по команде заказчика «выпускай».
- Из одного репозитория два проекта Vercel: `buhuchet-test` (Production Branch = `main`, домен `test.buhuchet.kg`, тестовая база) и позже `buhuchet` (Production Branch = `production`, домен `buhuchet.kg`, рабочая база). Два проекта, потому что Vercel Cron вызывает только production-выпуск проекта, а `/api/cron/tick` нужен и на стенде.
- Supabase: бесплатный проект `buhuchet-test` (стенд) сейчас; рабочий Pro-проект — ближе к запуску, сразу во Frankfurt (eu-central-1).

## Supabase: создание проекта
- **Enable Data API — выключить**, **Automatically expose new tables — выключить** (supabase-js и REST Supabase не используются, браузер к базе не обращается); **Enable automatic RLS — не включать** (RLS включают наши миграции: этот триггер есть только в Supabase, его нет локально и на VPS); **Connect GitHub — не подключать** (миграции применяет наш CI).
- Если Data API уже включён: Project Settings → Data API → выключить (или убрать `public` из открытых схем). Даже без этого строки не видны: у ролей `anon` и `authenticated` нет политик RLS (docs/decisions.md, п. 11).
- Регион проекта = регион функций Vercel (`regions` в `apps/web/vercel.json`, сейчас `fra1`): если бесплатный проект оказался не во Франкфурте, `regions` меняется под него.
- Storage → создать закрытую корзину `buhuchet` (Public — выключено); Storage → S3 Connection → создать ключи S3 (Access key ID и Secret).

## Vercel: проект `buhuchet-test`
- Import Git Repository → `kutya001/Buhuchet.kg`; Framework Preset — Next.js; **Root Directory — `apps/web`**; «Include files outside of the Root Directory in the Build Step» — включено (по умолчанию).
- Install Command и Build Command — по умолчанию (pnpm ставит весь монорепозиторий, `next build` сам транспилирует внутренние пакеты). Output Directory — по умолчанию.
- Settings → General → Node.js Version — 22.x. Settings → Git → Production Branch — `main`.
- Регион функций и расписание задаются в `apps/web/vercel.json` (`fra1`, `/api/cron/tick` раз в минуту). Расписание раз в минуту работает только на Vercel Pro: на Hobby выкладка с таким `vercel.json` отклоняется.
- Settings → Domains → `test.buhuchet.kg`; Vercel покажет запись CNAME — её добавить в кабинете cctld.kg (серверы имён не меняем).

## Переменные окружения
Vercel → проект → Settings → Environment Variables, окружение Production (для `buhuchet-test` это стенд). Полный список с пояснениями — `.env.example`.
- `APP_ENV` = `staging` (у рабочего сайта — `production`); `APP_BASE_URL` = `https://test.buhuchet.kg`.
- `DATABASE_URL` — роль приложения через пул Supabase в режиме транзакций (Connect → Transaction pooler, порт 6543), пользователь `buhuchet_web.<ref проекта>`, свой новый пароль (не пароль `postgres`). Роль с этим паролем создаёт `pnpm db:migrate`.
- `S3_ENDPOINT` = `https://<ref проекта>.storage.supabase.co/storage/v1/s3`, `S3_REGION` = регион проекта (например, `eu-central-1`), `S3_BUCKET` = `buhuchet`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` = `true`.
- `CRON_SECRET` — случайная строка от 32 символов (Vercel Cron передаёт её сам; примерная из `.env.example` на стенде и рабочем сайте не принимается).
- Позже: `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` (только вместе), `SENTRY_DSN`. На стенде можно `FIXED_NOW` для демо-даты.
- `DATABASE_ADMIN_URL` в Vercel **не задаётся**: пароль владельца базы есть только у миграций в GitHub Actions.
- Без обязательных переменных сайт не стартует и пишет в журнал, чего не хватает (`apps/web/instrumentation.ts`).

## GitHub (Settings репозитория)
- **Secrets and variables → Actions → New repository secret** — секреты стенда с приставкой `TEST_`: `TEST_DATABASE_ADMIN_URL` — пользователь `postgres.<ref проекта>` через пул в режиме сеанса (Connect → Session pooler, порт 5432; прямое подключение у бесплатного проекта только по IPv6, а у GitHub Actions его нет), `TEST_DATABASE_URL` — та же строка, что `DATABASE_URL` в Vercel, `TEST_S3_ENDPOINT`, `TEST_S3_REGION`, `TEST_S3_ACCESS_KEY_ID`, `TEST_S3_SECRET_ACCESS_KEY` — те же, что в Vercel. Их читает только `.github/workflows/migrate-test.yml` и только в шагах миграций, наполнения и корзины; пока их нет, он пропускает работу. Позже так же `PRODUCTION_*`.
  - Почему не Environment: секреты Environment и ограничение их веткой `main` в закрытом репозитории есть только на платных тарифах GitHub. Секреты репозитория видит workflow из любой ветки, поэтому в них — только тестовый стенд с демо-данными; если тариф GitHub Pro или выше, секреты переносятся в Environment `test` с ограничением веткой `main`.
- **General → Pull Requests**: включить «Allow auto-merge» и «Automatically delete head branches».
- **Branches → Branch protection rule (или Ruleset) для `main`** (если тариф позволяет для закрытого репозитория): Require a pull request, Require status checks `check`, `docker-e2e`, `pr-policy`, запрет force-push. Без защиты автослияние всё равно работает через `.github/workflows/automerge.yml`, а прямой push в main запрещает хук Claude Code.

## Как выходит версия
- Слияние PR в `main` → Vercel сам выкладывает `main` на `test.buhuchet.kg` (стенд с демо-организацией), миграции стенда применяет `migrate-test.yml`: `pnpm db:migrate`, `pnpm db:seed --update`, `pnpm storage:init` с `APP_ENV=staging`.
  - Слияние, сделанное `automerge.yml` токеном `GITHUB_TOKEN`, не запускает workflow на `push` в main (так устроен GitHub), но запуск `workflow_dispatch` разрешён: после слияния PR, который меняет `packages/db/` или `spec/data/`, `automerge.mjs` запускает `migrate-test.yml` сам. Слияние человеком запускает его через `push`; вручную — Actions → Migrate test → Run workflow.
  - Vercel выкладывает код одновременно с миграциями, поэтому миграции пишутся совместимыми со старым кодом (сначала добавить, потом убрать).
- Рабочий сайт — только по команде заказчика «выпускай»: метка версии, повтор проверок, миграции рабочей базы, перенос `production` на эту метку.
