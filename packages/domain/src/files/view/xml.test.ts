import { describe, expect, it } from 'vitest';
import {
  attrOf,
  childEl,
  childEls,
  decodeXmlEntities,
  findAll,
  findEl,
  parseXmlTree,
  scanXml,
  textOf,
  ViewError,
} from './xml';
import { xmlView } from './xmlview';

const enc = new TextEncoder();

describe('безопасный XML окна просмотра', () => {
  it('раскрывает только стандартные и числовые сущности', () => {
    expect(decodeXmlEntities('a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos; &#1046; &#x416;')).toBe(
      'a <b> & "c" \'d\' Ж Ж',
    );
    expect(decodeXmlEntities('&xxe; &#0; &#xD800; &#99999999;')).toBe(
      '&xxe; &#0; &#xD800; &#99999999;',
    );
    expect(decodeXmlEntities('без сущностей')).toBe('без сущностей');
  });

  it('внешняя сущность (XXE) не раскрывается и ничего не загружает: DOCTYPE пропущен, &xxe; остался текстом', () => {
    const src = `<?xml version="1.0"?>
<!DOCTYPE r [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> <!ENTITY web SYSTEM "http://evil.example/x"> ]>
<r><a>&xxe;</a><b>&web;</b></r>`;
    const t = parseXmlTree(src);
    expect(t.doctype).toBe(true);
    expect(t.decl).toBe('version="1.0"');
    expect(textOf(childEl(t.root!, 'a'))).toBe('&xxe;');
    expect(textOf(childEl(t.root!, 'b'))).toBe('&web;');
  });

  it('«миллиард смехов» не разрастается', () => {
    const src = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><lolz>&lol3;</lolz>`;
    const t = parseXmlTree(src);
    expect(textOf(t.root!)).toBe('&lol3;');
  });

  it('разбирает CDATA, комментарии, атрибуты с «>» в кавычках и пространства имён', () => {
    const t = parseXmlTree(
      `\ufeff<w:doc xmlns:w="u" w:val='a>b' x="1 &amp; 2"><!-- комм --><w:t><![CDATA[<не тег>]]></w:t><w:e/></w:doc>`,
    );
    expect(t.root!.name).toBe('w:doc');
    expect(attrOf(t.root!, 'val')).toBe('a>b');
    expect(attrOf(t.root!, 'x')).toBe('1 & 2');
    expect(attrOf(t.root!, 'нет')).toBeUndefined();
    expect(textOf(childEl(t.root!, 't'))).toBe('<не тег>');
    expect(childEls(t.root!).map((e) => e.name)).toEqual(['w:t', 'w:e']);
    expect(findEl(t.root!, 'e')?.name).toBe('w:e');
    expect(findAll(t.root!, 't')).toHaveLength(1);
  });

  it('битый XML и слишком глубокая вложенность — ошибка, а не зависание', () => {
    for (const bad of [
      '<a',
      '<a x=1></a>',
      '<a x="1></a>',
      '<!-- конца нет',
      '<![CDATA[ x',
      '<?xml ',
      '<!DOCTYPE a [ ',
      '<a></',
      '< x/>',
    ]) {
      expect(() => parseXmlTree(bad), bad).toThrow(ViewError);
    }
    const deep = '<a>'.repeat(300) + '</a>'.repeat(300);
    expect(() => parseXmlTree(deep)).toThrowError(new ViewError('xml_too_deep'));
    expect(() => parseXmlTree('<a><b/><b/><b/></a>', 2)).toThrowError(new ViewError('xml_too_big'));
  });

  it('обработчик может остановить разбор', () => {
    const seen: string[] = [];
    scanXml('<r><a/><b/><c/></r>', {
      open(n) {
        seen.push(n);
        return n === 'b' ? false : undefined;
      },
    });
    expect(seen).toEqual(['r', 'a', 'b']);
    const texts: string[] = [];
    scanXml('<r>x<a/>y</r>', { text: (t) => (texts.push(t), false) });
    expect(texts).toEqual(['x']);
    const closes: string[] = [];
    scanXml('<r><a></a><b></b></r>', { close: (n) => (closes.push(n), false) });
    expect(closes).toEqual(['a']);
    let pis = 0;
    scanXml('<?php echo 1?><?xml-stylesheet href="x"?><r/>', {
      pi: () => void pis++,
      comment: () => undefined,
    });
    expect(pis).toBe(2);
    scanXml('хвост без тегов', { text: (t) => void expect(t).toBe('хвост без тегов') });
    scanXml('<a b c="1"/>', { open: (_n, a) => void expect(a).toEqual({ c: '1' }) });
  });

  it('окно XML: дерево с атрибутами, пустой текст убран, отметка DOCTYPE и предел элементов', () => {
    const v = xmlView(
      enc.encode(
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE r SYSTEM "http://evil.example/r.dtd"><Отчёт ИНН="0101"><Строка> 1 250,50 </Строка>\n  <Пусто/></Отчёт>`,
      ),
    );
    expect(v.decl).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(v.doctype).toBe(true);
    expect(v.root).toEqual({
      n: 'Отчёт',
      a: [['ИНН', '0101']],
      c: [
        { n: 'Строка', a: [], c: ['1 250,50'] },
        { n: 'Пусто', a: [], c: [] },
      ],
    });
    expect(v.cut).toBe(false);
    const big = xmlView(enc.encode(`<r>${'<i/>'.repeat(25_000)}</r>`));
    expect(big.cut).toBe(true);
    expect(big.root!.c.length).toBe(19_999);
    // Windows-1251: русский текст читается.
    const cp = new Uint8Array([
      0x3c, 0x72, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x72, 0x3e,
    ]);
    expect(xmlView(cp).root!.c).toEqual(['Привет']);
    expect(xmlView(enc.encode('просто текст')).root).toBeNull();
  });
});
