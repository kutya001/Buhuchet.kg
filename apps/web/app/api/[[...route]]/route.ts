import { handleApiRequest } from '@buhuchet/api/runtime';

// Весь API — пакет @buhuchet/api (Hono). Next.js только передаёт ему запросы.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
export const OPTIONS = handleApiRequest;
