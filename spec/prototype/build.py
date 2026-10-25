#!/usr/bin/env python3
"""Сборка однофайловой версии прототипа Buhuchet.kg.

Источник — index.html (каркас) + файлы из src/ + данные из data/.
Результат — один самодостаточный HTML: все стили в одном <style>, все скрипты в одном <script>,
копия data/demoDB.json, data/TemDB.json, data/refDB.json, data/gkedDB.json во встроенных блоках db-demo, db-tem, db-ref, db-gked,
библиотека pdf.js из vendor/pdfjs во встроенных блоках vendor-pdf и vendor-pdf-worker (type="text/plain": запускается только при первой загрузке PDF).
Такой файл нужен артефакту claude.ai, файлу tz/Прототип Buhuchet.kg vN.html и открытию с диска.

Запуск из корня репозитория:
    python3 build.py                       → dist/prototype.html
    python3 build.py "путь/к/файлу.html"   → в указанный файл
Нужен только Python 3, без пакетов."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CSS_RE = re.compile(r'<link rel="stylesheet" href="(src/[^"]+\.css)">')
JS_RE = re.compile(r'<script src="(src/[^"]+\.js)"></script>')
DATA = [('demo', 'demoDB.json'), ('tem', 'TemDB.json'), ('ref', 'refDB.json'), ('gked', 'gkedDB.json')]
VENDOR = [('vendor-pdf', 'vendor/pdfjs/pdf.min.js'), ('vendor-pdf-worker', 'vendor/pdfjs/pdf.worker.min.js')]


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf8') as f:
        return f.read()


def data_blocks():
    out = ''
    for id_, name in DATA:
        j = json.loads(read('data/' + name))
        assert j.get('meta', {}).get('file') == name, f'data/{name}: в meta.file другое имя'
        t = json.dumps(j, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
        out += f'<script type="application/json" id="db-{id_}">{t}</script>\n'
    return out


def vendor_blocks():
    out = ''
    for id_, rel in VENDOR:
        s = read(rel)
        assert '</script' not in s.lower() and '<!--' not in s, f'{rel}: в коде есть </script или <!--, встраивать нельзя'
        out += f'<script type="text/plain" id="{id_}">{s}</script>\n'
    return out


def js_body(rel):
    s = read(rel)
    # Каждый файл начинается с 'use strict'; в сборке он один на весь скрипт
    if s.startswith("'use strict';\n"):
        s = s[len("'use strict';\n"):]
    assert '</script' not in s.lower(), f'{rel}: в коде есть </script>, сборка его сломает'
    return s


def build():
    lines = read('index.html').split('\n')
    out, css, js = [], None, None
    for ln in lines:
        m = CSS_RE.fullmatch(ln)
        if m:
            if css is None:
                css = len(out); out.append(None)
                out[css] = '<style>\n'
            out[css] += read(m.group(1))
            continue
        m = JS_RE.fullmatch(ln)
        if m:
            if js is None:
                js = len(out); out.append(None)
                out[js] = data_blocks() + vendor_blocks() + "<script>\n'use strict';\n"
            out[js] += js_body(m.group(1))
            continue
        out.append(ln)
    assert css is not None and js is not None, 'в index.html не найдены подключения src/'
    out[css] += '</style>'
    out[js] += '</script>'
    return '\n'.join(out)


if __name__ == '__main__':
    dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'prototype.html')
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    html = build()
    with open(dst, 'w', encoding='utf8') as f:
        f.write(html)
    print(f'Собрано: {dst} ({len(html.encode("utf8")) // 1024} КБ)')
