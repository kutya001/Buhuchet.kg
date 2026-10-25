# Развёртывание: стенд и рабочий сайт

Этап 0 проверен локально и в CI (Docker). Для стенда `test.buhuchet.kg` и рабочего сайта `buhuchet.kg` нужны аккаунты — их оформляет заказчик; ключи задаются только в настройках окружения, не в чат и не в репозиторий.

## Что нужно от заказчика
1. **Supabase**: один аккаунт, две организации — Pro (рабочий проект, регион Frankfurt) и Free (тестовый проект).
2. **Vercel Pro**: проект из репозитория `kutya001/Buhuchet.kg`, Root Directory — `apps/web`, регион функций fra1 (задан в `apps/web/vercel.json`).
3. **Telegram**: бот через BotFather (токен).
4. **Домен**: записи DNS в кабинете cctld.kg — A для `buhuchet.kg`, CNAME для `www` и `test` на адреса, которые покажет Vercel (NS не меняем).

## Переменные окружения (Vercel → Settings → Environment Variables, отдельно для Production и Preview)
Полный список с пояснениями — `.env.example`. Для Supabase:
- `DATABASE_URL` — роль приложения через пул Supabase в режиме транзакций (порт 6543), пользователь вида `buhuchet_web.<проект>`; роль создаёт `pnpm db:migrate` с паролем из этой строки.
- `DATABASE_ADMIN_URL` — пользователь `postgres` (прямое подключение или пул в режиме сеанса) — только для миграций в GitHub Actions, в Vercel не нужен.
- `S3_ENDPOINT` = `https://<проект>.storage.supabase.co/storage/v1/s3`, `S3_REGION` = регион проекта, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — ключи S3 из настроек Storage Supabase, `S3_FORCE_PATH_STYLE=true`.
- `CRON_SECRET` — длинная случайная строка (Vercel Cron передаёт её сам), `APP_ENV` (`staging` / `production`), `APP_BASE_URL`, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`, `SENTRY_DSN`. На стенде можно `FIXED_NOW` для демо-даты.

## GitHub (Settings репозитория)
- **Secrets and variables → Actions**: `STAGING_DATABASE_ADMIN_URL`, `STAGING_DATABASE_URL`, позже `PRODUCTION_*` — для миграций при выпуске (workflow выпуска добавим на шаге развёртывания).
- **General → Pull Requests**: включить «Allow auto-merge» и «Automatically delete head branches».
- **Branches → Branch protection rule для main** (если тариф позволяет для закрытого репозитория): Require a pull request, Require status checks `check`, `docker-e2e`, `pr-policy`, Require branches to be up to date. Без защиты автослияние всё равно работает через `.github/workflows/automerge.yml`, а прямой push в main запрещает хук Claude Code.

## Как выходит версия (после подключения аккаунтов)
- Слияние PR в main → Vercel сам выкладывает main на `test.buhuchet.kg` (стенд с демо-организацией), миграции стенда применяет GitHub Actions.
- Рабочий сайт — только по команде заказчика «выпускай»: метка версии, повтор проверок, миграции рабочей базы, переключение сайта.
