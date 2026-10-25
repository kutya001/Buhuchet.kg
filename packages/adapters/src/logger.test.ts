import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, safeErrorMessage } from './logger';

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
      s3: { err: { name: 'SignatureDoesNotMatch', StringToSign: 'AWS4…', AWSAccessKeyId: 'AK' } },
    });
    const entry = JSON.parse(lines[0]!);
    expect(entry.ctx.session.accessToken).toBe('[скрыто]');
    expect(entry.ctx.session.otpCode).toBe('[скрыто]');
    expect(entry.res.headers['set-cookie']).toBe('[скрыто]');
    expect(entry.config.DATABASE_URL).toBe('[скрыто]');
    expect(entry.err.code).toBe('23505');
    expect(entry.s3.err).toEqual({
      name: 'SignatureDoesNotMatch',
      StringToSign: '[скрыто]',
      AWSAccessKeyId: '[скрыто]',
    });
  });

  it('ошибка запроса к базе — без значений параметров (хеш пароля) в сообщении и стеке', () => {
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
    const query = 'update "users" set "password_hash" = $1, "login" = $2 where "id" = $3';
    const params = ['$argon2id$v=19$m=19456,t=2,p=1$секрет', 'taken', 'u1'];
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint_name: 'users_login_unique',
    });
    const err = Object.assign(new Error(`Failed query: ${query}\nparams: ${params.join(',')}`), {
      name: 'DrizzleQueryError',
      query,
      params,
      cause,
    });
    log.error({ err }, 'ошибка API');
    expect(lines[0]).not.toContain('argon2id');
    expect(JSON.parse(lines[0]!).err).toEqual({
      type: 'DrizzleQueryError',
      message: 'Ошибка запроса к базе',
      query,
      code: '23505',
      constraint: 'users_login_unique',
      cause: 'duplicate key value violates unique constraint',
    });

    log.error({ err: new Error('сохранение сотрудника', { cause: err }) }, 'ошибка');
    expect(lines[1]).not.toContain('argon2id');
    expect(JSON.parse(lines[1]!).err).toMatchObject({
      type: 'Error',
      message: 'сохранение сотрудника: ошибка запроса к базе',
      code: '23505',
    });

    log.error({ err: new Error('обычная ошибка') }, 'ошибка');
    expect(JSON.parse(lines[2]!).err).toMatchObject({ type: 'Error', message: 'обычная ошибка' });

    expect(safeErrorMessage(err)).toBe('Ошибка запроса к базе (23505)');
    expect(safeErrorMessage(new Error('сломалось'))).toBe('сломалось');
    expect(safeErrorMessage('не Error')).toBe('не Error');
  });
});
