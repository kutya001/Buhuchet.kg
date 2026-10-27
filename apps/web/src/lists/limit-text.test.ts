import { UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { ApiFailure, apiFailure } from '../api-client';
import { makeErrorText, makeTranslate } from '../l10n/translate';
import { retryOnce } from '../query';
import { limitFailureText } from './limit-text';

const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
const text = (code: string, details?: unknown) =>
  limitFailureText({ code, message: '…', details }, makeTranslate(texts), makeErrorText(texts));
const response = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: async () => body,
});

describe('Защита тяжёлых запросов: причина отказа на экране списка', () => {
  it('предел сервера — текст словаря, у долгого запроса — совет сузить список', () => {
    expect(text('query_timeout')).toBe(
      'Запрос выполнялся слишком долго. Сузьте список поиском или фильтром и попробуйте ещё раз.',
    );
    expect(text('export_busy')).toBe(
      'Предыдущая выгрузка в Excel ещё готовится. Попробуйте позже.',
    );
    expect(text('export_limit', { n: 20 })).toBe(
      'Не больше 20 выгрузок в Excel за час. Попробуйте позже.',
    );
  });

  it('другая ошибка — null: экран пишет свой текст про подключение, как прототип', () => {
    expect(text('internal_error')).toBeNull();
    expect(text('forbidden')).toBeNull();
    expect(limitFailureText(null, makeTranslate(texts), makeErrorText(texts))).toBeNull();
  });

  it('apiFailure: код и подробности из ответа; тело не в общем формате — код unknown', async () => {
    const failure = await apiFailure(
      response(503, {
        error: { code: 'query_timeout', message: 'Запрос выполнялся слишком долго' },
      }),
    );
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.status).toBe(503);
    expect(failure.error.code).toBe('query_timeout');
    const broken = await apiFailure({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('не JSON')),
    });
    expect(broken.error).toEqual({ code: 'unknown', message: '' });
  });

  it('retryOnce: ошибка повторяется один раз, запрос дольше предела — ни разу', async () => {
    const timeout = await apiFailure(
      response(503, { error: { code: 'query_timeout', message: '…' } }),
    );
    const other = await apiFailure(
      response(500, { error: { code: 'internal_error', message: '…' } }),
    );
    expect(retryOnce(0, other)).toBe(true);
    expect(retryOnce(0, new Error('нет связи'))).toBe(true);
    expect(retryOnce(1, other)).toBe(false);
    expect(retryOnce(0, timeout)).toBe(false);
  });
});
