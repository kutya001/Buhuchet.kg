import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaveIfClosed } from './api-client';

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
