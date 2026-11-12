#!/usr/bin/env python3
"""Снимок описания API продукта для Админки → «Техническая документация» (data/apiDocs.json).

Читает исходники репозитория продукта kutya001/Buhuchet.kg (код не запускается, только разбор текста):
  • маршруты — createRoute({...}) в packages/api/src/modules/*, обработчики — .openapi(маршрут, обработчик(deps)) в index.ts модулей;
  • поля запросов и ответов — схемы Zod из packages/shared/src (тип, обязательность, ограничения, описание из комментария);
  • таблицы — функции пакета базы packages/db/src, которые вызывает обработчик (с вложенными вызовами): .from/.insert/.update/.delete
    по объектам таблиц из packages/db/src/schema и текст sql`…`; представления и функции app.* — по последним миграциям packages/db/migrations;
  • SQL — запросы sql`…` целиком (вставки ${…} → $1, $2 …), определения представлений и функций базы из миграций;
    цепочки Drizzle (tx.select().from()…) — фрагментом кода с пометкой «Запрос по коду».
Имена таблиц сверяются с db/schema.json: неизвестная таблица — ошибка проверки (как в ТЗ «Как собирается»).

Запуск из корня репозитория прототипа:
    python3 db/api_snapshot.py путь/к/Buhuchet.kg [--commit=abc1234 --date=2026-11-09]
Нужен только Python 3, без пакетов."""
import json, os, re, subprocess, sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SECTIONS = {'admin': 'Админка', 'auth': 'Вход', 'contractor-page': 'Страница контрагента', 'contractors': 'Контрагенты',
            'dicts': 'Справочники', 'fees': 'Оплата за обслуживание', 'files': 'Файлы', 'finance': 'Финансы', 'home': 'Главная',
            'kb': 'База знаний', 'kpi': 'Показатели', 'l10n': 'Локализация', 'money': 'Деньги на налоги', 'news': 'Новости',
            'onboarding': 'Первые шаги', 'org': 'Моя организация', 'platform-dicts': 'Справочники платформы', 'projects': 'Проекты',
            'reports': 'Отчёты', 'roles': 'Роли', 'staff': 'Сотрудники', 'system': 'Служебные', 'tasks': 'Задачи',
            'telegram': 'Телеграм', 'views': 'Вид списков'}
CTX = {'withOrgContext': 'org', 'withUserContext': 'user'}

# ═════════════ Разбор TypeScript: маска строк и комментариев ═════════════
REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')


def mask(s):
    """Копия той же длины: комментарии — пробелы, содержимое строк, шаблонов (кроме ${…}) и регулярных выражений — «_»."""
    out = list(s)
    n = len(s)

    def code(i, stop_brace):
        depth = 0
        prev = ''
        while i < n:
            c = s[i]
            if c == '/' and i + 1 < n and s[i + 1] == '/':
                j = s.find('\n', i)
                j = n if j < 0 else j
                for k in range(i, j): out[k] = ' '
                i = j
                continue
            if c == '/' and i + 1 < n and s[i + 1] == '*':
                j = s.find('*/', i + 2)
                j = n if j < 0 else j + 2
                for k in range(i, j):
                    if out[k] != '\n': out[k] = ' '
                i = j
                continue
            if c in '"\'':
                j = i + 1
                while j < n and s[j] != c and s[j] != '\n':
                    if s[j] == '\\': out[j] = '_'; j += 1
                    if j < n: out[j] = '_'
                    j += 1
                i = j + 1
                prev = 'a'
                continue
            if c == '`':
                i = tmpl(i + 1)
                prev = 'a'
                continue
            if c == '/' and (prev == '' or prev in REGEX_PREV or prev == 'kw'):
                j = i + 1
                cls = False
                while j < n and s[j] != '\n':
                    if s[j] == '\\': out[j] = '_'; j += 1; out[j] = '_'; j += 1; continue
                    if s[j] == '[': cls = True
                    elif s[j] == ']': cls = False
                    elif s[j] == '/' and not cls: break
                    out[j] = '_'
                    j += 1
                i = j + 1
                while i < n and s[i].isalpha(): i += 1
                prev = 'a'
                continue
            if c == '{': depth += 1
            elif c == '}':
                if stop_brace and depth == 0: return i + 1
                depth -= 1
            if not c.isspace():
                if c.isalnum() or c in '_$':
                    j = i
                    while j < n and (s[j].isalnum() or s[j] in '_$'): j += 1
                    w = s[i:j]
                    prev = 'kw' if w in ('return', 'typeof', 'case', 'in', 'of', 'yield', 'await') else 'a'
                    i = j
                    continue
                prev = c
            i += 1
        return i

    def tmpl(i):
        while i < n and s[i] != '`':
            if s[i] == '\\':
                out[i] = '_'
                if i + 1 < n: out[i + 1] = '_'
                i += 2
                continue
            if s[i] == '$' and i + 1 < n and s[i + 1] == '{':
                i = code(i + 2, True)
                continue
            if s[i] != '\n': out[i] = '_'
            i += 1
        return i + 1

    code(0, False)
    return ''.join(out)


PAIR = {'(': ')', '[': ']', '{': '}'}


def close_of(m, i):
    """Индекс закрывающей скобки для m[i] (маска без строк и комментариев)."""
    o = m[i]; c = PAIR[o]; d = 0
    for j in range(i, len(m)):
        if m[j] == o: d += 1
        elif m[j] == c:
            d -= 1
            if d == 0: return j
    return len(m) - 1


def depth_map(m):
    d = 0; out = [0] * len(m)
    for i, c in enumerate(m):
        if c in '([{': out[i] = d; d += 1
        elif c in ')]}': d -= 1; out[i] = d
        else: out[i] = d
    return out


def body_start(m, i):
    """После «)» параметров функции: пропустить тип результата и найти «{» тела."""
    j = i
    while j < len(m) and m[j].isspace(): j += 1
    if j < len(m) and m[j] == ':':
        j += 1
        ang = 0
        while j < len(m):
            c = m[j]
            if c == '<': ang += 1
            elif c == '>' and m[j - 1] != '=': ang -= 1
            elif c in '([': j = close_of(m, j)
            elif c == '{':
                k = j - 1
                while k > 0 and m[k].isspace(): k -= 1
                if ang > 0 or m[k] in ':|&<,(': j = close_of(m, j)
                else: return j
            j += 1
        return -1
    if j < len(m) and m[j] == '=' and m[j + 1] == '>':
        j += 2
        while j < len(m) and m[j].isspace(): j += 1
    return j if j < len(m) and m[j] == '{' else -1


