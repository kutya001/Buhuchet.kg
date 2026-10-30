import {
  formatText,
  RecordChangedError,
  UI_TEXTS,
  type StaffRefusal,
  type UiTextKey,
} from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { recordErrorResponse } from '../../errors';
import { refuse } from './employees';

// Отказы в действиях над сотрудником из списка (задача #16): экран берёт текст из словаря по коду и
// details.variant — он должен совпадать с текстом сервера.

/** Что покажет экран: текст словаря по коду и варианту. */
const screen = ({ code, details }: { code: string; details?: unknown }) => {
  const { variant } = (details ?? {}) as { variant?: string };
  const key = (variant ? `err.${code}.${variant}` : `err.${code}`) as UiTextKey;
  return UI_TEXTS[key] ? formatText(UI_TEXTS[key].ru) : undefined;
};

async function refusal(refused: StaffRefusal, action: Parameters<typeof refuse>[1]) {
  try {
    refuse(refused, action);
  } catch (err) {
    if (!(err instanceof HTTPException)) throw err;
    expect(err.status).toBe(403);
    return ApiError.parse(await err.getResponse().json()).error;
  }
  throw new Error('refuse не отказал');
}

describe('тексты словаря err.* совпадают с отказами сервера в действиях над сотрудником', () => {
  it('сброс пароля, блокировка, разблокировка и правка владельца', async () => {
    const cases: [StaffRefusal, Parameters<typeof refuse>[1], string][] = [
      ['own_account', 'block', 'own_account'],
      ['owner_employee', 'block', 'owner_employee'],
      ['owner_employee', 'unblock', 'owner_employee'],
      ['owner_employee', 'edit', 'owner_employee'],
      ['owner_employee', 'resetPassword', 'owner_password_reset'],
      ['password_owner_only', 'resetPassword', 'password_owner_only'],
      ['owner_granted', 'block', 'owner_granted'],
      ['owner_granted', 'unblock', 'owner_granted'],
      ['beyond_own', 'block', 'beyond_own'],
      ['beyond_own', 'unblock', 'beyond_own'],
    ];
    for (const [refused, action, code] of cases) {
      const error = await refusal(refused, action);
      expect(error.code, `${refused}/${action}`).toBe(code);
      expect(screen(error), `${refused}/${action}`).toBe(error.message);
    }
  });

  it('устаревшая версия записи — «Запись изменена другим пользователем»', () => {
    const { body } = recordErrorResponse(new RecordChangedError('employee', 'e1', 4))!;
    expect(screen(body.error)).toBe(body.error.message);
  });
});
