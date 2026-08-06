# Implementation Plan - Комплексная Оптимизация Архитектуры, Безопасности и Производительности Buhuchet.kg

**Дата создания:** 2026-08-06 22:10  
**Статус:** Согласование Этапов Внедрения  

---

## 1. 🎯 Цель Рефакторинга
Комплексное устранение архитектурных узких мест платформы **Buhuchet.kg**:
1. Ликвидация перезагрузок и «мерцания» UI через перевод на SPA-навигацию (`next/link`, `useTransition`).
2. Оптимизация производительности СУБД Supabase (накат B-Tree индексов на все Foreign Keys `*_id`).
3. Безопасность и проверка прав доступа во всех Server Actions (`checkSuperAdmin()`, RLS, R2 Presigned URLs).
4. Точечная инвалидация кэша (`revalidatePath`) и узкий выбор колонок (`select('id, name, inn')`).

---

## 2. 📋 Детализация Этапов Внедрения

### Этап 1: Оптимизация Базы Данных (Индексы СУБД Supabase & Регламент `./DATABASE/`)
- Создание миграции `./DATABASE/changes/005_add_foreign_key_indexes.sql`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_documents_company_id ON public.documents(company_id);
  CREATE INDEX IF NOT EXISTS idx_documents_author_id ON public.documents(author_id);
  CREATE INDEX IF NOT EXISTS idx_documents_counterparty_id ON public.documents(counterparty_id);
  CREATE INDEX IF NOT EXISTS idx_files_company_id ON public.files(company_id);
  CREATE INDEX IF NOT EXISTS idx_files_document_id ON public.files(document_id);
  CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users(company_id);
  CREATE INDEX IF NOT EXISTS idx_counterparties_company_id ON public.counterparties(company_id);
  ```
- Выполнение SQL миграции на облачной СУБД Supabase через MCP-инструмент `execute_sql`.
- Актуализация `./DATABASE/schema.sql` и `./DATABASE/DATABASE_DOCUMENTATION.md`.

### Этап 2: Защита и Оптимизация Server Actions
- Строгая проверка `checkSuperAdmin()` первой строкой во всех экшенах `app/super-admin/actions.ts`.
- Перевод выгрузок данных с глобальных `select('*')` на узкие селекторы полей для снижения объема JSON.
- Уход от веерного `revalidatePath('/super-admin')` к точечной инвалидации конкретных страниц.
- Использование `Promise.all()` для параллельного выполнения независимых SQL-запросов.

### Этап 3: Фронтенд & UX (SPA Навигация и Плавность)
- Замена любых стандартных тегов `<a>` на `<Link href="...">` в сайдбаре `SuperAdminSidebar` и компонентах навигации.
- Использование хука `useTransition` во всех операциях сохранения/удаления в `UnifiedFormModal.tsx` для бесшовного обновления интерфейса.

---

## 3. 🧪 План Проверки и Валидации
1. Выполнение миграции индексов в базе данных Supabase и проверка через `pg_stat_user_indexes`.
2. Запуск сборки `npm run build` (`✓ Compiled successfully`).
3. Тестирование быстрой навигации и отсутствия «мерцаний» при переключении разделов.
4. Фиксация изменений в `git` и отправка в `main`.
