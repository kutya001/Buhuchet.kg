'use client';

import { inputClass, type FieldControl } from '@buhuchet/ui';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { sqlLineNumbers, sqlTokens, type SqlTokenKind } from './sql-highlight';

/** Цвета подсветки — из темы, в светлой и тёмной (прототип `.sq-k`, `.sq-t`, `.sq-p`, `.sq-s`, `.sq-n`, `.sq-c`). */
const TOKEN_CLASS: Record<SqlTokenKind, string | undefined> = {
  plain: undefined,
  keyword: 'text-info',
  table: 'text-violet',
  param: 'text-caution',
  string: 'text-ok',
  number: 'text-danger',
  comment: 'text-muted',
};

/** Что подсвеченная копия берёт у поля, чтобы буквы легли одна в одну (прототип `dmHlBind`). */
const COPIED = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontFeatureSettings',
  'lineHeight',
  'letterSpacing',
  'tabSize',
] as const;

/**
 * Поле «Запрос» окна шаблона с подсветкой SQL и номерами строк (просьба заказчика 21.11.2026; прототип
 * v161 `dmHl`, `dmHlBind`, `.dm-sqlb`). Поле ввода остаётся обычным `textarea`: его текст прозрачный,
 * под ним — подсвеченная копия того же текста, слева — номера строк; прокручиваются вместе. Подсветка
 * меняет только вид: значение, проверка и сохранение запроса — как раньше.
 */
export function SqlField({
  control,
  value,
  maxLength,
  readOnly,
  onChange,
}: {
  control: FieldControl;
  value: string;
  maxLength: number;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const numbers = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => sqlTokens(value), [value]);
  const lines = useMemo(() => sqlLineNumbers(value), [value]);

  const sync = useCallback(() => {
    const ta = area.current;
    if (!ta) return;
    if (copy.current) {
      copy.current.scrollTop = ta.scrollTop;
      copy.current.scrollLeft = ta.scrollLeft;
    }
    if (numbers.current) numbers.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  // Те же отступы и шрифт, что у поля: на телефоне они другие, поэтому — и при смене размера.
  useLayoutEffect(() => {
    const ta = area.current;
    const pre = copy.current;
    const side = gutter.current;
    if (!ta || !pre || !side) return;
    const fit = () => {
      const cs = getComputedStyle(ta);
      for (const k of COPIED) pre.style[k] = cs[k];
      side.style.paddingTop = cs.paddingTop;
      side.style.fontFamily = cs.fontFamily;
      side.style.fontSize = cs.fontSize;
      side.style.fontFeatureSettings = cs.fontFeatureSettings;
      side.style.lineHeight = cs.lineHeight;
      sync();
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(fit);
    watch.observe(ta);
    return () => watch.disconnect();
  }, [sync]);

  // Новый текст (ввод, вставка, «Отменить») — копия встаёт туда же, куда прокручено поле.
  useLayoutEffect(sync, [value, sync]);

  return (
    <div className="relative min-w-0" data-dm-ed-sql="">
      <div
        ref={gutter}
        aria-hidden="true"
        data-dm-ed-lines=""
        className="pointer-events-none absolute top-px bottom-px left-px z-[2] w-[38px] overflow-hidden rounded-l-lg border-r border-line bg-field text-right whitespace-pre text-faint"
      >
        <div ref={numbers} className="pr-1.5">
          {lines}
        </div>
      </div>
      <pre
        ref={copy}
        aria-hidden="true"
        data-dm-ed-hl=""
        className="pointer-events-none absolute inset-0 m-0 overflow-hidden rounded-lg border border-solid border-transparent bg-field whitespace-pre text-ink"
      >
        {tokens.map((token, i) => (
          <span key={i} className={TOKEN_CLASS[token.kind]} data-sql={token.kind}>
            {token.text}
          </span>
        ))}
        {'\n'}
      </pre>
      <textarea
        {...control}
        ref={area}
        className={`${inputClass({ multiline: true, mono: true })} relative z-[1] block !min-h-[240px] resize-y overflow-auto !bg-transparent !pl-[46px] !text-[12.5px] leading-[1.5] whitespace-pre text-transparent caret-ink [-webkit-text-fill-color:transparent] [tab-size:2] selection:bg-info-bg selection:[-webkit-text-fill-color:transparent] max-md:!min-h-[180px]`}
        value={value}
        maxLength={maxLength}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        readOnly={readOnly}
        data-dm-ed-query=""
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
      />
    </div>
  );
}
