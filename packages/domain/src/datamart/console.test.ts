import { describe, expect, it } from 'vitest';
import apiDocs from '../../../../spec/data/apiDocs.json';
import schemaDoc from '../../../../spec/prototype/db/schema.json';
import {
  dmConsoleParamType,
  dmConsoleParamTypes,
  dmMethodSql,
  dmMethodTables,
  dmMethodToSelect,
  dmSqlAliasScopes,
  dmSqlFormat,
  dmSqlFromSlots,
  dmSqlLex,
  dmSqlMoneyName,
  dmSqlNoAliasMarks,
  dmSqlOutputNames,
  dmSqlQuickMarks,
  dmSqlRunText,
  dmSqlStatements,
  dmSqlTables,
  type DmRewriteNote,
} from './console';
import { formatText, UI_TEXTS } from '../l10n/texts';

/** Пометки перестройки словами словаря — как их пишет экран. */
const say = (list: readonly DmRewriteNote[]) =>
  list.map((x) => formatText(UI_TEXTS[`dm.con.rw.${x.code}`].ru, x.vars));
const SVC_COMMENT = UI_TEXTS['dm.con.rw.svc_comment'].ru;

describe('консоль: разбор текста на куски', () => {
  it('склейка кусков — исходный текст, строки и комментарии целиком', () => {
    const sql =
      'select \'a;b\', "x""y" -- ; нет\nfrom t /* (; */ where a::int = :p and b = $1 and c = $$;$$';
    const toks = dmSqlLex(sql);
    expect(toks.map((t) => t.text).join('')).toBe(sql);
    expect(toks.filter((t) => t.kind === 'param').map((t) => t.text)).toEqual([':p', '$1']);
    expect(toks.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(["'a;b'", '$$;$$']);
    expect(toks.some((t) => t.open)).toBe(false);
  });

  it('E-строка с «\\», вложенный комментарий и ${…} кода метода', () => {
    const toks = dmSqlLex("select E'a\\'b', 1 /* a /* b */ c */ ${ x.id }");
    expect(toks.find((t) => t.kind === 'string')!.text).toBe("E'a\\'b'".slice(1));
    expect(toks.find((t) => t.kind === 'comment')!.text).toBe('/* a /* b */ c */');
    expect(toks.find((t) => t.kind === 'param')!.text).toBe('${ x.id }');
  });

  it('длинный текст без закрывающей кавычки разбирается за один проход', () => {
    // Без часов (№ 83): квадратичный разбор 2 млн знаков не уложится в предел теста, а один проход — да.
    const sql = "select '" + 'a'.repeat(2_000_000);
    const toks = dmSqlLex(sql);
    expect(toks.map((t) => t.kind)).toEqual(['word', 'space', 'string']);
    expect(toks[toks.length - 1]!.open).toBe(true);
    expect(toks[2]!.text.length).toBe(2_000_001);
  });
});

describe('«Выполнить»: выделение или оператор под курсором (блок 1, пункт 3)', () => {
  const sql = 'select 1;\n\nselect 2; -- второй\nselect 3';
  it('операторы без «;» и пустых', () => {
    expect(dmSqlStatements(sql).map((s) => sql.slice(s.from, s.to))).toEqual([
      'select 1',
      'select 2',
      'select 3',
    ]);
    expect(dmSqlStatements(' ;; -- только комментарий\n')).toEqual([]);
  });
  it('курсор внутри, после и между операторами', () => {
    expect(dmSqlRunText(sql, 3, 3)).toBe('select 1');
    expect(dmSqlRunText(sql, sql.indexOf('2'), sql.indexOf('2'))).toBe('select 2');
    expect(dmSqlRunText(sql, sql.length, sql.length)).toBe('select 3');
    // Пустая строка между — ближайший перед курсором.
    expect(dmSqlRunText(sql, 10, 10)).toBe('select 1');
    expect(dmSqlRunText('', 0, 0)).toBeNull();
  });
  it('выделение уходит как есть, без «;» в конце', () => {
    expect(dmSqlRunText(sql, 0, 9)).toBe('select 1');
    expect(dmSqlRunText(sql, 0, 0)).toBe('select 1');
    expect(dmSqlRunText('   ', 0, 3)).toBeNull();
  });
  it('«;» внутри строки и комментария оператор не делит', () => {
    const s = "select ';' as a /* ; */\nfrom t";
    expect(dmSqlStatements(s)).toHaveLength(1);
  });
});

describe('быстрая проверка в браузере (блок 3, пункт 4)', () => {
  it('незакрытые кавычки, комментарий и скобки — с местом', () => {
    expect(dmSqlQuickMarks("select 'abc")).toEqual([{ from: 7, to: 8, code: 'unclosed_string' }]);
    expect(dmSqlQuickMarks('select "a')).toEqual([{ from: 7, to: 8, code: 'unclosed_quoted' }]);
    expect(dmSqlQuickMarks('select 1 /* a')).toEqual([
      { from: 9, to: 10, code: 'unclosed_comment' },
    ]);
    expect(dmSqlQuickMarks('select (1')).toEqual([{ from: 7, to: 8, code: 'unclosed_paren' }]);
    expect(dmSqlQuickMarks('select 1)')).toEqual([{ from: 8, to: 9, code: 'extra_paren' }]);
    expect(dmSqlQuickMarks("select '(' , count(*) from t")).toEqual([]);
  });
  it('скобка, не закрытая до «;», помечается в своём операторе', () => {
    expect(dmSqlQuickMarks('select (1; select 2')).toEqual([
      { from: 7, to: 8, code: 'unclosed_paren' },
    ]);
  });
});

describe('«Форматировать» (блок 3, пункт 5)', () => {
  it('разделы с новой строки, слова заглавными, столбцы по одному', () => {
    expect(
      dmSqlFormat(
        "select c.name as cp, count(*) from contractors c left join reports r on r.contractor_id = c.id where r.status = 'done' and c.inn like '1%' group by c.name order by 2 desc limit 10",
      ),
    ).toBe(
      [
        'SELECT',
        '  c.name AS cp,',
        '  count(*)',
        'FROM contractors c',
        'LEFT JOIN reports r ON r.contractor_id = c.id',
        "WHERE r.status = 'done'",
        "  AND c.inn LIKE '1%'",
        'GROUP BY c.name',
        'ORDER BY 2 DESC',
        'LIMIT 10',
      ].join('\n'),
    );
  });
  it('строки, имена в кавычках и параметры не меняются; BETWEEN … AND — одной строкой', () => {
    const out = dmSqlFormat(
      `select "Select" from t where d between :a and :b and x = 'select from'`,
    );
    expect(out).toContain('SELECT\n  "Select"');
    expect(out).toContain("WHERE d BETWEEN :a AND :b\n  AND x = 'select from'");
  });
  it('повторное форматирование ничего не меняет', () => {
    const once = dmSqlFormat('select a, b from t join u on u.id = t.id where a = 1 or b = 2');
    expect(dmSqlFormat(once)).toBe(once);
  });
  it('комментарий в конце строки остаётся на своей строке', () => {
    const out = dmSqlFormat('select a -- столбец\nfrom t');
    expect(out).toBe('SELECT\n  a -- столбец\nFROM t');
  });
});

describe('тип параметра консоли', () => {
  it('по имени — как поле прототипа; тип из шаблона — главнее', () => {
    expect(
      ['month_from', 'date', 'date_to', 'p_from', 'year', 'name'].map(dmConsoleParamType),
    ).toEqual(['month', 'date', 'date', 'date', 'year', 'text']);
    expect(dmConsoleParamTypes(['cp', 'year', 'x'], { cp: 'list:cp', x: 'num' })).toEqual([
      'list:cp',
      'year',
      'num',
    ]);
    // Только свои поля: имя `constructor` не берёт метод объекта.
    expect(dmConsoleParamTypes(['constructor'], {})).toEqual(['text']);
  });
});

describe('выражение без AS (блок 3, пункт 4)', () => {
  const marked = (sql: string) => dmSqlNoAliasMarks(sql).map((m) => sql.slice(m.from, m.to));
  it('выражение без имени отмечено от начала до конца', () => {
    expect(marked('select count(*), a + 1, x::int, 1 from t')).toEqual([
      'count(*)',
      'a + 1',
      'x::int',
      '1',
    ]);
  });
  it('поле, звёздочка, AS и имя через пробел — без отметки', () => {
    expect(
      marked(
        'SELECT DISTINCT *, t.*, a, t.b, "Имя", count(*) AS n, sum(x) total, case when a then 1 end as k from t',
      ),
    ).toEqual([]);
  });
  it('END, NULL и ASC в конце — не имя; вложенный SELECT и FROM внутри скобок не мешают', () => {
    // Одно слово (и NULL) прототип считает полем.
    expect(marked('select case when a then 1 end, x desc, null from t')).toEqual([
      'case when a then 1 end',
      'x desc',
    ]);
    expect(marked('select (select max(x) from u) as m, extract(year from d) as y from t')).toEqual(
      [],
    );
    expect(marked('update t set a = 1')).toEqual([]);
  });
});

describe('метод API → SELECT (блок 5, пункт 2)', () => {
  it('CREATE VIEW … AS SELECT → SELECT, проверки доступа убраны, public. — тоже', () => {
    const r = dmMethodToSelect(
      'CREATE OR REPLACE VIEW app.admin_sessions WITH (security_barrier = true) AS\n  SELECT l.id, l.user_id\n  FROM public.session_log l\n  WHERE app.is_platform_admin();',
    );
    expect(r.sql).toBe('SELECT l.id, l.user_id\n  FROM session_log l');
    expect(say(r.changed)[0]).toBe('CREATE VIEW app.admin_sessions … AS SELECT → SELECT');
    expect(say(r.changed)).toContain(
      'Убраны проверки «это администратор» и «моя организация»: их делает роль базы',
    );
    expect(say(r.replace)).toEqual([]);
  });
  it('«моя организация» в начале, в середине и в конце условия', () => {
    expect(
      dmMethodToSelect('select a from t where t.org_id = app.current_org_id() and a = 1').sql,
    ).toBe('select a from t where a = 1');
    expect(
      dmMethodToSelect('select a from t where a = 1 and app.current_org_id() = org_id').sql,
    ).toBe('select a from t where a = 1');
    expect(
      dmMethodToSelect('select a from t where org_id = app.current_org_id() order by a').sql,
    ).toBe('select a from t order by a');
  });
  it('$1 и ${…} → параметры :имя, app.current_user_id() → :user_id', () => {
    const r = dmMethodToSelect(
      'select * from t where a = $1 and b = ${ input.orgId } and c = $1 and u = app.current_user_id()',
    );
    expect(r.sql).toBe(
      'select * from t where a = :p1 and b = :org_id and c = :p1 and u = :user_id',
    );
    expect(r.params).toEqual(['p1', 'org_id', 'user_id']);
    expect(say(r.changed)).toContain('$1 → :p1');
    expect(say(r.changed)).toContain('app.current_user_id() → :user_id');
  });
  it('служебная функция помечена «-- замените» в своей строке', () => {
    const r = dmMethodToSelect(
      'select code\nfrom app.admin_dict_usage($1)',
      undefined,
      SVC_COMMENT,
    );
    expect(r.sql).toBe(
      'select code\nfrom app.admin_dict_usage(:p1) -- замените: app.admin_dict_usage — служебная функция или представление базы, шаблону недоступно',
    );
    expect(say(r.replace)).toEqual([
      'Служебные функции и представления помечены «-- замените»: app.admin_dict_usage',
    ]);
  });
  it('таблица параметром и обрезанный текст — что заменить', () => {
    const r = dmMethodToSelect(
      'select l.code from $1 l\njoin $2 t on t.code = l.code where l.x in ($3',
    );
    expect(say(r.replace)).toContain(
      ':p1 стоит на месте таблицы (в коде метода — таблица Drizzle): впишите имя таблицы',
    );
    expect(say(r.replace)).toContain('Текст метода в описании обрезан: допишите запрос');
  });
  it('не SELECT — шаблона не сделать', () => {
    expect(dmMethodToSelect('update t set a = 1').sql).toBeNull();
  });
  it('деньги остаются в тыйынах, столбцам ставится тип «Деньги»', () => {
    const r = dmMethodToSelect('select r.amount, r.paid, x.fee_sum as debt, r.name from reports r');
    expect(r.money).toEqual(['amount', 'paid', 'debt']);
    expect(dmSqlMoneyName('pay_amount')).toBe(true);
    expect(dmSqlMoneyName('total')).toBe(true);
    expect(dmSqlMoneyName('sub_total')).toBe(false);
    expect(dmSqlMoneyName('name')).toBe(false);
  });
  it('параметр против поля другого типа — приведение по карте базы; ожидание и блокировки — что заменить', () => {
    const known = new Map([
      [
        'contractors',
        new Map([
          ['id', 'uuid'],
          ['name', 'text'],
        ]),
      ],
    ]);
    expect(
      dmMethodToSelect(
        'select c.name from contractors c where c.id = $1 and $2 = c.name limit $3',
        known,
      ).sql,
    ).toBe(
      'select c.name from contractors c where c.id = :p1::uuid and :p2 = c.name limit :p3::integer',
    );
    expect(say(dmMethodToSelect('select pg_advisory_xact_lock(1)').replace)[0]).toContain(
      'pg_advisory_xact_lock',
    );
  });
  it('таблицы, которых консоли не видно, — что заменить', () => {
    const known = new Map([
      [
        'contractors',
        new Map([
          ['id', 'uuid'],
          ['name', 'text'],
        ]),
      ],
    ]);
    const r = dmMethodToSelect(
      'select c.name, c.secret from contractors c join session_log s on true',
      known,
    );
    expect(say(r.replace)).toEqual([
      'Таблицы консоли не видно: session_log — замените',
      'Поля консоли не видно: contractors.secret — замените',
    ]);
  });
});

describe('таблицы и столбцы запроса', () => {
  it('таблицы после FROM и JOIN без CTE и подзапросов', () => {
    expect(
      dmSqlTables(
        'with x as (select 1 from a) select * from x join public.b on true left join lateral (select 1 from c) y on true, d',
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
  it('запятая в ORDER BY и GROUP BY и FROM внутри функции — не таблица (замечание 28.11.2026)', () => {
    const sql =
      'SELECT l.started_at::date AS day, o.name AS org, count(*) AS logins FROM session_log l ' +
      'JOIN organizations o ON o.id = l.org_id GROUP BY 1, 2 ORDER BY day DESC, org';
    expect(dmSqlTables(sql)).toEqual(['session_log', 'organizations']);
    expect(
      dmSqlTables('select extract(year from created_at) y, a from t1, t2 group by y, a'),
    ).toEqual(['t1', 't2']);
    const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
    expect([...dmSqlFromSlots(sig)].map((k) => sig[k]!.text)).toEqual(['FROM', 'JOIN']);
    // Таблицы в скобках без подзапроса: «FROM (a JOIN b ON …), c».
    expect(dmSqlTables('select b.x from (a join b on true), c order by 1, x')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(dmSqlTables('select * from (select 1 from a) s, (values (1)) v, b')).toEqual(['a', 'b']);
  });
  it('столбцы вывода: псевдоним, иначе последнее имя', () => {
    expect(
      dmSqlOutputNames('select c.name, count(*) as n, coalesce(a, b) as "Итог" from t'),
    ).toEqual(['name', 'n', 'итог']);
  });
});

/** Снимок методов API продукта (`spec/data/apiDocs.json`, прототип v165+). */
const docs = apiDocs as unknown as {
  methods: { m: string; p: string; q?: number[] }[];
  sql: { k: string; t: string }[];
};

describe('метод API → SELECT на всём снимке (блок 5, пункт 6)', () => {
  const withSql = docs.methods.filter((m) => dmMethodSql(m, docs.sql));
  it('точный SQL есть только у GET; у остальных кнопок нет', () => {
    expect(withSql.length).toBeGreaterThan(50);
    expect(withSql.every((m) => m.m === 'GET')).toBe(true);
    expect(docs.methods.filter((m) => m.m !== 'GET').some((m) => dmMethodSql(m, docs.sql))).toBe(
      false,
    );
  });
  it('каждый запрос перестраивается в SELECT или прямо пишет, что заменить', () => {
    for (const m of withSql) {
      const r = dmMethodToSelect(dmMethodSql(m, docs.sql)!);
      expect(r.sql, m.p).not.toBeNull();
      const head = r.sql!.trimStart().slice(0, 6).toUpperCase();
      expect(
        ['SELECT', 'WITH R', 'WITH ', 'SELECT'].some((h) => head.startsWith(h.trim())),
        m.p,
      ).toBe(true);
      // Ни одной проверки доступа и ни одного «$1» в готовом тексте.
      expect(r.sql!.includes('app.is_platform_admin'), m.p).toBe(false);
      expect(r.sql!.includes('app.current_org_id'), m.p).toBe(false);
      expect(/\$\d/.test(r.sql!), m.p).toBe(false);
      // Служебное осталось — оно названо в «что заменить».
      if (r.sql!.includes('app.')) expect(r.replace.length, m.p).toBeGreaterThan(0);
    }
  });
  it('таблицы метода — для сборщика этапа 2', () => {
    const m = withSql.find((x) => x.p === '/admin/organizations')!;
    expect(dmMethodTables(m, docs.sql)).toContain('organizations');
  });
});

/** Карта базы из описания схемы (`spec/prototype/db/schema.json`): таблицы «Есть в базе» и их поля. */
const schema = schemaDoc as unknown as {
  tables: {
    name: string;
    status: string;
    columns: { name: string; type: string; status?: string }[];
  }[];
};
const known = new Map(
  schema.tables
    .filter((t) => t.status === 'actual')
    .map((t) => [
      t.name,
      new Map(t.columns.filter((c) => c.status !== 'planned').map((c) => [c.name, c.type])),
    ]),
);

describe('псевдонимы по уровням запроса (исправление этапа 2, docs/typical-mistakes.md № 86)', () => {
  it('псевдоним, заново объявленный в подзапросе, — своя таблица на своём уровне', () => {
    const sql =
      'select f.name, (select l.source_kind from platform_leads l where l.id = f.lead_id) as k from files f join leads_view l on l.id = f.id';
    const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
    const at = (text: string, n = 0) =>
      sig.map((t, i) => [t.text, i] as const).filter(([x]) => x === text)[n]![1];
    const resolve = dmSqlAliasScopes(sql);
    expect(resolve(at('l', 0), 'l')).toBe('platform_leads');
    // Коррелированный подзапрос видит внешний псевдоним.
    expect(resolve(at('f', 1), 'f')).toBe('files');
    // Снаружи l — своя таблица внешнего уровня.
    expect(resolve(at('l', 4), 'l')).toBe('leads_view');
  });
  it('WITH и LATERAL — свои уровни', () => {
    const r = dmMethodToSelect(
      'with x as (select c.name from contractors c) select c.inn from organizations c left join lateral (select c.name from contractors c) y on true',
      known,
    );
    expect(r.replace.filter((x) => x.code === 'closed_fields')).toEqual([]);
    const bad = dmMethodToSelect('select c.secret_field from contractors c', known);
    expect(bad.replace.find((x) => x.code === 'closed_fields')?.vars.list).toBe(
      'contractors.secret_field',
    );
  });
  it('ни одного ложного «поля не видно» на запросах снимка с точным SQL', () => {
    const files = docs.methods.find((m) => m.m === 'GET' && m.p === '/admin/files');
    expect(files && dmMethodSql(files, docs.sql)).toBeTruthy();
    const wrong: string[] = [];
    for (const m of docs.methods) {
      const src = dmMethodSql(m, docs.sql);
      if (!src) continue;
      const r = dmMethodToSelect(src, known);
      const f = r.replace.find((x) => x.code === 'closed_fields');
      if (f) wrong.push(`${m.p}: ${f.vars.list}`);
    }
    expect(wrong).toEqual([]);
  });
});
