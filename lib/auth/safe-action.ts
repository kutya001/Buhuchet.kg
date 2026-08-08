import { z } from 'zod';
import { getSeverUserContext, type ServerUserContext } from '@/lib/auth/server-context';
import type { ActionResponse } from '@/types/database.types';

/**
 * Higher-Order Function для валидации Server Actions через Zod,
 * автоматической проверки авторизации пользователя и безопасной обработки 500 ошибок.
 */
export function createSafeAction<TInput, TOutput = any>(
  schema: z.ZodType<TInput>,
  handler: (data: TInput, ctx: ServerUserContext) => Promise<ActionResponse<TOutput>>
) {
  return async (rawInput: TInput): Promise<ActionResponse<TOutput>> => {
    try {
      const validation = schema.safeParse(rawInput);
      if (!validation.success) {
        const errorMsg = validation.error.issues.map((i) => i.message).join(', ');
        return { success: false, error: errorMsg };
      }

      const ctx = await getSeverUserContext();
      if (!ctx || !ctx.userId) {
        return { success: false, error: 'Пользователь не авторизован' };
      }

      return await handler(validation.data, ctx);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Сбой выполнения серверной операции';
      return { success: false, error: errorMsg };
    }
  };
}
