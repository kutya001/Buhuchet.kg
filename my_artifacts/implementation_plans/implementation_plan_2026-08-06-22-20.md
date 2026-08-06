# Implementation Plan - Глубокая Модернизация Табличной Сетки `UnifiedDataGrid.tsx`

**Дата создания:** 2026-08-06 22:20  
**Статус:** Ожидает утверждения пользователя  

---

## 1. 🎯 Цели Модернизации
Полный перенос и расширение функционала универсальной таблицы `UnifiedDataGrid.tsx`:
1. **Перенос действий в контекстное меню (Right-Click):** Полное удаление физического столбца «Действия» (`Actions`). Все операции строки выносятся в анимированное контекстное меню по правому клику (и долгому нажатию на мобильных).
2. **Компактный режим (`isCompact`):** Переключатель плотности таблицы (Обычный: `py-3 px-4 text-sm` vs Компактный: `py-1 px-2 text-xs`).
3. **Контекстное меню шапки (`<th>` ContextMenu):** Правый клик по заголовку столбца для сброса размеров ширин (`buhuchet_col_widths_${gridId}`) и очистки фильтров.
4. **Интерактивный Drag-to-Resize колонок:** Граница растягивания ширины колонок мышью с автоматическим кэшированием в `localStorage`.
5. **Типажно-зависимые фильтры колонок (`FilterPopover`):**
   - `dictionary`: Список чекбоксов с опцией «Выбрать все».
   - `text`: Поиск по подстроке (Содержит, Начинается с, Совпадает).
   - `number`: Фильтрация по числовому диапазону (От - До).
   - `date`: Выбор интервала времени (Дата с ... по ...).

---

## 2. 🏗️ Архитектура Компонентов

### 2.1 Обновление типов `ColumnDef<T>`
```typescript
export type ColumnDataType = 'text' | 'number' | 'date' | 'dictionary';

export type ColumnDef<T> = {
  key: string;
  label: string;
  type?: ColumnDataType;
  dictionaryOptions?: { label: string; value: string | number }[];
  sortable?: boolean;
  filterable?: boolean;
  hiddenByDefault?: boolean;
  width?: number;
  render?: (item: T) => React.ReactNode;
  getValue?: (item: T) => any;
};
```

### 2.2 Модуль Контекстного Меню (Row ContextMenu & Header ContextMenu)
- Контекстное меню строк с вызовом `getRowActions(row)`.
- Контекстное меню шапки таблицы для сброса настроек.

---

## 3. 🧪 План Проверки и Валидации
1. Запуск сборки `npm run build` (`✓ Compiled successfully`).
2. Проверка работы контекстного меню по правому клику в реестре Контрагентов и Заявок.
3. Проверка изменения ширины колонок и сохранения в `localStorage`.
4. Коммит и деплой в `main` (`git push origin main`).