DECL_RE = re.compile(r'(?m)^(export\s+)?(?:(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*))')


def decls(src):
    """Объявления верхнего уровня: имя → {text, start, end, kind, exported}."""
    m = mask(src); dm = depth_map(m); out = {}
    for x in DECL_RE.finditer(m):
        st = x.start()
        if dm[st] != 0: continue
        name = x.group(3) or x.group(4)
        if x.group(3):
            p = m.find('(', x.end())
            if p < 0: continue
            pc = close_of(m, p)
            b = body_start(m, pc + 1)
            if b < 0: continue
            end = close_of(m, b) + 1
            kind = 'fn'
        else:
            j = x.end()
            while j < len(m) and m[j] != ';':
                if m[j] in '([{': j = close_of(m, j)
                j += 1
            end = j + 1
            kind = 'const'
        out[name] = {'name': name, 'text': src[st:end], 'm': m[st:end], 'start': st, 'end': end, 'kind': kind, 'exported': bool(x.group(1))}
    return out, m


def line_of(src, pos): return src.count('\n', 0, pos) + 1


def doc_before(src, pos):
    """JSDoc /** … */ или // перед позицией (описание поля или функции)."""
    k = pos
    while k > 0 and src[k - 1] in ' \t': k -= 1
    if k > 0 and src[k - 1] == '\n': k -= 1
    head = src[:k].rstrip()
    if head.endswith('*/'):
        a = head.rfind('/**')
        if a < 0: a = head.rfind('/*')
        if a >= 0 and '\n' not in head[head.rfind('\n', 0, a) + 1:a].strip():
            t = head[a + 3:-2]
            t = re.sub(r'(?m)^\s*\*\s?', '', t).strip()
            return re.sub(r'\s+', ' ', t)
    lines = []
    for ln in reversed(head.split('\n')):
        s = ln.strip()
        if s.startswith('//'): lines.insert(0, s[2:].strip())
        else: break
    return ' '.join(lines)


IMPORT_RE = re.compile(r'import\s+(type\s+)?(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from\s+[\'"]([^\'"]+)[\'"]')


def imports(src):
    out = {}
    for x in IMPORT_RE.finditer(src):
        if x.group(1): continue
        mod = x.group(5)
        if x.group(2): out[x.group(2)] = (mod, '*')
        elif x.group(4): out[x.group(4)] = (mod, 'default')
        else:
            for part in x.group(3).split(','):
                part = part.strip()
                if not part or part.startswith('type '): continue
                a, _, b = part.partition(' as ')
                out[(b or a).strip()] = (mod, a.strip())
    return out


IDENT_RE = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)')


def read(p):
    with open(p, encoding='utf-8') as f: return f.read()


def ts_files(d):
    for root, _, files in os.walk(d):
        for f in sorted(files):
            if f.endswith('.ts') and not f.endswith('.test.ts') and not f.endswith('.d.ts'):
                yield os.path.join(root, f)


# ═════════════ Миграции: представления и функции app.* ═════════════
def migrations(repo, tables):
    views, fns = {}, {}
    mdir = os.path.join(repo, 'packages/db/migrations')
    for f in sorted(os.listdir(mdir)):
        if not f.endswith('.sql'): continue
        s = read(os.path.join(mdir, f))
        for x in re.finditer(r'(?is)create\s+(?:or\s+replace\s+)?view\s+app\.(\w+)(.*?);\s*$', s, re.M):
            body = s[x.start():x.end()]
            views[x.group(1)] = {'sql': body.strip(), 'mig': f[:-4]}
        for x in re.finditer(r'(?is)create\s+(?:or\s+replace\s+)?function\s+app\.(\w+)\s*\(', s):
            st = x.start()
            q = re.search(r'(?is)\bas\s+(\$\w*\$)(.*?)\1', s[st:])
            if not q: continue
            end = st + q.end()
            semi = s.find(';', end)
            fns[x.group(1)] = {'sql': s[st:(semi + 1 if semi >= 0 else end)].strip(), 'mig': f[:-4]}
    for o in list(views.values()) + list(fns.values()):
        o['r'], o['w'] = sql_tables(o['sql'], tables)
    return views, fns


def sql_tables(text, tables, extra=()):
    t = re.sub(r'--[^\n]*', '', text)
    r, w = set(), set()
    names = set(tables) | set(extra)
    for x in re.finditer(r'(?i)\b(from|join|into|update|delete\s+from|table)\s+(?:only\s+)?(?:app\.|public\.)?"?(\w+)"?', t):
        n = x.group(2)
        if n not in names: continue
        kw = x.group(1).lower()
        (w if kw in ('into', 'update') or kw.startswith('delete') else r).add(n)
    return r, w


