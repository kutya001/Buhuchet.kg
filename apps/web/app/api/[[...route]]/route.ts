import { handleApiRequest } from '@buhuchet/api/web';

// Весь API — пакет @buhuchet/api (Hono). Next.js только передаёт ему запросы.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Задачи по расписанию (/api/cron/tick) работают до 4 минут на запрос к базе, выгрузка «В Excel» — до
// 60 с (docs/decisions.md, п. 38); функция должна жить дольше этих пределов.
export const maxDuration = 300;

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
export const OPTIONS = handleApiRequest;
