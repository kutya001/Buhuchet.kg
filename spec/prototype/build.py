#!/usr/bin/env python3
"""Сборка однофайловой версии прототипа Buhuchet.kg.

Источник — index.html (каркас) + файлы из src/ + данные из data/.
Результат — один самодостаточный HTML: все стили в одном <style>, все скрипты в одном <script>,
копия data/demoDB.json, data/TemDB.json, data/refDB.json, data/gkedDB.json во встроенных блоках db-demo, db-tem, db-ref, db-gked,
библиотека pdf.js из vendor/pdfjs во встроенных блоках vendor-pdf и vendor-pdf-worker (type="text/plain": запускается только при первой загрузке PDF).
Такой файл нужен артефакту claude.ai, файлу tz/Прототип Buhuchet.kg vN.html и открытию с диска.

Демо-версия для сайта (ТЗ «Лендинг» → «Демо-организация»): тот же файл с признаком BU_DEMO — сразу программа демо-организации
без входа и Админки, свои ключи хранилища браузера, запрет исходящих запросов (Content-Security-Policy: connect-src 'none'),
шрифты из vendor/fonts встроены, без индексации поисковиками. «Оставить заявку» и «Вернуться на сайт» ведут на адреса --lead и --site.

Запуск из корня репозитория:
    python3 build.py                       → dist/prototype.html и dist/demo.html
    python3 build.py "путь/к/файлу.html"   → только прототип, в указанный файл
    python3 build.py --demo "путь.html" [--site=/ --lead=/#lead]   → только демо-версия (для buhuchet.kg/demo)
Нужен только Python 3, без пакетов."""
import base64, json, os, re, sys

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


FONT_RE = re.compile(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts\.(?:googleapis|gstatic)\.com[^"]*"(?: crossorigin)?>\n')
TITLE_RE = re.compile(r'<title>[^<]*</title>')


def fonts_inline():
    css = read('vendor/fonts/fonts.css')
    def b64(m):
        with open(os.path.join(ROOT, 'vendor/fonts', m.group(1)), 'rb') as f:
            return 'url(data:font/woff2;base64,' + base64.b64encode(f.read()).decode() + ')'
    return '<style>' + re.sub(r'url\(([\w.-]+\.woff2)\)', b64, css) + '</style>\n'


def demo(html, site, lead):
    ref = json.loads(read('data/refDB.json'))
    loading = next((x['ru'] for x in ref.get('localization', []) if x.get('key') == 'land.demo.loading'), 'Загружаем демо-организацию…')
    cfg = json.dumps({'site': site, 'lead': lead}, ensure_ascii=False).replace('<', '\\u003c')
    head = ('<meta charset=utf8><meta name="robots" content="noindex,nofollow">'
            '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">'
            f'<script>var BU_DEMO={cfg};</script>')
    assert html.count('<meta charset=utf8>') == 1, 'в index.html нет <meta charset=utf8>'
    html = html.replace('<meta charset=utf8>', head, 1)
    n = len(FONT_RE.findall(html))
    assert n == 3, f'ожидались 3 подключения Google Fonts, найдено {n}'
    html = FONT_RE.sub('', html)
    html = TITLE_RE.sub('<title>Демо-организация — Buhuchet.kg</title>\n' + fonts_inline().rstrip('\n'), html, count=1)
    boot = ('<div id="demo-boot" role="status" style="position:fixed;inset:0;z-index:200;display:grid;place-items:center;'
            'background:hsl(34 34% 90%);color:hsl(31 45% 24%);font:500 15px -apple-system,BlinkMacSystemFont,sans-serif">'
            f'<style>@media (prefers-color-scheme:dark){{#demo-boot{{background:hsl(29 16% 12%)!important;color:hsl(34 39% 76%)!important}}}}[data-theme=dark] #demo-boot{{background:hsl(29 16% 12%)!important;color:hsl(34 39% 76%)!important}}[data-theme=light] #demo-boot{{background:hsl(34 34% 90%)!important;color:hsl(31 45% 24%)!important}}</style>{loading}</div>')
    assert html.count('</head><body>') == 1
    html = html.replace('</head><body>', '</head><body>\n' + boot, 1)
    assert 'fonts.googleapis' not in html and 'fonts.gstatic' not in html
    return html


def write(dst, html):
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, 'w', encoding='utf8') as f:
        f.write(html)
    print(f'Собрано: {dst} ({len(html.encode("utf8")) // 1024} КБ)')


if __name__ == '__main__':
    args = sys.argv[1:]
    opt = {k: v for k, _, v in (a[2:].partition('=') for a in args if a.startswith('--') and '=' in a)}
    pos = [a for a in args if not a.startswith('--')]
    site, lead = opt.get('site', 'prototype.html#landing'), opt.get('lead', 'prototype.html#landing/lead')
    html = build()
    if '--demo' in args:
        write(pos[0] if pos else os.path.join(ROOT, 'dist', 'demo.html'), demo(html, site, lead))
    elif pos:
        write(pos[0], html)
    else:
        write(os.path.join(ROOT, 'dist', 'prototype.html'), html)
        write(os.path.join(ROOT, 'dist', 'demo.html'), demo(html, site, lead))