# ═════════════ Пакет базы ═════════════
class DbPkg:
    def __init__(self, repo, tables):
        self.dir = os.path.join(repo, 'packages/db/src')
        self.tables = tables
        self.files = {}
        self.tbl_ids = {}   # идентификатор объекта Drizzle → имя таблицы или представления
        skip = ('/cli/', '/seed/', 'testing', '/migrate.ts')
        for p in ts_files(self.dir):
            rel = os.path.relpath(p, os.path.join(repo))
            if any(k in p for k in skip): continue
            src = read(p)
            d, m = decls(src)
            self.files[rel] = {'src': src, 'm': m, 'decls': d, 'imp': imports(src)}
            for x in re.finditer(r'export\s+const\s+(\w+)\s*=\s*(?:\w+\.)?(?:pgTable|table)\(\s*[\'"](\w+)[\'"]', src):
                self.tbl_ids[x.group(1)] = x.group(2)
            for x in re.finditer(r'(?:export\s+)?const\s+(\w+)\s*=\s*(?:pgSchema\([^)]*\)|\w+)\s*\.\s*(?:table|view)\(\s*[\'"](\w+)[\'"]', src):
                self.tbl_ids[x.group(1)] = x.group(2)
        # алиасы вида const v = adminUsers;
        for f in self.files.values():
            for x in re.finditer(r'(?m)^const\s+(\w+)\s*=\s*(\w+)\s*;', f['src']):
                if x.group(2) in self.tbl_ids: f.setdefault('alias', {})[x.group(1)] = self.tbl_ids[x.group(2)]
        self.exported = {}
        for rel, f in self.files.items():
            for n, dcl in f['decls'].items():
                if dcl['exported'] and n not in self.exported: self.exported[n] = rel
        self.memo = {}

    def resolve(self, rel, name):
        f = self.files.get(rel)
        if not f: return None
        if name in f['decls']: return (rel, name)
        imp = f['imp'].get(name)
        if imp and imp[0].startswith('.'):
            base = os.path.normpath(os.path.join(os.path.dirname(rel), imp[0]))
            for cand in (base + '.ts', base + '/index.ts'):
                if cand in self.files:
                    nm = imp[1] if imp[1] not in ('*', 'default') else name
                    if nm in self.files[cand]['decls']: return (cand, nm)
                    if nm in self.exported: return (self.exported[nm], nm)
        if name in self.exported and imp: return (self.exported[name], name)
        return None

    def table_of(self, rel, ident):
        f = self.files[rel]
        if ident in f.get('alias', {}): return f['alias'][ident]
        if ident in self.tbl_ids:
            imp = f['imp'].get(ident)
            if ident in f['decls'] or (imp and ('schema' in imp[0] or imp[0].startswith('.'))): return self.tbl_ids[ident]
        return None

    def info(self, rel, name, stack=()):
        """Таблицы (чтение, запись), представления, функции app.*, запросы — по объявлению и всему, что оно вызывает."""
        key = (rel, name)
        if key in self.memo: return self.memo[key]
        if key in stack: return {'r': set(), 'w': set(), 'fns': set(), 'q': [], 'ctx': set()}
        f = self.files[rel]; d = f['decls'][name]
        res = {'r': set(), 'w': set(), 'fns': set(), 'q': [], 'ctx': set()}
        m, t = d['m'], d['text']
        # запись: .insert(x) .update(x) .delete(x)
        for x in re.finditer(r'\.(insert|update|delete)\(\s*([\w$]+)(?:\.([\w$]+))?\s*\)', m):
            tb = self.table_of(rel, x.group(3) or x.group(2)) if not x.group(3) else self.tbl_ids.get(x.group(3))
            if tb: res['w'].add(tb)
        for x in IDENT_RE.finditer(m):
            tb = self.table_of(rel, x.group(1))
            if tb: res['r'].add(tb)
        for x in re.finditer(r'\bschema\.(\w+)', m):
            if x.group(1) in self.tbl_ids: res['r'].add(self.tbl_ids[x.group(1)])
        for k, v in CTX.items():
            if re.search(r'\b' + k + r'\(', m): res['ctx'].add(v)
        # sql`…`
        for x in re.finditer(r'\bsql(?:\.raw)?`', m):
            a = x.end() - 1
            b = m.find('`', a + 1)
            # конец шаблона по маске: первый «`» после содержимого
            j = a + 1
            while j < len(m) and m[j] != '`': j += 1
            raw = t[a + 1:j]
            sq = sql_params(raw)
            rr, ww = sql_tables(sq, self.tables)
            res['r'] |= rr; res['w'] |= ww
            for fx in re.finditer(r'\bapp\.(\w+)\s*\(', sq): res['fns'].add(fx.group(1))
            if re.match(r'(?is)\s*(select|insert|update|delete|with)\b', sq) and len(sq.strip()) > 20:
                res['q'].append({'k': 'sql', 'text': dedent(sq), 'file': rel, 'fn': name, 'line': line_of(f['src'], d['start'] + a)})
        # цепочки Drizzle — фрагмент кода
        if d['kind'] == 'fn':
            for st in statements(d['m'], t):
                if re.search(r'\b(tx|db|this\.db|deps\.db)\s*(\.\s*)?(select|insert|update|delete|execute|query)\b|\.\s*(select|insert|update|delete)\s*\(|\bselectList\w*\(', st[1]) and not re.search(r'\bsql`\s*(select|insert|update|delete|with)\b', st[2], re.I):
                    res['q'].append({'k': 'code', 'text': dedent(st[2]), 'file': rel, 'fn': name, 'line': line_of(f['src'], d['start'] + st[0])})
        seen = set()
        for x in IDENT_RE.finditer(m):
            nm = x.group(1)
            if nm == name or nm in seen: continue
            seen.add(nm)
            # объявления таблиц и представлений Drizzle не обходим: их внешние ключи (created_by → users) — не чтение
            if nm in self.tbl_ids or nm in f.get('alias', {}): continue
            tgt = self.resolve(rel, nm)
            if not tgt or tgt == key or '/schema/' in tgt[0]: continue
            sub = self.info(tgt[0], tgt[1], stack + (key,))
            res['r'] |= sub['r']; res['w'] |= sub['w']; res['fns'] |= sub['fns']; res['ctx'] |= sub['ctx']
            for q in sub['q']:
                if q not in res['q']: res['q'].append(q)
        self.memo[key] = res
        return res


def statements(m, t):
    """Операторы тела функции верхнего уровня (до «;» на своей глубине)."""
    out = []
    b = m.find('{')
    if b < 0: return out
    dm = depth_map(m)
    base = dm[b] + 1
    i = b + 1; st = i
    while i < len(m):
        c = m[i]
        if c in '([{' and dm[i] >= base:
            if c == '{' and dm[i] == base:
                # блок if/for — разбираем внутренности как отдельные операторы
                st = i + 1
                i += 1
                base += 1
                continue
            i = close_of(m, i) + 1
            continue
        if c == '}':
            if base > dm[b] + 1: base -= 1; st = i + 1; i += 1; continue
            break
        if c == ';':
            seg = t[st:i + 1].strip()
            if seg: out.append((st + (len(t[st:i + 1]) - len(t[st:i + 1].lstrip())), m[st:i + 1], seg))
            st = i + 1
        i += 1
    return out


def dedent(s):
    lines = s.strip('\n').split('\n')
    ind = min((len(l) - len(l.lstrip()) for l in lines[1:] if l.strip()), default=0)
    res = [lines[0].strip()] + [l[ind:] if len(l) >= ind else l for l in lines[1:]]
    if len(res) > 40: res = res[:40] + ['…']
    return '\n'.join(res).strip()


def sql_params(raw):
    n = [0]
    out = []; i = 0
    while i < len(raw):
        if raw.startswith('${', i):
            d = 0; j = i + 1
            while j < len(raw):
                if raw[j] == '{': d += 1
                elif raw[j] == '}':
                    d -= 1
                    if d == 0: break
                j += 1
            n[0] += 1
            out.append('$' + str(n[0]))
            i = j + 1
            continue
        out.append(raw[i]); i += 1
    return ''.join(out)


# ═════════════ Схемы Zod (packages/shared/src) ═════════════
HELPERS = {}


