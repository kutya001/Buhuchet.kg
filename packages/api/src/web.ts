import { createApp, type ApiApp } from './app';
import { createRuntime, type Runtime } from './runtime';

let web: { runtime: Runtime; app: ApiApp } | undefined;

/**
 * Обработчик для Next.js catch-all роута: `export const GET = handleApiRequest` и т. д.
 * Зависимости создаются при первом запросе, а не при сборке, поэтому `next build` не требует настроек.
 * Отдельный вход `@buhuchet/api/web`: worker собирается в один файл и не должен тянуть приложение API
 * (вход по паролю — нативный модуль argon2).
 */
export function handleApiRequest(request: Request): Promise<Response> | Response {
  return webApp().fetch(request);
}

/**
 * Запрос серверной части страницы к API в том же процессе (без сети): сеанс только читается и не
 * продлевается — cookie из такого ответа до браузера не дойдёт, её продлевают запросы самой страницы.
 */
export function handlePageRequest(request: Request): Promise<Response> | Response {
  return webApp().fetch(request, { pageRender: true });
}

function webApp(): ApiApp {
  if (!web) {
    const runtime = createRuntime('web');
    web = { runtime, app: createApp(runtime.deps) };
  }
  return web.app;
}
