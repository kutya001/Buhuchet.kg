# Implementation Plan — Финальная Нативная Мобильная UX/UI Оптимизация (FAB, Bottom Sheets, Touch Targets)

Этот план описывает внедрение лучших мобильных паттернов (Floating Action Button под правый палец, нативные шторки Bottom Sheets для модальных окон, Segmented Controls и 48px Touch Targets на смартфонах) при 100% сохранении полноформатного вида на ПК.

## User Review Required

> [!IMPORTANT]
> - **Мобильная плавающая кнопка (FAB):** Круглая плавающая кнопка с неоновым свечением `fixed bottom-20 right-4 md:hidden` открывает нижнее меню быстрой съёмки с камеры, создания документа или загрузки в личный архив. На ПК кнопка скрыта.
> - **Bottom Sheets вместо плоских модалок на смартфонах:** Все диалоговые и модальные окна на смартфонах (`< 768px`) трансформируются в выезжающие снизу нативные шторки (Bottom Sheet) с индикатором-полоской вверху.
> - **Touch Targets (>= 48px):** Все мобильные кнопки и поля ввода приводятся к стандарту удобного касания пальцем (`min-h-[48px]`).

---

## Proposed Changes

### 1. Мобильная Плавающая Кнопка FAB & Меню Быстрых Действий

#### [NEW] [MobileFAB.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/components/ui/MobileFAB.tsx)
- Контекстная круглая плавающая кнопка под правый палец на смартфонах (`fixed bottom-20 right-4 md:hidden`).
- Нажатие высылает Bottom Sheet с кнопками:
  1. 📸 **«Сделать фото скана»** (нативная камера смартфона).
  2. 📝 **«Создать B2B документ»** (переход на `/dashboard/documents/new`).
  3. 📁 **«Загрузить в Личный Архив»** (быстрое сохранение скана).

---

### 2. Мобильный Лейаут & Bottom Nav Bar

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Внедрение компонента `MobileFAB` в `layout.tsx` для автоматического отображения на всех страницах личного кабинета на смартфонах.
- Учет нижней безопасной зоны `pb-20 md:pb-0`.

---

### 3. Нативные Шторки (Bottom Sheets) для Модальных Окон

#### [MODIFY] [documents/new/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/new/page.tsx)
- Адаптация модального окна выбора скана из архива в нативную нижнюю шторку на смартфонах (`bottom-0 rounded-t-2xl sm:rounded-xl`).

#### [MODIFY] [files/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/files/page.tsx)
- Адаптация модального окна загрузки в личный архив в нативный Bottom Sheet.

#### [MODIFY] [super-admin/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/super-admin/page.tsx)
- Адаптация модалок отклонения на доработку и реквизитов компании в мобильные Bottom Sheets.

---

### 4. Оптимизация Страниц Настроек, Учредительных Документов и Заявок

#### [MODIFY] [company/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/company/page.tsx)
- Одноколоночный мобильный стек карточек уставных файлов и крупные тач-зоны (`min-h-[48px]`).

#### [MODIFY] [partnerships/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/page.tsx)
- Внедрение мобильных переключателей Segmented Controls для вкладок «Входящие» / «Исходящие» / «Поиск».

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Открытие личного кабинета на смартфоне (ширина 375px - 414px):
   - Проверка работы плавающей кнопки FAB в правом нижнем углу (`bottom-20 right-4`).
   - Нажатие FAB -> выезд нативного Bottom Sheet меню быстрых действий.
   - Проверка модалок: выезд снизу с полоской-индикатором.
2. Открытие ПК-версии (ширина > 1024px):
   - Проверка, что кнопка FAB скрыта (`md:hidden`).
   - Проверка, что модальные окна на ПК остаются центрированными без изменений.
