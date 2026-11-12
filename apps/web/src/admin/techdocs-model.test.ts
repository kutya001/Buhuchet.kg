import { describe, expect, it } from 'vitest';
import {
  accessTone,
  codeHref,
  codePlace,
  frameHeight,
  methodClass,
  queryKind,
  responseTone,
  safeSchemaHash,
  schemaHash,
  schemaPageMessage,
  sqlTokens,
  typeParts,
} from './techdocs-model';

describe('адреса страницы схемы', () => {
  it('таблица, диаграмма метода и функция базы — как в прототипе', () => {
    expect(schemaHash.table('users')).toBe('#/t/users');
    expect(schemaHash.method('GET /admin/users/{id}')).toBe(
      '#/d/%40GET%20%2Fadmin%2Fusers%2F%7Bid%7D',
    );
    expect(schemaHash.fn('auth_login')).toBe('#/r/auth_login');
  });

  it('адрес из сообщения рамки принимается только вида «#/…»', () => {
    expect(safeSchemaHash('#/t/users')).toBe('#/t/users');
    expect(safeSchemaHash('#/d/%40GET%20%2Fa')).toBe('#/d/%40GET%20%2Fa');
    expect(safeSchemaHash('javascript:alert(1)')).toBe('#/t');
    expect(safeSchemaHash('#/t/"><script>')).toBe('#/t');
    expect(safeSchemaHash(`#/${'a'.repeat(400)}`)).toBe('#/t');
    expect(safeSchemaHash(null)).toBe('#/t');
  });
});

describe('цвета меток', () => {
  it('доступ: администратор, без входа, право, остальное', () => {
    expect(accessTone('admin')).toBe('violet');
    expect(accessTone('public')).toBe('warn');
    expect(accessTone('perm')).toBe('info');
    expect(accessTone('employee')).toBe('plain');
    expect(accessTone('session')).toBe('plain');
  });

  it('код ответа: 2xx, 3xx, 409 и 429, ошибки', () => {
    expect(responseTone('200')).toBe('ok');
    expect(responseTone('302')).toBe('info');
    expect(responseTone('409')).toBe('warn');
    expect(responseTone('429')).toBe('warn');
    expect(responseTone('403')).toBe('bad');
    expect(responseTone('503')).toBe('bad');
  });

  it('вид запроса: неизвестный — «Запрос по коду»', () => {
    expect(queryKind('sql')).toEqual({ key: 'sql', tone: 'ok' });
    expect(queryKind('view')).toEqual({ key: 'view', tone: 'info' });
    expect(queryKind('code')).toEqual({ key: 'code', tone: 'warn' });
    expect(queryKind('other')).toEqual({ key: 'code', tone: 'warn' });
  });

  it('метод HTTP: известный — со своим цветом', () => {
    expect(methodClass('GET')).toBe('td-mth td-m-GET');
    expect(methodClass('DELETE')).toBe('td-mth td-m-DELETE');
    expect(methodClass('OPTIONS')).toBe('td-mth');
  });
});

describe('подсветка SQL', () => {
  const sql = "select u.id from users u where u.login = $1 and u.kind = 'admin' -- только свои\nlimit 10";

  it('ключевые слова, параметры, строки и комментарии', () => {
    const tokens = sqlTokens(sql);
    expect(tokens.filter((x) => x.kind === 'k').map((x) => x.text)).toEqual([
      'select',
      'from',
      'where',
      'and',
      'limit',
    ]);
    expect(tokens.filter((x) => x.kind === 'p').map((x) => x.text)).toEqual(['$1']);
    expect(tokens.filter((x) => x.kind === 's').map((x) => x.text)).toEqual(["'admin'"]);
    expect(tokens.filter((x) => x.kind === 'c').map((x) => x.text)).toEqual(['-- только свои']);
  });

  it('склейка кусков даёт исходный текст', () => {
    expect(
      sqlTokens(sql)
        .map((x) => x.text)
        .join(''),
    ).toBe(sql);
    const html = '<script>alert(1)</script> select 1';
    expect(
      sqlTokens(html)
        .map((x) => x.text)
        .join(''),
    ).toBe(html);
  });

  it('слово внутри строки и комментария не подсвечивается', () => {
    const tokens = sqlTokens("'select' -- from");
    expect(tokens.map((x) => x.kind)).toEqual(['s', null, 'c']);
  });

  it('пустой текст — без кусков', () => {
    expect(sqlTokens('')).toEqual([]);
  });
});

