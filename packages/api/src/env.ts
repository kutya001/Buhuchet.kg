import type { EmployeeAccess, SessionRecord } from '@buhuchet/db';
// Тип переменной `requestId` (её ставит `requestId()` в app.ts) объявлен в этом модуле hono: подключаем
// объявление здесь, чтобы `c.get('requestId')` проверялся и там, где app.ts не участвует (исполнитель задач).
import type {} from 'hono/request-id';

/** Действующий сеанс запроса: запись из базы и хеш токена из cookie. */
export interface AuthSession extends SessionRecord {
  tokenHash: string;
}

/**
 * Переменные запроса, которые задаёт общий слой (`middleware/session.ts`): сеанс и права сотрудника.
 * На открытых путях (вход, «здоровье», расписание) оба — null. У администратора платформы access — null.
 */
export interface AppEnv {
  /**
   * Задаёт только код, вызывающий API в том же процессе (`handlePageRequest`), — из браузера его не
   * передать. `pageRender` — запрос сделан сервером сайта при показе страницы.
   */
  Bindings: { pageRender?: boolean } | undefined;
  Variables: {
    session: AuthSession | null;
    access: EmployeeAccess | null;
  };
}