class Shared:
    def __init__(self, repo):
        self.decl = {}
        for p in ts_files(os.path.join(repo, 'packages/shared/src')):
            src = read(p)
            d, _ = decls(src)
            for n, x in d.items():
                if x['kind'] == 'const': self.decl.setdefault(n, (src, x, p))
                if n[0].islower(): HELPERS.setdefault(n, x['text'])
        self.memo = {}

    def fields(self, name, depth=0):
        if name in self.memo: return self.memo[name]
        if name not in self.decl or depth > 4: return None
        src, d, _ = self.decl[name]
        expr = d['text'].split('=', 1)[1].strip().rstrip(';')
        self.memo[name] = None
        res = self.expr_fields(expr, src, d['start'] + d['text'].find(expr), depth)
        self.memo[name] = res
        return res

    def expr_fields(self, expr, src, base, depth):
        e = expr.strip()
        m = mask(e)
        # Name.extend({...}) / Name.merge(Other) / Name.pick / omit
        x = re.match(r'([A-Z]\w*)\s*\.(extend|merge|pick|omit|partial|strict)\(', m)
        if x:
            parent = self.fields(x.group(1), depth + 1) or []
            p = m.find('(', x.end() - 1)
            arg = e[p + 1:close_of(m, p)]
            if x.group(2) == 'extend':
                return merge(parent, self.obj_fields(arg, src, base + p + 1, depth))
            if x.group(2) == 'merge':
                return merge(parent, self.fields(arg.strip(), depth + 1) or [])
            if x.group(2) in ('pick', 'omit'):
                keys = set(re.findall(r'(\w+)\s*:\s*true', arg))
                return [f for f in parent if (f['n'] in keys) == (x.group(2) == 'pick')]
            if x.group(2) == 'partial':
                return [dict(f, req=False) for f in parent]
            return parent
        x = re.search(r'z\s*\.\s*(?:strictObject|object|looseObject)\(', m)
        if x and x.start() < 40:
            p = m.find('(', x.start())
            return self.obj_fields(e[p + 1:close_of(m, p)], src, base + p + 1, depth)
        x = re.match(r'(\w+)\(\s*([A-Z]\w*)', m)  # listPageSchema(AdminUser) и подобные обёртки
        if x and x.group(1)[0].islower():
            inner = self.fields(x.group(2), depth + 1)
            if x.group(1).startswith('list'):
                return [{'n': 'items', 't': 'array<' + x.group(2) + '>', 'req': True, 'd': 'Строки страницы'},
                        {'n': 'total', 't': 'number', 'req': True, 'd': 'Всего по фильтру'},
                        {'n': 'page', 't': 'number', 'req': True}, {'n': 'size', 't': 'number | "all"', 'req': True},
                        {'n': 'totals', 't': 'object', 'req': False, 'd': 'Итоги столбцов'},
                        {'n': 'groups', 't': 'array', 'req': False, 'd': 'Группы (если включена группировка)'}]
            return inner
        return None

    def obj_fields(self, body, src, base, depth):
        b = body.strip()
        if b.startswith('{'):
            off = body.find('{') + 1
            mb = mask(body)
            inner = body[off:close_of(mb, body.find('{'))]
            base += off
        elif re.match(r'[A-Z]\w*$', b):
            return self.fields(b, depth + 1) or []
        else:
            return []
        out = []
        mi = mask(inner)
        dm = depth_map(mi)
        i = 0
        while i < len(mi):
            x = re.compile(r'\s*(\.\.\.)?([\'"]?[\w$]+[\'"]?)\s*(:)?').match(mi, i)
            if not x: break
            if x.group(1):  # ...Other.shape
                j = x.end()
                while j < len(mi) and not (mi[j] == ',' and dm[j] == 0): j += 1
                spread = inner[x.start(2):j].strip()
                y = re.match(r'(\w+)', spread)
                if y: out = merge(out, self.fields(y.group(1), depth + 1) or [])
                i = j + 1
                continue
            name = x.group(2).strip('\'"')
            j = x.end()
            while j < len(mi) and not (mi[j] == ',' and dm[j] == 0): j += 1
            val = inner[x.end():j].strip() if x.group(3) else name
            doc = doc_before(src, base + x.start(2)) if src else ''
            out.append(field(name, val, doc))
            i = j + 1
        return out


def merge(a, b):
    names = {f['n'] for f in b}
    return [f for f in a if f['n'] not in names] + b


def field(name, v, doc):
    m = mask(v)
    f = {'n': name, 't': '', 'req': True}
    if re.search(r'\.(optional|nullish|default)\(', m): f['req'] = False
    if re.search(r'\.(nullable|nullish)\(', m): f['null'] = True
    c = []
    x = re.match(r'z\s*\.\s*(?:coerce\s*\.\s*)?(\w+)(?:\s*\.\s*(\w+))?', m)
    if x:
        t = x.group(1)
        if t == 'iso': t = 'string(' + (x.group(2) or '') + ')'
        elif t in ('enum', 'literal'):
            p = v.find('(')
            arg = v[p + 1:close_of(mask(v), p)].strip()
            vals = re.findall(r'[\'"]([^\'"]*)[\'"]', arg)
            if vals: c.append(('одно из: ' if t == 'enum' else 'значение ') + ', '.join(vals[:12]) + (' …' if len(vals) > 12 else ''))
            elif arg: c.append('значения: ' + arg[:60])
        elif t == 'array':
            p = v.find('(')
            arg = v[p + 1:close_of(mask(v), p)].strip()
            y = re.match(r'([A-Z]\w*)', arg) or re.match(r'z\s*\.\s*(\w+)', arg)
            t = 'array<' + (y.group(1) if y else '…') + '>'
        f['t'] = t
    else:
        y = re.match(r'([A-Z][\w]*)', v)
        h = re.match(r'([a-z]\w*)\(', v)
        if h and h.group(1) in HELPERS:
            ht = HELPERS[h.group(1)]
            if re.search(r'\.(optional|nullish|default)\(', ht): f['req'] = False
            z = re.search(r'z\s*\.\s*(?:coerce\s*\.\s*)?(\w+)', ht)
            f['t'] = z.group(1) if z else h.group(1)
        else:
            f['t'] = y.group(1) if y else v[:40]
    for k, lab in (('min', 'не меньше'), ('max', 'не больше'), ('length', 'длина')):
        for z in re.finditer(r'\.' + k + r'\(\s*([\w_.]+)', v): c.append(f'{lab} {z.group(1).replace("_", " ")}')
    if re.search(r'\.int\(', m): c.append('целое')
    if re.search(r'\.uuid\(', m) or f['t'] == 'Uuid': c.append('UUID')
    if re.search(r'\.email\(', m): c.append('почта')
    if re.search(r'\.positive\(', m): c.append('больше 0')
    if re.search(r'\.nonnegative\(', m): c.append('не меньше 0')
    z = re.search(r'\.regex\(', m)
    if z:
        p = z.end() - 1
        c.append('формат ' + v[p + 1:close_of(mask(v), p)].strip()[:80])
    if c: f['c'] = '; '.join(c)
    d = re.search(r'\.describe\(\s*[\'"]([^\'"]+)', v)
    if d: f['d'] = d.group(1)
    elif doc: f['d'] = doc
    return f