describe('тип поля со ссылками на схемы', () => {
  const known = new Set(['AdminUserOrg', 'Uuid']);

  it('известная схема — ссылка, остальное — текст', () => {
    expect(typeParts('array<AdminUserOrg>', known)).toEqual([
      { text: 'array<', schema: false },
      { text: 'AdminUserOrg', schema: true },
      { text: '>', schema: false },
    ]);
    expect(typeParts('string', known)).toEqual([{ text: 'string', schema: false }]);
    expect(typeParts('Unknown | Uuid', known)).toEqual([
      { text: 'Unknown | ', schema: false },
      { text: 'Uuid', schema: true },
    ]);
  });
});

describe('ссылка на код продукта', () => {
  it('файл на коммите снимка со строкой', () => {
    expect(codeHref('kutya001/Buhuchet.kg', '280af90', 'packages/api/src/app.ts', 12)).toBe(
      'https://github.com/kutya001/Buhuchet.kg/blob/280af90/packages/api/src/app.ts#L12',
    );
    expect(codeHref('kutya001/Buhuchet.kg', '280af90', 'a/[[...route]]/route.ts', 0)).toBe(
      'https://github.com/kutya001/Buhuchet.kg/blob/280af90/a/%5B%5B...route%5D%5D/route.ts',
    );
  });

  it('репозиторий, коммит или путь не те — ссылки нет', () => {
    expect(codeHref('evil.example/x/y', '280af90', 'a.ts', 1)).toBeNull();
    expect(codeHref('kutya001/Buhuchet.kg', 'main"', 'a.ts', 1)).toBeNull();
    expect(codeHref('kutya001/Buhuchet.kg', '280af90', '../../etc', 1)).toBeNull();
    expect(codeHref('kutya001/Buhuchet.kg', '280af90', '/abs.ts', 1)).toBeNull();
    expect(codeHref('kutya001/Buhuchet.kg', '280af90', '', 1)).toBeNull();
  });

  it('место кода строкой', () => {
    expect(codePlace('a.ts', 5)).toBe('a.ts:5');
    expect(codePlace('a.ts', 0)).toBe('a.ts');
  });
});

describe('высота рамки схемы', () => {
  it('до низа области модуля, не ниже 420', () => {
    expect(frameHeight({ top: 200, bottom: 900, phone: false })).toBe(684);
    expect(frameHeight({ top: 150, bottom: 736, phone: true })).toBe(578);
    expect(frameHeight({ top: 500, bottom: 600, phone: false })).toBe(420);
    expect(frameHeight({ top: -40, bottom: 900, phone: false })).toBe(884);
  });
});

describe('сообщение страницы схемы', () => {
  it('чужое сообщение не разбирается', () => {
    expect(schemaPageMessage(null)).toBeNull();
    expect(schemaPageMessage('ready')).toBeNull();
    expect(schemaPageMessage({ ready: 1 })).toBeNull();
  });

  it('готовность, адрес, метод, полный экран, Esc', () => {
    expect(schemaPageMessage({ tdx: 1, ready: 1 })).toEqual({ ready: true });
    expect(schemaPageMessage({ tdx: 1, hash: '#/t/users' })).toEqual({ hash: '#/t/users' });
    expect(schemaPageMessage({ tdx: 1, hash: 'http://x' })).toEqual({ hash: '#/t' });
    expect(schemaPageMessage({ tdx: 1, open: 'GET /a' })).toEqual({ open: 'GET /a' });
    expect(schemaPageMessage({ tdx: 1, open: 5 })).toEqual({});
    expect(schemaPageMessage({ tdx: 1, full: 0 })).toEqual({ full: false });
    expect(schemaPageMessage({ tdx: 1, full: true })).toEqual({ full: true });
    expect(schemaPageMessage({ tdx: 1, esc: 1 })).toEqual({ esc: true });
  });
});
