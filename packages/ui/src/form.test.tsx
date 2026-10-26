import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Box, Field, fieldControl, FormGrid, inputClass, KeyValues, Note, Pill } from './form';
import {
  columnWidth,
  isShortField,
  packFormCells,
  packKvItems,
  type FieldInfo,
  type FormCell,
} from './form-pack';

const field = (over: Partial<FieldInfo> = {}): FormCell => ({
  field: { full: false, labelWidth: 60, block: false, controls: [{ kind: 'fixed' }], ...over },
});
const text = field({ controls: [{ kind: 'text' }] });

describe('компоновка форм на телефоне (ТЗ «Компоновка форм на телефоне»)', () => {
  // Телефон 390 px: форма в окне шириной около 358 px, колонка — (358 − 14) / 2 = 172 px.
  const column = columnWidth(358, 14);

  it('ширина колонки — половина формы без промежутка', () => {
    expect(column).toBe(172);
  });

  it('короткие поля: дата, число, сумма, галочка с короткой подписью, короткий список, переключатель', () => {
    const short = (controls: FieldInfo['controls']) =>
      isShortField({ full: false, labelWidth: 50, block: false, controls }, column);
    expect(short([{ kind: 'fixed' }])).toBe(true);
    expect(short([{ kind: 'check', labelWidth: 80 }])).toBe(true);
    expect(short([{ kind: 'check', labelWidth: null }])).toBe(true);
    expect(short([{ kind: 'select', multiple: false, widestOption: 120 }])).toBe(true);
    expect(short([{ kind: 'segments', widths: [40, 50] }])).toBe(true);
  });

  it('длинные поля: текст, длинная подпись галочки, длинный список, многострочное, на всю ширину, длинная подпись', () => {
    const base: FieldInfo = { full: false, labelWidth: 50, block: false, controls: [] };
    expect(isShortField({ ...base, controls: [{ kind: 'text' }] }, column)).toBe(false);
    expect(isShortField({ ...base, controls: [{ kind: 'check', labelWidth: 150 }] }, column)).toBe(
      false,
    );
    expect(
      isShortField(
        { ...base, controls: [{ kind: 'select', multiple: false, widestOption: 140 }] },
        column,
      ),
    ).toBe(false);
    expect(
      isShortField(
        { ...base, controls: [{ kind: 'select', multiple: true, widestOption: 10 }] },
        column,
      ),
    ).toBe(false);
    expect(
      isShortField({ ...base, controls: [{ kind: 'segments', widths: [60, 60, 60] }] }, column),
    ).toBe(false);
    expect(isShortField({ ...base, block: true, controls: [{ kind: 'fixed' }] }, column)).toBe(
      false,
    );
    expect(isShortField({ ...base, full: true, controls: [{ kind: 'fixed' }] }, column)).toBe(
      false,
    );
    // Подпись в половине строки — в одну строку; не помещается — поле длинное.
    expect(isShortField({ ...base, labelWidth: 200, controls: [{ kind: 'fixed' }] }, column)).toBe(
      false,
    );
    expect(isShortField(base, column)).toBe(false);
  });

  it('пара коротких полей остаётся в строке; если одно длинное — оба на всю ширину', () => {
    expect(packFormCells([field(), field()], column)).toEqual(['half', 'half']);
    expect(packFormCells([field(), text], column)).toEqual(['full', 'full']);
    expect(packFormCells([text, text], column)).toEqual(['full', 'full']);
  });

  it('строки собираются, как на ПК: поле «на всю ширину» и не-поле занимают строку, одинокое поле — на всю ширину', () => {
    // ПК: [дата | число] [на всю ширину] [дата | —] — третья строка с одним полем.
    expect(packFormCells([field(), field(), field({ full: true }), field()], column)).toEqual([
      'half',
      'half',
      'full',
      'full',
    ]);
    // Порядок не меняется: короткое после длинного в соседней строке пару не образует.
    expect(packFormCells([text, field(), field(), field()], column)).toEqual([
      'full',
      'full',
      'half',
      'half',
    ]);
    expect(packFormCells([field(), 'wide', field()], column)).toEqual(['full', 'full', 'full']);
  });

  it('пустая ячейка выравнивания на телефоне скрыта, поле рядом с ней — на всю ширину', () => {
    // «Мой профиль» → «Смена пароля»: [Текущий пароль | пусто] [Новый пароль | Повторите].
    expect(packFormCells([text, 'spacer', text, text], column)).toEqual([
      'full',
      'hidden',
      'full',
      'full',
    ]);
    expect(packFormCells([field(), 'spacer', field(), field()], column)).toEqual([
      'full',
      'hidden',
      'half',
      'half',
    ]);
  });

  it('карточка просмотра: два подряд коротких значения — в строку, длинное — на всю ширину', () => {
    const short = { block: false, lineWidths: [40, 90] };
    const long = { block: false, lineWidths: [40, 240] };
    const table = { block: true, lineWidths: [10] };
    expect(packKvItems([short, short, long, short, short, short], column)).toEqual([
      'half',
      'half',
      'full',
      'half',
      'half',
      'full',
    ]);
    expect(packKvItems([short, table, short], column)).toEqual(['full', 'full', 'full']);
  });
});

