# 📄 Buhuchet.kg — Облачная Платформа B2B ЭДО и Архива Первички в Кыргызской Республике

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20RLS-green?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2%20Storage-orange?style=for-the-badge&logo=cloudflare)](https://www.cloudflare.com/developer-platform/r2/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com/)

**Buhuchet.kg** — современная fullstack-платформа для коммерческих организаций (ОсОО, ЗАО, ОАО) и Индивидуальных Предпринимателей (ИП) Кыргызстана. Сервис решает проблему утери и размытости бухгалтерских сканов, автоматизирует передачу первичных актов и накладных между контрагентами по ИНН за 3 секунды и выгружает данные в «1С: Бухгалтерия» прямо в браузере.

---

## 🚀 Ключевые Возможности Платформы

- 🏢 **Мультиарендность и Изоляция Данных (Multi-Tenancy RLS):** 
  Строгая изоляция организаций по `company_id` на уровне PostgreSQL Row Level Security (RLS) в Supabase.
- 📦 **Двухуровневое Облачное Хранилище Сканов (Cloudflare R2):**
  Автоматическое сжатие изображений в браузере (`browser-image-compression` до 1000px / <200 КБ). Прямая загрузка в R2 по Presigned URL с бесшовным фолбэком на серверный прокси.
- 📑 **Электронный Документооборот (B2B ЭДО):**
  Отправка первички контрагентам КР по ИНН (14 цифр), статусы (`draft` ➔ `sent` ➔ `accepted` / `cancelled` ➔ `processed`), Split-Screen просмотр скана и реквизитов, аудит операций.
- ⚡ **Клиентский Экспорт в 1С (SheetJS):**
  Мгновенное формирование файлов `.xlsx` для интеграции с 1С без нагрузки на сервер и лимитов выполнения Vercel.
- 🔍 **Единый Компонент Реестров (`UnifiedDataGrid`):**
  Drag & Drop перетягивание столбцов, сортировка, скрытие колонок, фильтрация по отдельным полям и **сохранение заголовков таблицы даже при 0 результатах поиска**.
- 🏝️ **Парящий Адаптивный Интерфейс (`FloatingTopbar` & `FloatingBottomNav`):**
  Верхняя прозрачная панель с динамическим отступом под сайдбар, выпадающим поиском, иконным тумблером 3 тем (Moon, Sun, Coffee) и живыми часами Кыргызстана.
- 🛡️ **Панель Суперадминистратора (`/super-admin`):**
  Раздел управления платформой: Модерация организаций с под-вкладками (**Все / На модерации / Замечания**), Управление пользователями, Файлами R2, Документами ЭДО, Telegram-ботом, Справочниками и Read-Only Инспектор БД.
- 🤖 **Telegram-Бот Интеграция:**
  Уведомления о новых документах и верификации через Telegram Webhooks и Upstash QStash.

---

## 🛠️ Стек Технологий

- **Fullstack Framework:** Next.js 14 (App Router, React Server Components, Server Actions).
- **Язык программирования:** TypeScript (строгий режим `strict: true`).
- **Стилизация & UI:** Tailwind CSS, Shadcn UI, Lucide Icons, CSS Glassmorphism.
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
│   ├── super-admin/            # Изолированный кабинет суперадминистратора
│   ├── api/                    # API Routes (вебхуки Telegram, Presigned URL generation)
│   ├── onboarding/             # Мастер первичной настройки профиля
│   ├── layout.tsx              # Глобальный макет приложения
│   └── page.tsx                # Главный лендинг платформы
├── components/                 # React UI-компоненты
│   ├── dashboard/              # Компоненты личного кабинета (DashboardShell)
│   ├── super-admin/            # Модули панели суперадминистратора (SuperAdminSidebar)
│   ├── ui/                     # Базовые UI элементы (UnifiedDataGrid, FloatingTopbar, FAB)
│   └── theme/                  # Провайдер тем (ThemeProvider - Dark, Light, Warm)
├── lib/                        # Вспомогательные клиенты и библиотеки
│   ├── supabase/               # Клиенты Supabase (server.ts, client.ts, admin.ts)
│   ├── auth/                   # Движок прав доступа (permissions.ts)
│   ├── r2.ts                   # Клиент S3 Cloudflare R2
│   └── utils.ts                # Форматирование байт, дат и стилей
├── types/                      # TypeScript интерфейсы и Zod схемы
├── my_artifacts/               # Локальное хранилище планов и отчетов разработчика
├── ARCHITECTURE.md             # Полное описание архитектуры и Data Flow
├── DATABASE.md                 # Схема базы данных PostgreSQL, DDL и RLS
├── SYSTEM_PROMPT.md            # Бизнес-контекст КР, ролевая модель и статусы
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

- 🏗️ [ARCHITECTURE.md](ARCHITECTURE.md) — Схема взаимодействия сервисов, роутинг, Data Flow загрузки сканов.
- 🗄️ [DATABASE.md](DATABASE.md) — Спецификация PostgreSQL DDL, индексы и Row Level Security (RLS) политики.
- 🎯 [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md) — Бизнес-логика бухгалтерского учета КР, ИНН 14 цифр, роли и статусный граф документов.

---

## 🛡️ Безопасность и Лицензия

Все данные организаций защищены PostgreSQL RLS. Секретные ключи (`SUPABASE_SERVICE_ROLE_KEY`, `R2_SECRET_ACCESS_KEY`) вынесены на сервер и никогда не попадают в клиентский бандл.

Проект разработан для организации бухгалтерского учета и ЭДО в Кыргызской Республике. Все права защищены © 2026 **Buhuchet.kg**.