def example(fields):
    ex = {}
    for f in fields or []:
        if not f.get('req'): continue
        t = f['t']
        if 'enum' in t and f.get('c'):
            v = f['c'].split(': ', 1)[-1].split(', ')[0]
        elif t in ('string', 'string()') or t.startswith('string'): v = '…'
        elif t in ('number', 'int', 'bigint') or 'Version' in t or t.endswith('Int'): v = 0
        elif t == 'boolean': v = False
        elif t.startswith('array'): v = []
        elif t == 'Uuid' or 'UUID' in f.get('c', ''): v = '00000000-0000-0000-0000-000000000000'
        else: v = None
        ex[f['n']] = v
    return ex


# ═════════════ Маршруты API ═════════════
def obj_prop(m, t, key):
    """Значение свойства key: … верхнего уровня объекта {…} (m — маска t)."""
    dm = depth_map(m)
    for x in re.finditer(r'(?<![\w$])' + re.escape(key) + r'\s*:', m):
        if dm[x.start()] != 1: continue
        j = x.end()
        while j < len(m) and not ((m[j] == ',' or m[j] == '}') and dm[j] <= 1):
            if m[j] in '([{': j = close_of(m, j)
            j += 1
        return t[x.end():j].strip(), x.end()
    return None, -1


LIT = r'(?:\'(?:[^\'\\]|\\.)*\'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)'


def str_val(v):
    """Строковое значение: литерал или несколько литералов через «+»; «as …» после литерала отбрасывается."""
    if not v: return ''
    x = re.match(r'\s*(' + LIT + r'(?:\s*\+\s*' + LIT + r')*)', v, re.S)
    if not x: return ''
    parts = re.findall(LIT, x.group(1), re.S)
    return re.sub(r'\s+', ' ', ''.join(p[1:-1] for p in parts)).strip()


def split_top(t):
    m = mask(t); dm = depth_map(m); out = []; st = 0
    for i, c in enumerate(m):
        if c == ',' and dm[i] == 0: out.append(t[st:i]); st = i + 1
    if t[st:].strip(): out.append(t[st:])
    return [x.strip() for x in out if x.strip()]


def fn_params(ft, fm, fname):
    """Имена параметров функции или стрелки «const name = <T>(a, b) =>»."""
    k = fm.find(fname) + len(fname)
    while k < len(fm) and fm[k] in ' =\t\n': k += 1
    if k < len(fm) and fm[k] == '<':
        dd = 0
        while k < len(fm):
            if fm[k] == '<': dd += 1
            elif fm[k] == '>' and fm[k - 1] != '=':
                dd -= 1
                if dd == 0: break
            k += 1
    q = fm.find('(', k)
    return [re.match(r'\s*(\w+)', a).group(1) for a in split_top(ft[q + 1:close_of(fm, q)]) if re.match(r'\s*(\w+)', a)]


def route_objects(f):
    """(имя маршрута, текст объекта createRoute({…}) с подставленными аргументами фабрики, позиция)."""
    src, d = f['src'], f['decls']
    consts = {}
    for n, x in d.items():
        if x['kind'] != 'const': continue
        v = x['text'].split('=', 1)[1].strip().rstrip(';').strip()
        v = re.sub(r'\s+as\s+const\s*$', '', v)
        if re.fullmatch(LIT, v, re.S) and '${' not in v: consts[n] = v[1:-1]
    def cr_obj(t):
        m = mask(t)
        i = m.find('createRoute(')
        if i < 0: return None
        ob = m.find('{', i)
        return t[ob:close_of(m, ob) + 1] if ob >= 0 else None
    def fparams(fd, fname):
        return fn_params(fd['text'], fd['m'], fname)

    def _unused(fd, fname):
        ft, fm = fd['text'], fd['m']
        k = fm.find(fname) + len(fname)
        while k < len(fm) and fm[k] in ' =\t\n': k += 1
        if k < len(fm) and fm[k] == '<':
            dd = 0
            while k < len(fm):
                if fm[k] == '<': dd += 1
                elif fm[k] == '>' and fm[k - 1] != '=':
                    dd -= 1
                    if dd == 0: break
                k += 1
        q = fm.find('(', k)
        return [re.match(r'\s*(\w+)', a).group(1) for a in split_top(ft[q + 1:close_of(fm, q)]) if re.match(r'\s*(\w+)', a)]

    def call_obj(v, env0, depth):
        """Вызов фабрики → (объект createRoute, подстановки параметров); фабрики могут звать друг друга."""
        vm = mask(v)
        if re.match(r'\s*createRoute\(', vm): return cr_obj(v), env0
        y = re.match(r'\s*(\w+)\s*\(', vm)
        if not y or y.group(1) not in d or depth > 4: return None, None
        fd = d[y.group(1)]
        p = vm.find('(', y.start(1))
        args = split_top(v[p + 1:close_of(vm, p)])
        params = fparams(fd, y.group(1))
        env = {}
        for i2, a in enumerate(args):
            if i2 >= len(params): break
            if a in env0: env[params[i2]] = env0[a]
            elif re.fullmatch(LIT, a, re.S) and '${' not in a: env[params[i2]] = ('str', a[1:-1])
            else: env[params[i2]] = ('code', subst(a, env0, consts) if env0 else a)
        if 'createRoute(' in fd['m']: return cr_obj(fd['text']), env
        for z in re.finditer(r'(?:return|=>)\s*(\w+)\s*\(', fd['m']):
            if z.group(1) in d and z.group(1) != y.group(1):
                return call_obj(fd['text'][z.start(1):], env, depth + 1)
        return None, None

    out = []
    for n, x in d.items():
        if x['kind'] != 'const' or not x['exported']: continue
        v = x['text'].split('=', 1)[1]
        obj, env = call_obj(v, {}, 0)
        if not obj: continue
        out.append((n, subst(obj, env, consts), x['start']))
    return out


