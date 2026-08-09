# 📄 Buhuchet.kg — Облачная Платформа B2B ЭДО и Архива Первички в Кыргызской Республике

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20RLS-green?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2%20Storage-orange?style=for-the-badge&logo=cloudflare)](https://www.cloudflare.com/developer-platform/r2/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com/)

**Buhuchet.kg** — современная fullstack-платформа для коммерческих организаций (ОсОО, ЗАО, ОАО) и Индивидуальных Предпринимателей (ИП) Кыргызстана. Сервис решает проблему утери и размытости бухгалтерских сканов, автоматизирует передачу первичных актов и накладных между контрагентами по ИНН за 3 секунды и выгружает данные в «1С: Бухгалтерия» прямо в браузере.

---

## 🚀 Ключевые Возможности Платформы

- 🎨 **Унифицированная Дизайн-Система (Unified UI Components):**
  Единый кроссплатформенный интерфейсный слой на базе `UnifiedWorkspaceLayout`, `UnifiedViewModal`, `UnifiedSidebar`, `UnifiedHeader` и `UnifiedBottomNav`. Полная поддержка мобильных смартфонов и десктопов.
- 🏢 **Мультиарендность и Изоляция Данных (Multi-Tenancy RLS):** 
  Строгая изоляция организаций по `company_id` на уровне PostgreSQL Row Level Security (RLS) в Supabase.
- 📦 **Двухуровневое Облачное Хранилище Сканов (Cloudflare R2):**
  Автоматическое сжатие изображений в браузере (`browser-image-compression` до 1000px / <200 КБ). Прямая загрузка в R2 по Presigned URL с бесшовным фолбэком на серверный прокси.
- 📑 **Электронный Документооборот (B2B ЭДО):**
  Отправка первички контрагентам КР по ИНН (14 цифр), статусы (`draft` ➔ `sent` ➔ `accepted` / `cancelled` ➔ `processed`), Split-Screen просмотр скана и реквизитов, подробный журнал изменений.
- ⚙️ **Безопасные Server Actions:**
  Загрузка гидратированных деталей документов выполняется исключительно через серверный экшен `getDocumentDetailsAction` / `getB2BDocumentDetailsAction` с параллельными подзапросами (`Promise.all`), исключая клиентские ошибки соединения.
- ⚡ **Клиентский Экспорт в 1С (SheetJS):**
  Мгновенное формирование файлов `.xlsx` для интеграции с 1С без нагрузки на сервер и лимитов выполнения Vercel.
- 🔍 **Единый Компонент Реестров (`UnifiedDataGrid`):**
  Drag & Drop перетягивание столбцов, сортировка, скрытие колонок, фильтрация по отдельным полям и сохранение структуры таблицы при 0 результатов.
- 🏝️ **Парящий Адаптивный Интерфейс (`FloatingTopbar` & `FloatingBottomNav`):**
  Верхняя прозрачная панель с динамическим отступом под сайдбар, выпадающим поиском, тумблером 3 тем (Moon, Sun, Coffee) и живыми часами Кыргызстана.
- 🔔 **Стилизованные Уведомления (Sonner Toast):**
  Полная ликвидация нативных браузерных `alert()` в пользу неблокирующих сочных тостов `toast.error()` / `toast.success()`.
- 🛡️ **Модульная Панель Суперадминистратора (`/super-admin`):**
  Модульная реструктуризация на отдельные независимые системные роуты:
  - 🏢 `/super-admin/companies` — Модерация организаций (Все / На модерации / Замечания).
  - 👥 `/super-admin/users` — Реестр пользователей и привязок.
  - 📁 `/super-admin/files` — Файлы Облачного диска R2.
  - 🤖 `/super-admin/telegram` — Настройки Telegram-бота и статистика сообщений.
  - 🔍 `/super-admin/inspector` — Read-Only инспектор базы данных.
  - 💳 `/super-admin/subscriptions` — Управление подписками и биллингом.
- 🤖 **Telegram-Бот Интеграция:**
  Уведомления о новых документах и верификации через Telegram Webhooks и Upstash QStash.

---

## 🛠️ Стек Технологий

- **Fullstack Framework:** Next.js 14 (App Router, React Server Components, Server Actions).
- **Язык программирования:** TypeScript (строгий режим `strict: true`).
- **Стилизация & UI:** Tailwind CSS, Shadcn UI, Lucide Icons, CSS Glassmorphism, Sonner.
- **База данных & Аутентификация:** Supabase (PostgreSQL, Supabase Auth, Row Level Security - RLS).
- **Облачное хранилище сканов:** Cloudflare R2 (`@aws-sdk/client-s3`).
- **Клиентское сжатие:** `browser-image-compression`.
- **Экспорт данных:** SheetJS (`xlsx`).
- **Фоновые задачи:** Upstash QStash.

---

## 📁 Структура Проекта

```text
Buhuchet.kg/
├── app/                        # Next.js App Router (Страницы, API, Server Actions)
│   ├── (auth)/                 # Авторизация и регистрация (/login, /register)
│   ├── dashboard/              # Защищенный кабинет организации (Документы, Файлы, Сотрудники)
│   ├── super-admin/            # Модульный кабинет суперадминистратора (/companies, /users, /files и др.)
│   ├── api/                    # API Routes (вебхуки Telegram, Presigned URL generation)
│   ├── onboarding/             # Мастер первичной настройки профиля
│   ├── layout.tsx              # Глобальный макет приложения
│   └── page.tsx                # Главный лендинг платформы
├── components/                 # React UI-компоненты
│   ├── ui/                     # Единая Дизайн-Система (UnifiedWorkspaceLayout, UnifiedViewModal, UnifiedDataGrid)
│   ├── dashboard/              # Модули личного кабинета (DashboardShell, ScanViewer)
│   ├── super-admin/            # Компоненты панели управления супер-админа
│   └── theme/                  # Провайдер тем (ThemeProvider - Dark, Light, Warm)
├── docs/                       # Техническая документация проекта
│   ├── API.md                  # Спецификация Server Actions и API контрактов
│   ├── ARCHITECTURE.md         # Описание архитектуры и Data Flow
│   ├── DATABASE.md             # Схема базы данных PostgreSQL, DDL и RLS
│   └── DESIGN_SYSTEM.md        # Спецификация UI-компонентов Дизайн-Системы
├── lib/                        # Вспомогательные клиенты и библиотеки
│   ├── supabase/               # Клиенты Supabase (server.ts, client.ts, admin.ts)
│   ├── auth/                   # Движок прав доступа (permissions.ts)
│   ├── r2.ts                   # Клиент S3 Cloudflare R2
│   └── utils.ts                # Форматирование байт, дат и стилей
├── types/                      # TypeScript интерфейсы и Zod схемы
├── .ai_artifacts/              # Хранилище планов и отчетов разработчика
└── README.md                   # Главный руководящий файл проекта
```

---

## ⚙️ Установка и Локальный Запуск

### 1. Клонирование репозитория и установка зависимостей
```bash
git clone https://github.com/kutya001/Buhuchet.kg.git
cd Buhuchet.kg
npm install
```

### 2. Настройка переменных окружения
Создайте файл `.env.local` в корневом каталоге проекта:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cloudflare R2 Storage
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_PUBLIC_URL=https://your-r2-public-domain.com

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Запуск сервера разработки
```bash
npm run dev
```
Откройте [http://localhost:3000](http://localhost:3000) в браузере.

### 4. Валидация типов и сборка production-бандла
```bash
npm run build
npm run start
```

---

## 📜 Документация Проекта

Полная техническая спецификация зафиксирована в локальных документах:

- 🏗️ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Схема взаимодействия сервисов, роутинг, Data Flow загрузки сканов.
- 🗄️ [docs/DATABASE.md](docs/DATABASE.md) — Спецификация PostgreSQL DDL, индексы и Row Level Security (RLS) политики.
- 🔌 [docs/API.md](docs/API.md) — Контракты Server Actions, Zod-схемы и ответы бэкенда.
- 🎨 [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Стандарты компонентов единой Дизайн-Системы (`UnifiedWorkspaceLayout`, `UnifiedViewModal`).
- 🎯 [.antigravity/rules.md](.antigravity/rules.md) — Системные протоколы разработки, бизнес-контекст КР и словарь терминов.

---

## 🛡️ Безопасность и Лицензия

Все данные организаций защищены PostgreSQL RLS. Секретные ключи (`SUPABASE_SERVICE_ROLE_KEY`, `R2_SECRET_ACCESS_KEY`) вынесены на сервер и никогда не попадают в клиентский бандл.

Проект разработан для организации бухгалтерского учета и ЭДО в Кыргызской Республике. Все права защищены © 2026 **Buhuchet.kg**.
