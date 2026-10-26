# packages/domain — бизнес-правила

- Чистый TypeScript: никакой базы, сети, файлов, времени «сейчас» и фреймворков. Нельзя импортировать `@buhuchet/db`, `@buhuchet/adapters`, `@buhuchet/api`, `hono`, `drizzle-orm`, `postgres`, `node:*` (проверяет ESLint).
- «Сегодня» и «сейчас» приходят параметром (их даёт `clock` из `@buhuchet/adapters`), поэтому любая функция проверяется тестом с фиксированной датой.
- Деньги — целые тыйыны (`number`, `Number.isSafeInteger`), на экран — через `formatSom`. Дробные сомы в расчётах не держим.
- Даты сроков — строки `YYYY-MM-DD` (тип `IsoDate`), считаются по Бишкеку (UTC+6).
- Источник правил — раздел ТЗ модуля в `spec/` и файлы прототипа `spec/prototype/src/js/core/*.js`, `spec/prototype/src/js/modules/*.js`. Эталонные ответы для тестов берутся из прототипа (скилл `prototype-oracle`).
- Порог покрытия тестами — 80 % (`pnpm --filter @buhuchet/domain test:coverage`); падение ниже останавливает слияние.
- Тексты экранов по умолчанию (начальное наполнение словаря) — `UI_TEXTS` в `src/l10n/texts.ts`; сообщения правил домена (ошибки проверок) пока остаются в модулях домена (docs/decisions.md, п. 24).
- Файлы раскладываются по модулям ТЗ: `src/<модуль>/…` (`reports`, `contractors`, `money`, …); общие кирпичи — в `src/common/`.
- Списки — `src/common/list.ts`: размеры страниц и «Все записи» (не больше 5 000 строк), `pageCount`, `shownRange`, сортировка по кругу `nextSort`, типы столбцов и фильтров, поиск как в прототипе `matchesSearch` (эталон для SQL), группировка `toggleGroupLevel` / `groupLevels` и итоги групп `groupAggOf` (по умолчанию сумма у числовых), предел выгрузки `EXPORT_ROWS_LIMIT`, настройки вида `GridViewSettings`, ключи списков `GRID_KEYS` (новый список с настройками вида — новый ключ) и «Статистики» модуля `statsViewKey` / `statsShown` (`isViewKey` — оба вида), формы числа `pluralForm`, число с разрядами `formatCount`.
