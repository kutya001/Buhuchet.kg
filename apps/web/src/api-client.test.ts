import { afterEach, describe, expect, it, vi } from 'vitest';
import { callApi, leaveIfClosed, MEM_FULL_EVENT } from './api-client';

const forbidden = (code: string) =>
  new Response(JSON.stringify({ error: { code, message: 'Доступ закрыт' } }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

// Доступ организации закрыт по подписке (доработки 20.11.2026, блок 4, пункт 4): сервер закрыл сеанс
// сотрудника (403 `sub_closed`) — сайт сразу уводит на страницу входа, а не при следующем переходе.
describe('leaveIfClosed: ответ 403 «Доступ закрыт»', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('сотрудник закрытой организации — на страницу входа', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    await leaveIfClosed(forbidden('sub_closed'), '/api/contractors');
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('ответ входа, владелец закрытой организации и другие отказы — остаёмся', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    // Форма входа сама показывает «Доступ закрыт…» после верного пароля.
    await leaveIfClosed(forbidden('sub_closed'), '/api/auth/login');
    // Владельцу открыт экран «Подписка» — его сеанс не закрыт.
    await leaveIfClosed(forbidden('sub_closed_owner'), '/api/contractors');
    await leaveIfClosed(forbidden('forbidden'), '/api/contractors');
    await leaveIfClosed(new Response('нет', { status: 403 }), '/api/contractors');
    expect(assign).not.toHaveBeenCalled();
  });
});

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
