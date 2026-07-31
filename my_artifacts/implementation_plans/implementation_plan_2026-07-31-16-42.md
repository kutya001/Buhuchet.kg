# Implementation Plan - Рефакторинг UI под Светлую и Тёплую темы (Warm Minimal UI)

**Дата и время:** 2026-07-31 16:42  
**Статус:** Выполнено & Проверено  

## Описание изменений
Устранены 21 проблему неадаптированных стилей, жестко зашитых Tailwind-классов (`slate`, `bg-blue-600`, `text-slate-200`, `text-slate-500`) и опечаток синтаксиса (`bg-blue-600-white`). Все ключевые компоненты и страницы переведены на семантические CSS-токены темы (`--primary`, `--background`, `--card`, `--foreground`, `--muted`, `--border`).

## Список исправленных элементов и файлов

### 1. `components/documents/ScanViewer.tsx`
- **Изменения:** Панель инструментов и холст сканов R2 переведены с тёмных `bg-slate-900/60`, `bg-slate-950/80` на `bg-card border-border` и `bg-muted/80`.
- **Кнопки:** Заменены жёсткие цвета `text-slate-400` и `hover:text-white` на `text-muted-foreground hover:text-foreground hover:bg-muted`.

### 2. `app/dashboard/employees/page.tsx`
- **Синтаксический баг:** Исправлена опечатка `bg-blue-600-white` на всех активных вкладках (`profile`, `employees`, `roles`), кнопке призыва к действию и кнопке модального окна.
- **Кнопка поиска:** Заменён конфликтный тёмный класс `hover:bg-slate-700` на `bg-primary hover:bg-primary/90 text-primary-foreground`.

### 3. `app/dashboard/company/page.tsx`
- **Карточка профиля:** Исправлена невидимость значений реквизитов (Отрасль, Руководитель, E-mail, Адрес) в светлых темах. Заменены `text-slate-500` на `text-muted-foreground`, а `text-slate-200` на `text-foreground font-semibold`.

### 4. `app/dashboard/documents/new/page.tsx`
- **Заголовок:** Заменён `text-white` на `text-foreground`.
- **Формы и селекты:** Списки выбора Получателя и Типа первички переведены с `bg-slate-950 border-slate-800` на `bg-background border-border text-foreground`.
- **Кнопки:** Кнопка "Назад в реестр" -> `border-border text-muted-foreground hover:bg-muted`; "Отправить получателю" -> `bg-primary text-primary-foreground`; "Сохранить черновик" -> `border-border text-foreground hover:bg-muted`.
- **Модальное окно сканов:** Заменён тёмный фон `bg-slate-950/40`, поиск и карточки сканов первички переведены на `bg-card border-border text-foreground`.

### 5. `app/dashboard/documents/page.tsx` & `app/dashboard/page.tsx`
- **Кнопка создания:** Кнопка "Создать документ" / "Создать B2B Отправку" переведена с `bg-blue-600` на `bg-primary hover:bg-primary/90 text-primary-foreground shadow-md`.

### 6. `app/(auth)/login/page.tsx` & `app/(auth)/register/page.tsx`
- **Логотип и кнопки:** Контейнер иконки логотипа заменён на `bg-primary/10 text-primary border-primary/20`. Кнопка входа/регистрации заменена на `bg-primary text-primary-foreground`.

### 7. `app/page.tsx` (Лендинг)
- **Первый экран:** Кнопки "Подключить" и "Зарегистрировать Организацию" переведены с фиктивного сине-индиго градиента на `bg-primary text-primary-foreground`.

## Проверка сборки
- Выполнена компиляция через `npm run build`.
- Результат: `✓ Compiled successfully (21/21 static pages)`.
