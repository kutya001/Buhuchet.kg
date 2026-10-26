# packages/ui — общие компоненты интерфейса

- Компоненты, которые повторяются на многих экранах: оболочка (верхняя и левая панель, нижняя панель телефона ровно из 4 модулей и «≡ Другие модули»), окна и карточки с «На весь экран», UnifiedDataGrid (TanStack Table), шкала статусов и «История статусов», уведомления. Строятся в этапе 1 по прототипу: `spec/prototype/src/js/ui/*.js` и `spec/prototype/src/css/*.css`.
- Внешний вид и поведение — как в прототипе; граница ПК и телефона — 768 px.
- Тексты не пишутся в компонентах: приходят пропсами из словаря (модуль «Локализация»).
- Стили — Tailwind CSS v4; приложение подключает исходники пакета через `@source` в `apps/web/app/globals.css`.
- Без запросов к API и без состояния сервера: данные приходят пропсами.
- `RecordChangedNotice` — предупреждение при ответе 409 `record_changed` с кнопкой «Перечитать».
- Тема — `src/theme.css` (подключает `apps/web/app/globals.css`): переменные `--bu-*` светлой и тёмной темы со значениями прототипа (`spec/prototype/src/css/base.css`, сверяет `theme.test.ts`) и классы Tailwind к ним: `bg-frame`, `bg-pane`, `bg-pane-alt`, `bg-raised`, `bg-btn`, `border-line`, `text-ink`, `text-muted`, `text-faint`, `bg-accent`/`text-on-accent`, `danger`, `warn`, `caution`, `ok`, `info`, `violet` (+ `-bg`), тени `shadow-pane`, `shadow-pop`, `shadow-btn`, `shadow-cta`. Новый цвет — переменная в обоих тёмных блоках (они одинаковые) и строка в `@theme inline`.
- Значки — `Icon` (`src/icon.tsx`) по именам из `src/icons.ts` (значки прототипа `core/icons.js`); кнопки — `buttonClass()` и `iconButtonClass()` (`.btn`, `.btn.cta`, `.icon-btn` прототипа).
- Оболочка (`src/shell/`): `AppFrame`, `SideNav`, `TopBar`, `TabRow` (вкладки и «+ Добавить»), всплывающее окошко `Popover` и пункты меню `MenuItems`. Ссылки — пропсом `Link` (сайт передаёт `next/link`).
- Тесты — Vitest без DOM: разметка через `renderToStaticMarkup`, обработчики — вызовом компонента как функции.
