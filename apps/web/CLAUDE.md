# apps/web — интерфейс Next.js

- App Router, React, TypeScript, Tailwind CSS v4. Сборка `output: "standalone"` — тот же сайт на Vercel и в Docker.
- API — только пакет `@buhuchet/api`, подключён одним файлом `app/api/[[...route]]/route.ts` (runtime `nodejs`). Своих серверных обработчиков данных здесь нет.
- Запрещено: Server Actions для данных (`"use server"`), Edge Runtime (`export const runtime = 'edge'`), прямые запросы к базе из компонентов, `@vercel/*` и `@supabase/*` (проверяет `pnpm check:portability`).
- Страницы за входом работают как одностраничное приложение: данные берут из API типизированным клиентом Hono (`src/api-client.ts`), позже — через TanStack Query; формы — React Hook Form со схемами Zod из `@buhuchet/shared`.
- Тексты интерфейса — из словаря (модуль «Локализация», этап 1), не в коде. Пока словаря нет, временные тексты помечаются `// TODO(l10n)`.
- Как в прототипе: граница ПК и телефона 768 px, на телефоне нижняя панель ровно из 4 модулей и «≡ Другие модули», у каждой карточки «На весь экран». Сверяться с `spec/prototype/src/js/ui` и `spec/prototype/src/css`.
- Экраны раскладываются по модулям ТЗ: `app/(app)/<модуль>/…`; общие компоненты — в `packages/ui`.
- `vercel.json` — регион fra1 и вызов `/api/cron/tick` раз в минуту; сверяется с `PLATFORM_CRON_ENTRIES` тестом.
