# Implementation Plan — 100% Мобильная Адаптация UI & Нативная Камера Смартфона

Этот план описывает полную Mobile-First адаптацию интерфейса B2B-платформы **Buhuchet.kg** под любые разрешения (смартфоны, планшеты, ПК), внедрение прямой съёмки с камеры смартфона и мобильных представление карточек вместо больших таблиц.

## User Review Required

> [!IMPORTANT]
> - **Нативная Камера Смартфона:** В `MultiFileDropzone.tsx` внедряется прямой вызов камеры устройства через атрибут `capture="environment"`, позволяя бухгалтеру/менеджеру мгновенно делать фото накладных или чеков на складе.
> - **Мобильный Лейаут (Bottom Nav Bar & Drawer):** На мобильных экранах (< 768px) левый сайдбар скрывается, появляется кнопка Бургер-меню и удобная нижняя панель навигации (Bottom Navigation Bar) с подсвеченными вкладками. На ПК полноэкранный сайдбар сохраняется на 100%.
> - **Адаптивные Таблицы (Card List View):** Реестры документов, файлов, контрагентов и каталога превращаются в сочные мобильные карточки на смартфонах (`block md:hidden`) и остаются полнофункциональными таблицами на ПК (`hidden md:block`).
> - **Мобильный Split-Screen (`/documents/[id]`):** На смартфонах двухколоночный просмотрщик трансформируется в переключатель вкладок («Просмотр Скана» / «Реквизиты и Статусы»).

---

## Proposed Changes

### 1. Мобильная Навигация & Лейаут

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Адаптация лейаута:
  - ПК: Фиксированный боковой сайдбар (256px).
  - Смартфоны: Мобильный Header с Бургер-меню (Drawer) и нижняя панель **Bottom Navigation Bar** с быстрым доступом к 5 ключевым разделам.

---

### 2. Съёмка с Камеры в `MultiFileDropzone.tsx`

#### [MODIFY] [MultiFileDropzone.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/documents/MultiFileDropzone.tsx)
- Добавление двух раздельных способов загрузки:
  1. 📸 **«Сделать фото накладной»** (`<input type="file" accept="image/*" capture="environment" />`).
  2. 📁 **«Загрузить файл / Галерея»** (`<input type="file" accept="image/*,.pdf" multiple />`).
- Прямая отправка в Cloudflare R2 по Presigned URLs с процентом прогресса.

---

### 3. Мобильные Карточки Реестров (Card List View)

#### [MODIFY] [documents/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/page.tsx)
- Двойной режим отображения: HTML-таблица на ПК и мобильные карточки B2B документов на смартфонах.

#### [MODIFY] [files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Карточки файлов R2 на смартфонах с прямыми кнопками скачивания и просмотра.

#### [MODIFY] [counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
- Мобильное представление контрагентов с защищенными реквизитами.

#### [MODIFY] [companies-catalog/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/companies-catalog/page.tsx)
- Карточки каталога компаний по Отраслям КР на мобильных устройствах.

---

### 4. Адаптация Split-Screen просмотрщика

#### [MODIFY] [documents/[id]/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/[id]/page.tsx)
- ПК: Двухколоночный сплит-экран.
- Смартфоны: Вкладки переключения между Сканом и Реквизитами/Аудитом.

---

### 5. Сенсорная Оптимизация Форм

#### [MODIFY] [onboarding/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/onboarding/page.tsx) & [pending/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/pending/page.tsx)
- `type="tel"`, `type="email"`, `inputMode="numeric"`, крупные поля ввода и тач-зоны.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Открытие приложения на эмуляторе мобильного телефона (ширина 375px - 414px):
   - Проверка нижней панели навигации Bottom Nav Bar.
   - Нажатие кнопки 📸 «Сделать фото накладной» -> открытие камеры на смартфоне.
   - Проверка превращения таблиц в карточки документов и файлов.
   - Проверка работы вкладок в просмотрщике `/dashboard/documents/[id]`.
2. Проверка ПК-версии (ширина > 1024px): подстверждение полноформатного сайдбара и сплит-экрана без потерь.
