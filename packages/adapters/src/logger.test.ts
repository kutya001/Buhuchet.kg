import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('пишет JSON со службой и вычищает секреты', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger({
      level: 'info',
      environment: 'test',
      version: '1.0.0',
      service: 'web',
      destination,
    });
    log.info(
      { user: { login: 'aibek', password: 'qwerty' }, headers: { authorization: 'Bearer x' } },
      'вход',
    );
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ service: 'web', env: 'test', version: '1.0.0', msg: 'вход' });
    expect(entry.user.password).toBe('[скрыто]');
    expect(entry.headers.authorization).toBe('[скрыто]');
    expect(entry.user.login).toBe('aibek');
  });

  it('вычищает вложенные секреты и заголовки, но оставляет коды ошибок', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger({
      level: 'info',
      environment: 'test',
      version: '1.0.0',
      service: 'worker',
      destination,
    });
    log.info({
      ctx: { session: { accessToken: 'abc', otpCode: '123456' } },
      res: { headers: { 'set-cookie': 'sid=1' } },
      config: { DATABASE_URL: 'postgres://u:p@h/db' },
      err: { code: '23505' },
    });
    const entry = JSON.parse(lines[0]!);
    expect(entry.ctx.session.accessToken).toBe('[скрыто]');
    expect(entry.ctx.session.otpCode).toBe('[скрыто]');
    expect(entry.res.headers['set-cookie']).toBe('[скрыто]');
    expect(entry.config.DATABASE_URL).toBe('[скрыто]');
    expect(entry.err.code).toBe('23505');
  });
});
