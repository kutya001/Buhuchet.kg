"""Проверка db/schema.json после правки: python3 db/check.py

Ищет то, что сломает страницу db/index.html или запутает читателя:
дубли таблиц и полей, ссылки на несуществующие таблицы и поля, разные типы
у ссылки и цели, неизвестные типы, таблицы без ключа и без русских названий.
"""
import json
import sys
from pathlib import Path

db = json.loads((Path(__file__).parent / 'schema.json').read_text(encoding='utf-8'))
tables = {t['name']: t for t in db['tables']}
enums = {e['name'] for e in db['enums']}
groups = {g['id'] for g in db['groups']}
errors = []

if len(tables) != len(db['tables']):
    errors.append('есть таблицы с одинаковым именем')
for t in db['tables']:
    where = t['name']
    for key in ('ru', 'desc', 'rls'):
        if not t.get(key):
            errors.append(f'{where}: пусто поле таблицы «{key}»')
    if t['group'] not in groups:
        errors.append(f'{where}: нет группы {t["group"]}')
    if t['status'] not in db['meta']['statuses']:
        errors.append(f'{where}: неизвестный статус {t["status"]}')
    names = [c['name'] for c in t['columns']]
    if len(set(names)) != len(names):
        errors.append(f'{where}: поля повторяются')
    if not any(c.get('pk') for c in t['columns']):
        errors.append(f'{where}: нет первичного ключа')
    for c in t['columns']:
        col = f'{where}.{c["name"]}'
        if not c.get('ru'):
            errors.append(f'{col}: нет русского названия')
        if c['type'] not in db['types'] and c['type'] not in enums:
            errors.append(f'{col}: тип {c["type"]} не описан ни в types, ни в enums')
        if 'fk' in c:
            to_table, to_col = c['fk'].split('.')
            target = tables.get(to_table)
            if not target:
                errors.append(f'{col}: ссылка на несуществующую таблицу {to_table}')
                continue
            target_col = next((x for x in target['columns'] if x['name'] == to_col), None)
            if not target_col:
                errors.append(f'{col}: ссылка на несуществующее поле {c["fk"]}')
            elif target_col['type'] != c['type']:
                errors.append(f'{col}: тип {c["type"]}, а у {c["fk"]} — {target_col["type"]}')

for f in db.get('functions', []):
    for key in ('name', 'ru', 'desc', 'migration'):
        if not f.get(key):
            errors.append(f'функция {f.get("name", "?")}: пусто поле «{key}»')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
fk = sum(1 for t in db['tables'] for c in t['columns'] if 'fk' in c)
actual = sum(1 for t in db['tables'] if t['status'] == 'actual')
print(f'Всё в порядке: таблиц {len(tables)} (есть в базе {actual}), '
      f'полей {sum(len(t["columns"]) for t in db["tables"])}, связей {fk}, перечислений {len(enums)}.')
