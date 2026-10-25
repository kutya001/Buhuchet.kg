# Buhuchet.kg

Рабочий продукт Buhuchet.kg: учёт сдачи налоговых отчётов для бухгалтерских аутсорсинговых организаций Кыргызстана.

- Спецификация — ТЗ и прототип из [kutya001/DevBuhUchet.kg](https://github.com/kutya001/DevBuhUchet.kg); копия лежит в `spec/` (`pnpm spec:sync`).
- Правила работы для Claude Code — `CLAUDE.md`; архитектура — `docs/architecture.md`; решения — `docs/decisions.md`; развёртывание — `docs/deploy.md`; переезд на VPS — `docs/migration-vps.md`.

## Быстрый старт

Нужны Node.js 22, pnpm 10 (`corepack enable`) и Docker.

```sh
pnpm install
cp .env.example .env
pnpm setup:local      # PostgreSQL и MinIO в Docker, миграции, справочники, демо-организация
pnpm dev              # http://localhost:3000, проверка работы — /health
pnpm check            # типы, линтер, переносимость, карта приёмки, все тесты
```

Всё приложение в Docker, как на VPS: `docker compose --profile app up -d --build --wait`, затем `E2E_BASE_URL=http://localhost:3000 pnpm test:e2e`.

## Как вносятся правки

Только через PR. PR сливается сам, когда зелёные проверки `check`, `docker-e2e` и `pr-policy` (в описании — выводы агентов `spec-reviewer` и `security-reviewer`). Метка `hold` останавливает автослияние.
