# Переезд на свой VPS

Инструкция обновляется вместе с кодом. Репетиция — на тестовом стенде до первого выпуска и раз в квартал. Можно переезжать частями: только файлы (меняются переменные `S3_*`), только приложение (база пока в Supabase) или только база (меняются `DATABASE_URL` и `DATABASE_ADMIN_URL`).

## Сервер
- Один VPS: 4 ядра, 8 ГБ памяти, 160 ГБ диска, Ubuntu 24.04 LTS — приложение, worker, PostgreSQL, MinIO, Caddy.
- Второй маленький сервер или Cloudflare R2 — только для резервных копий.

## Шаги
1. За неделю: уменьшить время жизни записей DNS в кабинете cctld.kg, если можно.
2. Подготовить VPS: Docker, файрвол (открыты только 80, 443 и SSH по ключу), пользователь без root.
3. Склонировать репозиторий, создать `.env` с переменными из `docker-compose.prod.yml` (`DOMAIN`, `APP_VERSION`, `DB_ADMIN_PASSWORD`, `DB_APP_USER` (имя вида `buhuchet_web`), `DB_APP_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `CRON_SECRET`, `TELEGRAM_*`, `SENTRY_DSN`).
   - Без обязательных переменных `docker compose` не запустится и назовёт, чего не хватает. Пароль владельца базы получает только сервис `migrate`.
   - Приложение пока ходит в MinIO ключами владельца MinIO; при репетиции переезда завести отдельного пользователя MinIO с доступом только к корзине `buhuchet` (`mc admin user add` + политика) и указать его ключи в `S3_*`.
4. `docker compose -f docker-compose.prod.yml up -d --build` и проверить `curl -fsS http://127.0.0.1:3000/api/health` внутри сервера.
5. Файлы заранее: `rclone sync supabase:<корзина> minio:buhuchet` (оба — как S3-хранилища в настройках rclone).
6. Окно переезда (ночь, 30–60 минут):
   1. Включить режим «Идут технические работы», остановить запись.
   2. `pg_dump --format=custom --no-owner "$SUPABASE_ADMIN_URL" > buhuchet.dump`
   3. `docker compose -f docker-compose.prod.yml stop web worker` и `pg_restore --no-owner --dbname "$VPS_ADMIN_URL" buhuchet.dump`, затем `docker compose -f docker-compose.prod.yml run --rm migrate` (догонит миграции и создаст роль приложения).
   4. Повторный `rclone sync` — только изменения.
7. Проверить: число записей по таблицам совпадает, `E2E_BASE_URL=https://<адрес VPS> pnpm test:e2e` зелёный, вход и скачивание файла работают.
8. В кабинете cctld.kg переключить запись A `buhuchet.kg` и записи `www`, `test` на адрес VPS; заново задать вебхук Telegram на новый адрес.
9. Выключить Vercel Cron (удалить crons из проекта Vercel), убедиться, что worker работает (`docker compose -f docker-compose.prod.yml logs worker`).
10. Две недели держать Vercel и Supabase в режиме «только чтение» как запасной вариант, затем отключить.

## Защита и копии на VPS
- У обычного VPS нет защиты от атак: при необходимости бесплатно подключить Cloudflare (смена NS в кабинете cctld.kg) — решение на момент переезда.
- Ночные копии `pg_dump` и `rclone` файлов на второй сервер или R2; раз в месяц — восстановление на чистый PostgreSQL в Docker и прогон тестов.
