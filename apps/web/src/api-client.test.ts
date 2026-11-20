import { afterEach, describe, expect, it, vi } from 'vitest';
import { callApi, MEM_FULL_EVENT } from './api-client';

// Окно «Память организации заполнена» (доработки 20.11.2026, блок 2, пункт 5): отказ загрузки 409
// `mem_full` из любого места сайта доходит до оболочки событием окна.

const reply = (status: number, body: unknown) => async () => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe('callApi и «Память организации заполнена»', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('отказ mem_full — событие с ошибкой ответа, прочие отказы — без события', async () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const got: unknown[] = [];
    win.addEventListener(MEM_FULL_EVENT, (e) => got.push((e as CustomEvent).detail));
    const error = {
      code: 'mem_full',
      message: 'Память организации заполнена: занято 14 из 14 ГБ.',
      details: { used: '14', limit: '14' },
    };
    const res = await callApi(reply(409, { error }));
    expect(res).toEqual({ ok: false, status: 409, error });
    expect(got).toEqual([error]);

    await callApi(reply(409, { error: { code: 'record_changed', message: '' } }));
    await callApi(reply(200, { ok: true }));
    expect(got).toHaveLength(1);
  });
});
