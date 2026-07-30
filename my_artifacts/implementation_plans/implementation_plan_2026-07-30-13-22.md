# Имплементационный План Оптимизации Модуля «Организации»

Данный документ содержит архитектурный план устранения задержек и кардинального ускорения модуля **«Организации»** (`/dashboard/counterparties`).

---

## 🛑 1. ПЛАН ПРОБЛЕМ, ПРИЧИН И РЕШЕНИЙ

### ❌ Проблема 1: Блокирующий `await syncPartnershipCounterpartiesAction()` при каждой загрузке страницы
- **Причина:** В функции `loadData()` первой строкой стоял `await syncPartnershipCounterpartiesAction()`. Каждое открытие страницы замирало на **1.5–3 секунды**, выполняя тяжелую сверку всей БД партнерств.
- **Решение:** 
  - Убрать `await syncPartnershipCounterpartiesAction()` из блокирующего цикла загрузки.
  - Запускать сверку исключительно асинхронно или по нажатию кнопки «Синхронизировать БД».

---

### ❌ Проблема 2: Последовательный Waterfall 4 запросов к Supabase
- **Причина:** Запросы контрагентов, заявок и каталога компаний выполнялись строго по очереди (`await cData -> await pData -> await compData`), суммируя сетевые задержки.
- **Решение:** 
  - Создать оптимизированный Server Action `getOrganizationsModuleDataAction()`, исполняющий выгрузку **параллельно** через `Promise.all()`.
  - Время получения ответа сократится с 3 секунд до **< 100 мс**.

---

### ❌ Проблема 3: Передача неиспользуемых полей из таблицы `companies` (Payload Bloat)
- **Причина:** Запрос каталога `select('*')` вытягивал тяжелые текстовые поля `legal_address`, `address`, `moderation_comment` всех компаний системы.
- **Решение:** 
  - Указать выборочный список полей: `.select('id, name, inn, industry, director_name, status')`.

---

## 🛠️ 2. ИЗМЕНЕНИЯ В КОДЕ

### [MODIFY] [actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Создать сфокусированную единую серверную функцию `getOrganizationsModuleDataAction()`, выполняющую параллельный `Promise.all()` для получения контрагентов, заявок и каталога с узкой выборкой полей.

### [MODIFY] [page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
- Заменить длинный последовательный `loadData()` на 1 быстрый вызов `getOrganizationsModuleDataAction()`.
- Убрать блокирующий `await syncPartnershipCounterpartiesAction()`.

---

## 📊 3. ПЛАН ВЕРИФИКАЦИИ
- `npx tsc --noEmit` — 0 ошибок.
- `npm run build` — 21 static page.