describe('поля и блоки форм (прототип controls.css, cards.css)', () => {
  it('поле: подпись связана с полем ввода, звёздочка обязательного, подсказка и ошибка', () => {
    const html = renderToStaticMarkup(
      <Field
        id="pf-p1"
        label="Новый пароль"
        required
        hint="Не короче 8 символов"
        error="Пароль короче 8 символов"
      >
        {(control) => <input type="password" className={inputClass()} {...control} />}
      </Field>,
    );
    expect(html).toContain('<label for="pf-p1"');
    expect(html).toContain('Новый пароль<span aria-hidden="true" class="text-danger"> *</span>');
    expect(html).toContain(
      'id="pf-p1" aria-invalid="true" aria-required="true" aria-describedby="pf-p1-hint pf-p1-err"',
    );
    expect(html).toContain(
      '<div id="pf-p1-hint" data-hint="" class="text-[11.5px] leading-[1.4] text-faint">Не короче 8 символов</div>',
    );
    expect(html).toMatch(
      /<div id="pf-p1-err" class="[^"]*text-danger"><svg[^>]*>.*<\/svg><span>Пароль короче 8 символов<\/span>/,
    );
  });

  it('поле без подсказки и ошибки — без aria-describedby; на всю ширину помечено для компоновки', () => {
    expect(fieldControl({ id: 'lg-login' })).toEqual({ id: 'lg-login' });
    const html = renderToStaticMarkup(
      <Field id="lg-login" label="Логин" full>
        <input id="lg-login" />
      </Field>,
    );
    expect(html).toContain(
      'data-field="" data-full="" class="flex min-w-0 flex-col gap-[5px] col-span-full"',
    );
    expect(html).not.toContain('-err');
  });

  it('поле ввода: рамка, кольцо при фокусе, красная рамка с ошибкой, моноширинный вариант', () => {
    const cls = inputClass();
    expect(cls).toContain('border-line');
    expect(cls).toContain('focus:border-line-strong');
    expect(cls).toContain('aria-[invalid=true]:border-danger');
    expect(cls).not.toContain('font-mono');
    expect(inputClass({ mono: true })).toContain('font-mono');
    expect(inputClass({ multiline: true })).toContain('min-h-[90px]');
  });

  it('форма: две колонки, на телефоне до компоновки — одна; компоновка раскладывает по атрибутам', () => {
    const html = renderToStaticMarkup(
      <FormGrid>
        <Field id="a" label="А">
          <input id="a" />
        </Field>
        <div />
      </FormGrid>,
    );
    expect(html).toContain('grid grid-cols-2 gap-x-3.5 gap-y-[13px] max-[600px]:grid-cols-1');
    expect(html).toContain('max-[600px]:data-packed:grid-cols-2');
    expect(html).toContain('[&amp;&gt;[data-pack=half]]:col-span-1');
    expect(html).toContain('[&amp;&gt;[data-pack=hidden]]:hidden');
  });

  it('пары «подпись — значение», блок с заголовком, заметка и метка', () => {
    const kv = renderToStaticMarkup(
      <KeyValues
        items={[
          { id: 'fio', label: 'ФИО', value: 'Сыдыков Эркин' },
          { id: 'login', label: 'Логин', value: 'erkin', mono: true },
        ]}
      />,
    );
    expect(kv).toContain('<dt class="text-[11.5px] font-semibold text-faint">ФИО</dt>');
    expect(kv).toMatch(/<dd data-kv-value="" class="[^"]*font-mono[^"]*">erkin<\/dd>/);

    const box = renderToStaticMarkup(
      <Box title="Основное" actions={<button type="button">Добавить</button>}>
        <p>…</p>
      </Box>,
    );
    expect(box).toContain(
      'uppercase"><span class="grow">Основное</span><button type="button">Добавить</button></h3>',
    );

    const note = renderToStaticMarkup(
      <Note tone="warn" alert>
        Telegram не привязан
      </Note>,
    );
    expect(note).toContain('role="alert"');
    expect(note).toContain('bg-caution-bg text-caution');
    expect(renderToStaticMarkup(<Note>Демо</Note>)).not.toContain('role=');

    const pill = renderToStaticMarkup(
      <Pill tone="ok" icon="check">
        Привязан
      </Pill>,
    );
    expect(pill).toContain('bg-ok-bg text-ok');
    expect(pill).toContain('</svg>Привязан</span>');
  });
});
