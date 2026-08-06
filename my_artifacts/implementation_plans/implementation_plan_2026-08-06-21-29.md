# Implementation Plan - Единая Дизайн-Система Super-Admin, Исправление Документов, Модуль Справочники и Мобильная Оптимизация

**Дата создания:** 2026-08-06 21:29  
**Статус:** Ожидает утверждения пользователя  

---

## 1. 🎯 Цель Проекта
1. **Единый дизайн-код Super-Admin:** Приведение панели суперадминистратора (`/super-admin`) к единому плавающему стилю рабочей зоны (`DashboardShell.tsx` / `FloatingTopbar` / glassmorphism).
2. **Исправление вкладки «Документы» в Super-Admin:** Выборка B2B документов через `createAdminClient()` со стопроцентным `JOIN` наименований компаний и контрагентов.
3. **Модуль «Справочники» (НСИ):** Полноценная вкладка администрирования НСИ (Типы документов, ОПФ, Налоговые режимы, Справочник Банков КР) на `UnifiedDataGrid` + `UnifiedFormModal`.
4. **Единая Номенклатура Модулей:** Унификация названий в сайдбаре, на мобильном и в админке.
5. **Мобильная Оптимизация (Mobile UX):** Авто-карточки в `UnifiedDataGrid`, выравнивание `FloatingBottomNav` под Safe Area и липкий футер в `UnifiedFormModal`.

---

## 2. 🛠️ Архитектура Изменений по Компонентам

### 2.1 Дизайн-код Super-Admin & Единая Номенклатура (`components/super-admin/SuperAdminSidebar.tsx` & `app/super-admin/page.tsx`)
- Перевод `SuperAdminSidebar` на плавающую структуру `rounded-2xl backdrop-blur-2xl bg-card/80 border-border/80 shadow-xl`.
- Внедрение `FloatingTopbar` с кнопкой открытия выездного меню и переключателями ширины.
- Приведение наименований разделов к стандартам: *Главная, Документы, Файлы, Контрагенты, Сотрудники, Организации, Справочники, Telegram-бот*.

### 2.2 Документы & Серверные Экшены (`app/super-admin/actions.ts`)
- В `getAllDocumentsAdminAction()` выполнять `JOIN` таблиц `companies` (для отправителя и получателя) и `counterparties`, формируя ровный DTO для `UnifiedDataGrid`.
- Создать экшены `getDictionariesAdminAction()`, `createDictionaryItemAdminAction()`, `updateDictionaryItemAdminAction()`, `deleteDictionaryItemAdminAction()`.

### 2.3 Модуль «Справочники» (НСИ) (`/super-admin/dictionaries`)
- Интегрировать 4 под-категории справочников:
  1. Типы B2B документов (Акт, Накладная, Счет-фактура, УПД, Договор, Доп. соглашение, Доверенность).
  2. ОПФ (ИП, ОсОО, ЗАО, ОАО, КФХ).
  3. Налоговые режимы (Общий режим, Патент, Единый налог).
  4. Справочник Банков КР (Наименование, БИК, SWIFT).

### 2.4 Мобильный UX (`UnifiedDataGrid.tsx`, `FloatingBottomNav.tsx`, `UnifiedFormModal.tsx`)
- `UnifiedDataGrid`: автоматическая адаптация таблиц в карточки (`Card View`) на экранах `< 768px`.
- `FloatingBottomNav`: поддержка Safe Area в iOS/Android (`pb-[env(safe-area-inset-bottom,0px)]`).
- `UnifiedFormModal`: зафиксировать футер `sticky bottom-0 bg-card/95 backdrop-blur p-4 border-t border-border`.

---

## 3. 🧪 План Валидации
1. Запуск сборки `npm run build` (`✓ Compiled successfully`).
2. Проверка отображения B2B документов в Super-Admin (отсутствие `undefined` по компаниям).
3. Проверка вкладки «Справочники» (НСИ) с поддержкой CRUD.
4. Визуальная проверка единого плавающего стиля Super-Admin.
5. Коммит и деплой в `main` (`git push origin main`).
