import type { EmployeeAccess, SessionRecord } from '@buhuchet/db';

/** Действующий сеанс запроса: запись из базы и хеш токена из cookie. */
export interface AuthSession extends SessionRecord {
  tokenHash: string;
}

/**
 * Переменные запроса, которые задаёт общий слой (`middleware/session.ts`): сеанс и права сотрудника.
 * На открытых путях (вход, «здоровье», расписание) оба — null. У администратора платформы access — null.
 */
export interface AppEnv {
  Variables: {
    session: AuthSession | null;
    access: EmployeeAccess | null;
  };
}
