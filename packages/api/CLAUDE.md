# packages/api — API на Hono

- Не зависит от Next.js: в веб-приложении монтируется одним catch-all роутом `apps/web/app/api/[[...route]]/route.ts`, на VPS может работать отдельно (`src/standalone.ts`, @hono/node-server).
- Каждый метод — `createRoute` из `@hono/zod-openapi` со схемами Zod из `@buhuchet/shared` для входа и выхода; описание OpenAPI строится само: `/api/openapi.json`.
- Маршруты раскладываются по модулям ТЗ: `src/modules/<модуль>/…`; модуль экспортирует функцию, которая регистрирует свои маршруты (пример — `src/modules/system`).
- Зависимости (база, хранилище, часы, журнал, Telegram, настройки) приходят через `ApiDeps` (`src/deps.ts`); в тестах — поддельные (`src/testing.ts`). `process.env` здесь не читается — только `loadConfig` в `src/runtime.ts`.
- Данные организаций — только через `withOrgContext` из `@buhuchet/db` (RLS). Промежуточный слой «вход → организация → права (39 прав с областью «Свои / Все контрагенты») → история» появится в этапе 1; до него методов с данными организаций нет.
- Ошибки — `{ error: { code, message } }`; `code` — ключ словаря интерфейса.
- Задачи по расписанию — `src/jobs/registry.ts`: имя, расписание cron по Бишкеку, окно догоняния; задача безопасна при повторе. Запускает их `/api/cron/tick` (Vercel Cron, cron на VPS) или apps/worker — одна и та же функция `runDueJobs`.
- Порог покрытия — 80 % (`pnpm --filter @buhuchet/api test:coverage`). Тесты прав и изоляции организаций — против настоящего PostgreSQL (`createTestDatabase`).
