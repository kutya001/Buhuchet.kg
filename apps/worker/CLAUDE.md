# apps/worker — фоновый исполнитель (VPS)

- Небольшая программа: раз в минуту вызывает `runDueJobs` — ту же функцию, что и маршрут `/api/cron/tick`. На Vercel не запускается: там раз в минуту будит Vercel Cron.
- Логики здесь нет: задачи живут в `packages/api/src/jobs`, правила — в `packages/domain`.
- Сборка — один файл `dist/index.js` (tsup), в Docker-образе только он. Поэтому импортировать только `@buhuchet/api/runtime` и `@buhuchet/api/jobs`, не `@buhuchet/api` целиком: приложение API тянет нативный модуль argon2, и сборка падает.