def subst(t, env, consts):
    allv = dict(env)
    for k, v in consts.items(): allv.setdefault(k, ('str', v))
    for name, (k, v) in allv.items():
        if k == 'str':
            t = re.sub(r'\$\{\s*' + re.escape(name) + r'\s*\}', lambda _: v, t)
            t = re.sub(r'(?<![\w$.])' + re.escape(name) + r'\s*===\s*([\'"])(\w+)\1\s*\?\s*(' + LIT + r')\s*:\s*(' + LIT + r')',
                       lambda x: x.group(3) if x.group(2) == v else x.group(4), t, flags=re.S)
    for name, (k, v) in env.items():
        rep = repr(v) if k == 'str' else v
        t = re.sub(r'(?m)^(\s*)' + re.escape(name) + r'\s*,', lambda x: x.group(1) + name + ': ' + rep + ',', t)
        t = re.sub(r'(?<=[:(\[,]\s)' + re.escape(name) + r'(?=[\s,)\].])', lambda _: rep, t) if k == 'code' else t
        t = re.sub(r'(\w+\s*:\s*)' + re.escape(name) + r'(?=\s*[,}])', lambda x: x.group(1) + rep, t)
        t = re.sub(r'(?<=[{,])(\s*)' + re.escape(name) + r'(?=\s*[,}])', lambda x: x.group(1) + name + ': ' + rep, t)
        t = re.sub(r'(?<=[(,])(\s*)' + re.escape(name) + r'(?=\s*[,)])', lambda x: x.group(1) + rep, t)
    # константы модуля — и внутри подставленных аргументов, и как «path: P»
    for name, v in consts.items():
        t = re.sub(r'\$\{\s*' + re.escape(name) + r'\s*\}', lambda _: v, t)
        t = re.sub(r'(\w+\s*:\s*)' + re.escape(name) + r'(?=\s*[,}])', lambda x: x.group(1) + repr(v), t)
        t = re.sub(r'(?<=[(,])(\s*)' + re.escape(name) + r'(?=\s*[,)])', lambda x: x.group(1) + repr(v), t)
    return t


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = {k: v for k, _, v in (a[2:].partition('=') for a in sys.argv[1:] if a.startswith('--'))}
    if not args:
        print(__doc__); sys.exit(1)
    repo = os.path.abspath(args[0])
    global PUBLIC_PATHS, PUBLIC_PATTERNS
    sess = read(os.path.join(repo, 'packages/api/src/middleware/session.ts'))
    a = re.search(r'PUBLIC_PATHS\s*=\s*new Set\(\[(.*?)\]\)', sess, re.S)
    if a: PUBLIC_PATHS = set(re.findall(r"'([^']+)'", re.sub(r'//[^\n]*', '', a.group(1))))
    a = re.search(r'PUBLIC_PATTERNS[^=]*=\s*\[(.*?)\];', sess, re.S)
    if a: PUBLIC_PATTERNS = [r.replace('\\/', '/') for r in re.findall(r'/(\^.*?\$)/', re.sub(r'//[^\n]*', '', a.group(1)))]
    schema = json.loads(read(os.path.join(ROOT, 'db/schema.json')))
    tables = {t['name'] for t in schema['tables']}
    commit = opt.get('commit') or subprocess.run(['git', '-C', repo, 'log', '-1', '--format=%h'], capture_output=True, text=True).stdout.strip()
    cdate = opt.get('date') or subprocess.run(['git', '-C', repo, 'log', '-1', '--format=%cs'], capture_output=True, text=True).stdout.strip()
    views, fns = migrations(repo, tables)
    db = DbPkg(repo, tables)
    shared = Shared(repo)
    errs = []

    mods_dir = os.path.join(repo, 'packages/api/src/modules')
    # маршрут → фабрика обработчика (index.ts модулей)
    bind = {}
    for p in ts_files(mods_dir):
        src = read(p)
        for x in re.finditer(r'\.openapi\(\s*(\w+)\s*,\s*(?:(\w+)\(|(async))', src):
            bind[x.group(1)] = x.group(2) or ''
    api_files = {}
    for p in ts_files(mods_dir):
        rel = os.path.relpath(p, repo)
        src = read(p)
        d, m = decls(src)
        api_files[rel] = {'src': src, 'decls': d, 'imp': imports(src), 'm': m}
    handlers = {}
    for rel, f in api_files.items():
        for n, dcl in f['decls'].items():
            if dcl['kind'] == 'fn': handlers.setdefault(n, (rel, dcl))
    # общие ответы (…denied, …listQueryResponses) — константы модулей и errors.ts
    resp_loc, resp_glob = {}, {}
    for p in list(ts_files(os.path.join(repo, 'packages/api/src'))):
        src = read(p)
        rel0 = os.path.relpath(p, repo)
        d, _ = decls(src)
        for n, dcl in d.items():
            if 'description' not in dcl['text'] and 'schema' not in dcl['text']: continue
            rhs = dcl['text'].split('=', 1)[1] if '=' in dcl['text'] else ''
            if dcl['kind'] == 'fn' or re.match(r'\s*(?:<[^=]*>)?\s*\(', mask(rhs)):
                ent = ('f', (fn_params(dcl['text'], dcl['m'], n), dcl['text'], dcl['m']))
            elif dcl['kind'] == 'const': ent = ('c', rhs)
            else: continue
            resp_loc.setdefault(rel0, {})[n] = ent
            resp_glob.setdefault(n, ent)

    rel_now = [None]

    def rlook(n, rel):
        return (resp_loc.get(rel) or {}).get(n) or resp_glob.get(n)

    def call_body(text, rel):
        """name(args) → возвращаемый объект функции с подставленными аргументами."""
        m = mask(text)
        c = re.match(r'\s*(\w+)\s*\(', m)
        e = rlook(c.group(1), rel) if c else None
        if not e or e[0] != 'f': return None
        params, ft, fm = e[1]
        p = m.find('(', c.start(1))
        args = split_top(text[p + 1:close_of(m, p)])
        env = {}
        for i2, a in enumerate(args):
            if i2 < len(params): env[params[i2]] = ('str', str_val(a)) if re.match(r'\s*' + LIT, a, re.S) else ('code', a)
        b = re.search(r'(?:return|=>)\s*\(?\s*\{', fm)
        return subst(ft[b.end() - 1:], env, {}) if b else None

    def one_resp(code, ot):
        om = mask(ot)
        desc, _ = obj_prop(om, ot, 'description')
        sch = re.search(r'schema\s*:\s*([A-Z]\w*)', om) or re.search(r'content\s*:\s*\w+\(\s*([A-Z]\w*)', om)
        if not sch:
            cv = re.search(r'content\s*:\s*(\w+)\s*[,}]', om)
            ee = rlook(cv.group(1), rel_now[0]) if cv else None
            if ee and ee[0] == 'c': sch = re.search(r'schema\s*:\s*([A-Z]\w*)', mask(ee[1]))
        return {'code': code, 'd': str_val(desc), **({'s': sch.group(1)} if sch else {})}

    def resp_codes(text, rel, depth=0):
        """Коды ответов: объект, константа, вызов функции, «...общие» в любом сочетании."""
        out = []
        if depth > 5 or not text: return out
        m = mask(text)
        c = re.match(r'\s*(\w+)\s*(\(|$|[,}\s])', m)
        if c:
            e = rlook(c.group(1), rel)
            if e and e[0] == 'f' and c.group(2) == '(':
                return resp_codes(call_body(text, rel), rel, depth + 1)
            if e and e[0] == 'c' and c.group(2) != '(':
                return resp_codes(e[1], rel, depth + 1)
        b = m.find('{')
        if b < 0: return out
        e = close_of(m, b)
        inner, mi = text[b + 1:e], m[b + 1:e]
        dm = depth_map(mi)
        for x in re.finditer(r'\.\.\.\s*(\w+)', mi):
            if dm[x.start()] != 0: continue
            out += resp_codes(inner[x.start(1):] if mi[x.end():x.end() + 1] == '(' else x.group(1), rel, depth + 1)
        for x in re.finditer(r'(\d{3})\s*:\s*', mi):
            if dm[x.start()] != 0: continue
            k = x.end()
            if mi[k:k + 1] == '{':
                ot = inner[k:close_of(mi, k) + 1]
            elif re.match(r'\w+\s*\(', mi[k:]):
                ot = call_body(inner[k:], rel)
            else:
                y = re.match(r'(\w+)', mi[k:])
                ee = rlook(y.group(1), rel) if y else None
                ot = ee[1] if ee and ee[0] == 'c' else None
            if not ot: continue
            out = [r for r in out if r['code'] != x.group(1)]
            out.append(one_resp(x.group(1), ot))
        return out

    methods = []
    used_schemas = set()
    qpool, qidx = [], {}

    def qref(q):
        k = (q['k'], q['text'], q['file'], q['fn'])
        if k not in qidx:
            qidx[k] = len(qpool)
            qpool.append(q)
        return qidx[k]

    for rel, f in sorted(api_files.items()):
        src, m = f['src'], f['m']
        sec = rel.split('/')[4] if len(rel.split('/')) > 5 else 'system'
        for rvar, ot, xpos in route_objects(f):
            om = mask(ot)
            meth = str_val(obj_prop(om, ot, 'method')[0]).upper()
            path = str_val(obj_prop(om, ot, 'path')[0])
            summ = str_val(obj_prop(om, ot, 'summary')[0])
            desc = str_val(obj_prop(om, ot, 'description')[0])
            mw = obj_prop(om, ot, 'middleware')[0] or ''
            perms = re.findall(r'[\'"](\w+)[\'"]', ' '.join(re.findall(r'require(?:Any)?Permission\(([^)]*)\)', mw)))
            if not perms and 'Permission' in mw: perms = re.findall(r'[\'"](\w+)[\'"]', mw)
            if 'requirePlatformAdmin' in mw: acc = 'admin'
            elif perms: acc = 'perm'
            elif 'requireEmployee' in mw: acc = 'employee'
            else: acc = 'session'
            api_path = '/api' + path.replace('{', ':').replace('}', '')
            pub = re.sub(r'\{[^}]+\}', 'x', path)
            if ('/api' + path) in PUBLIC_PATHS or any(re.match(r, '/api' + pub) for r in PUBLIC_PATTERNS): acc = 'public'
            req, _ = obj_prop(om, ot, 'request')
            rq = {}
            if req:
                rm = mask(req)
                for part in ('params', 'query', 'headers'):
                    v, _ = obj_prop(rm, req, part)
                    if v:
                        nm = re.match(r'([A-Z]\w*)$', v.strip())
                        flds = shared.fields(nm.group(1)) if nm else shared_inline(shared, v)
                        rq[part] = {'s': nm.group(1) if nm else '', 'f': flds or []}
                b, _ = obj_prop(rm, req, 'body')
                if b:
                    sch = re.search(r'schema\s*:\s*([A-Z]\w*)', mask(b)) or re.search(r'^\s*\w+\(\s*([A-Z]\w*)\s*\)', mask(b))
                    ct = re.search(r'[\'"](application/json|multipart/form-data|[\w-]+/[\w.+-]+)[\'"]', b)
                    if sch:
                        flds = shared.fields(sch.group(1)) or []
                        rq['body'] = {'s': sch.group(1), 'ct': ct.group(1) if ct else '', 'f': flds, 'ex': example(flds)}
                    else:
                        inl = re.search(r'schema\s*:\s*(z\s*\.[\s\S]*)', b)
                        flds = shared_inline(shared, inl.group(1)) if inl else []
                        rq['body'] = {'s': '', 'ct': ct.group(1) if ct else '', 'f': flds or [], 'ex': example(flds)}
            resp_t, _ = obj_prop(om, ot, 'responses')
            if not resp_t and re.search(r'[{,]\s*responses\s*[,}]', om): resp_t = 'responses'
            rel_now[0] = rel
            res = sorted(resp_codes(resp_t or '{}', rel), key=lambda r: r['code'])
            for r in res:
                if r.get('s'): used_schemas.add(r['s'])
            for part in rq.values():
                if part.get('s'): used_schemas.add(part['s'])
            # обработчик
            hname = bind.get(rvar)
            calls, ctx, code = [], set(), [{'file': rel, 'fn': rvar, 'line': line_of(src, xpos), 'what': 'Маршрут (createRoute)'}]
            hb = None
            if hname and hname in handlers:
                hrel, hd = handlers[hname]
                hb = hd
                code.append({'file': hrel, 'fn': hname, 'line': line_of(api_files[hrel]['src'], hd['start']), 'what': 'Обработчик'})
                texts = [hd['m']]
                # вспомогательные функции того же файла (один уровень)
                for nm in set(IDENT_RE.findall(hd['m'])):
                    if nm in api_files[hrel]['decls'] and nm != hname and api_files[hrel]['decls'][nm]['kind'] == 'fn':
                        texts.append(api_files[hrel]['decls'][nm]['m'])
                imp = api_files[hrel]['imp']
                for t in texts:
                    for k, v in CTX.items():
                        if re.search(r'\b' + k + r'\(', t): ctx.add(v)
                    for nm in IDENT_RE.findall(t):
                        src_mod = imp.get(nm, ('', ''))[0]
                        if src_mod.startswith('@buhuchet/db') and nm in db.exported and nm not in CTX and nm not in calls:
                            calls.append(nm)
            elif not hname:
                errs.append(f'{rel}: маршрут {rvar} не подключён в .openapi()')
            r_, w_, fnset, qs = set(), set(), set(), []
            for c in calls:
                inf = db.info(db.exported[c], c)
                r_ |= inf['r']; w_ |= inf['w']; fnset |= inf['fns']; ctx |= inf['ctx']
                code.append({'file': db.exported[c], 'fn': c, 'line': line_of(db.files[db.exported[c]]['src'], db.files[db.exported[c]]['decls'][c]['start']), 'what': 'Запрос к базе'})
                for q in inf['q']:
                    if q not in qs: qs.append(q)
            vw = sorted(v for v in r_ if v in views)
            for v in vw:
                r_ |= views[v]['r']
                qs.insert(0, {'k': 'view', 'text': views[v]['sql'], 'file': 'packages/db/migrations/' + views[v]['mig'] + '.sql', 'fn': 'app.' + v, 'line': 0})
            for fn in sorted(fnset):
                if fn in fns:
                    r_ |= fns[fn]['r']; w_ |= fns[fn]['w']
            r_ = {t for t in r_ if t not in views}
            unknown = sorted(t for t in (r_ | w_) if t not in tables)
            for t in unknown: errs.append(f'{meth} {path}: таблицы {t} нет в db/schema.json')
            r_ -= w_
            ql = [qref(q) for q in qs[:14]]
            mid = (meth + ' ' + path)
            methods.append({'id': mid, 'm': meth, 'p': path, 'sec': sec, 'sum': summ, 'desc': desc, 'acc': acc, 'perm': perms,
                            'rate': next((r['d'] for r in res if r['code'] == '429'), ''), 'req': rq, 'res': res,
                            'r': sorted(r_ & tables), 'w': sorted(w_ & tables), 'v': vw, 'fns': sorted(f for f in fnset if f in fns),
                            'ctx': sorted(ctx), 'q': ql, 'code': code, 'h': hname or ''})
    # схемы ответов: поля первого уровня
    schemas = {}
    for s in sorted(used_schemas):
        fl = shared.fields(s)
        if fl is not None: schemas[s] = fl
        # вложенные array<Name>
    for fl in list(schemas.values()):
        for f in fl:
            y = re.match(r'array<([A-Z]\w*)>', f['t'])
            if y and y.group(1) not in schemas:
                sub = shared.fields(y.group(1))
                if sub is not None: schemas[y.group(1)] = sub
    # «${ИМЯ}» в текстах — константы пакетов продукта (числа и строки)
    gconst = {}
    for p in ts_files(os.path.join(repo, 'packages')):
        if '/node_modules/' in p: continue
        for x in re.finditer(r'(?m)^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*(?::\s*\w+\s*)?=\s*(\d[\d_]*|' + LIT + r')\s*(?:as\s+const\s*)?;', read(p)):
            v = x.group(2)
            gconst.setdefault(x.group(1), v.replace('_', '') if v[0].isdigit() else (v[1:-1] if '${' not in v else None))
    def fix(t):
        if not isinstance(t, str): return t
        t = re.sub(r'\$\{\s*([A-Z][A-Z0-9_]+)\s*\}', lambda x: gconst.get(x.group(1)) or x.group(0), t)
        return t.replace('\\`', '`')
    for mt in methods:
        mt['sum'], mt['desc'] = fix(mt['sum']), fix(mt.get('desc'))
        for r in mt['res']: r['d'] = fix(r['d'])
    for fl in schemas.values():
        for f in fl:
            if f.get('d'): f['d'] = fix(f['d'])
    out = {
        'meta': {'file': 'apiDocs.json', 'repo': 'kutya001/Buhuchet.kg', 'branch': 'main', 'commit': commit, 'date': cdate,
                 'built': datetime.now().strftime('%Y-%m-%d %H:%M'), 'tool': 'db/api_snapshot.py', 'methods': len(methods),
                 'schemaVersion': schema['meta'].get('schemaVersion'),
                 'note': 'Снимок собран разбором исходников продукта (код не запускается). Точный SQL — у запросов sql`…`, представлений и функций базы из миграций; цепочки Drizzle — фрагментом кода «Запрос по коду».'},
        'sections': SECTIONS,
        'views': {k: {'mig': v['mig'], 'r': sorted(v['r'])} for k, v in views.items()},
        'fns': {k: {'mig': v['mig'], 'r': sorted(v['r']), 'w': sorted(v['w'])} for k, v in fns.items()},
        'schemas': schemas,
        'sql': [{'k': q['k'], 't': q['text'], 'f': q['file'], 'fn': q['fn'], 'l': q['line']} for q in qpool],
        'methods': sorted(methods, key=lambda x: (x['p'], x['m'])),
    }
    dst = os.path.join(ROOT, 'data/apiDocs.json')
    with open(dst, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Собрано: {dst} — {len(methods)} методов, {len(qpool)} запросов, {len(schemas)} схем, {os.path.getsize(dst) // 1024} КБ; коммит {commit} от {cdate}')
    if errs:
        print('Ошибки проверки:'); [print('  ' + e) for e in errs[:60]]
        if any('нет в db/schema.json' in e for e in errs): sys.exit(2)


def shared_inline(shared, v):
    v = v.strip()
    try:
        return shared.expr_fields(v, '', 0, 0) or []
    except Exception:
        return []


PUBLIC_PATHS = {'/api/health', '/api/cron/tick', '/api/l10n', '/api/auth/login', '/api/auth/login/code', '/api/auth/logout',
                '/api/auth/password-reset', '/api/auth/password-reset/confirm', '/api/leads', '/api/telegram/webhook'}
PUBLIC_PATTERNS = [r'^/api/page/[^/]+/[^/]+(?:/code|/files/[^/]+)?$', r'^/api/landing/videos/[a-z0-9][a-z0-9_-]{0,63}/(?:cover|play|start|watched)$']

if __name__ == '__main__':
    main()
