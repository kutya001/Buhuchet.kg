'use client';

import { bishkekDate, dmExtHow, dmHowFormat, type DmHowWords } from '@buhuchet/domain';
import type { DmTokenHow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  MiniTable,
  MONO_CLASS,
  Note,
  type IconName,
  type MiniRow,
} from '@buhuchet/ui';
import { Fragment, useCallback, useMemo, type ReactNode } from 'react';
import { useCopyText } from '../kb/video/video-copy';
import { useT } from '../l10n/provider';

/** Подсказка словаря: `**…**` — жирным, `` `…` `` — моноширинным (как в прототипе `dmHow`). */
export function markedText(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter((part) => part !== '')
    .map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
        return <b key={i}>{part.slice(2, -2)}</b>;
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        return (
          <span key={i} className={MONO_CLASS}>
            {part.slice(1, -1)}
          </span>
        );
      return <Fragment key={i}>{part}</Fragment>;
    });
}

/** Шаг словаря: на месте `{имя}` — кнопка-копия из `slots`, остальное — как `markedText`. */
function stepText(text: string, slots: Readonly<Record<string, ReactNode>> = {}): ReactNode[] {
  return text
    .split(/(\{[a-z_]+\})/)
    .filter((part) => part !== '')
    .map((part, i) => {
      const name = part.startsWith('{') && part.endsWith('}') ? part.slice(1, -1) : '';
      return (
        <Fragment key={i}>
          {name && Object.hasOwn(slots, name) ? slots[name] : markedText(part)}
        </Fragment>
      );
    });
}

const MONO = 'font-mono [font-feature-settings:"calt"_1,"zero"_1]';
const PRE = `${MONO} m-0 max-h-[280px] overflow-auto whitespace-pre rounded-lg border border-line bg-pane-alt p-2.5 text-[12px] leading-normal`;
const SUMMARY = 'cursor-pointer text-[13px] text-muted';
const LABEL = 'text-[12px] text-muted';
const STEPS = 'mt-1 mb-2 list-decimal pl-5 text-[13px] leading-[1.6] [&>li]:my-1';
const CHIPS = 'my-1 flex flex-wrap gap-1.5';
const H4 = 'mt-2.5 mb-0.5 text-[13px] font-semibold';

/** Копирует значение и говорит об этом: `code` — «Код скопирован», иначе «Скопировано». */
type Copy = (value: string, code?: boolean) => void;

/**
 * Адрес, параметр или заголовок текстом: нажатие копирует (прототип `dmCp`, `.dm-c`). Значение живёт в
 * компоненте, а не в атрибуте разметки: среди значений — токен целиком.
 */
function CopyChip({
  value,
  mark,
  tip,
  copy,
}: {
  value: string;
  mark?: string;
  tip: string;
  copy: Copy;
}) {
  return (
    <button
      type="button"
      title={tip}
      data-dm-how-chip={mark ?? ''}
      className={`${MONO} inline-flex max-w-full cursor-copy items-center gap-1.5 rounded-md border border-line bg-pane-alt px-2 py-[3px] text-left align-middle text-[12.5px] leading-[1.4] break-all text-inherit transition-colors hover:border-line-strong active:bg-row-hover`}
      onClick={() => copy(value)}
    >
      {value}
      <Icon name="copy" size="sm" className="text-muted" />
    </button>
  );
}

/** Код программы: нажатие на код (если в нём ничего не выделено) или «Скопировать код» (прототип `dmCode`). */
function CodeBlock({
  text,
  mark,
  tip,
  label,
  copy,
}: {
  text: string;
  mark: string;
  tip: string;
  label: string;
  copy: Copy;
}) {
  return (
    <div className="relative mt-1.5">
      {/* Нажатие на код — удобство для мыши; с клавиатуры код копирует кнопка рядом. */}
      <pre
        className={`${PRE} cursor-copy`}
        title={tip}
        data-dm-how-code={mark}
        onClick={() => {
          if (String(window.getSelection() ?? '') === '') copy(text, true);
        }}
      >
        {text}
      </pre>
      <button
        type="button"
        className={`${buttonClass('default', 'sm')} absolute top-1.5 right-[18px]`}
        data-dm-how-copy={mark}
        onClick={() => copy(text, true)}
      >
        <Icon name="copy" size="sm" />
        {label}
      </button>
    </div>
  );
}

/** Блок одной программы: значок, название и пояснение; шаги раскрываются (прототип `.dm-app`). */
function AppBlock({
  id,
  icon,
  title,
  sub,
  open = false,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group/app rounded-lg border border-line bg-raised"
      data-dm-how-app={id}
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-[14px] group-open/app:border-b group-open/app:border-line [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 flex-none place-items-center rounded-lg bg-pane-alt text-muted">
          <Icon name={icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <b>{title}</b>
          <span className="text-[12px] leading-[1.4] text-muted">{sub}</span>
        </span>
        <Icon
          name="right"
          size="sm"
          className="text-muted transition-transform group-open/app:rotate-90"
        />
      </summary>
      <div className="min-w-0 px-3.5 pt-2 pb-3.5">{children}</div>
    </details>
  );
}

/**
 * «Как подключить» (доработки 20.11.2026: Витрина данных, блок 6, пункт 6; поток Т, этап 2, П12;
 * просьба заказчика 21.11.2026, прототип v160 `dmHow`): общее — ссылка CSV, адрес, заголовок и
 * параметры по отдельности; ниже блок на каждую программу — Excel Power Query, Excel VBA, Google
 * Таблицы, Power BI, 1С, «Другие сервисы» — с шагами и тем, что куда вставить. Любой адрес, параметр,
 * заголовок и код копируется нажатием. Адрес, параметры и столбцы — с сервера (`how` окна токена);
 * `token` — токен целиком в окне выпуска или null в окне уже выпущенного токена: его в системе нет, в
 * коде стоит «bk_ВАШ_ТОКЕН» и подсказка вставить полный. Пример ответа — по типам столбцов, шаблон не
 * выполняется (docs/deviations.md п. Т-27).
 */
export function HowBox({ how, token }: { how: DmTokenHow; token: string | null }) {
  const t = useT();
  const copier = useCopyText();
  const words = useMemo<DmHowWords>(
    () => ({
      sample: t('dm.how.sample'),
      placeholder: t('dm.how.placeholder'),
      token: t('dm.how.code.token'),
      tokenSheets: t('dm.how.code.token_sheets'),
      params: t('dm.how.code.params'),
      paramsRefresh: t('dm.how.code.params_refresh'),
      paramsCells: t('dm.how.code.params_cells'),
      query: t('dm.how.code.query'),
      load: t('dm.how.code.load'),
      error: t('dm.how.code.error'),
      data1c: t('dm.how.code.data_1c'),
      row1c: t('dm.how.code.row_1c'),
      rows: t('dm.how.code.rows'),
      fmtDate: t('dm.how.fmt.date'),
      fmtMonth: t('dm.how.fmt.month'),
      fmtYear: t('dm.how.fmt.year'),
    }),
    [t],
  );
  const x = useMemo(
    () =>
      dmExtHow({
        base: how.base,
        token,
        params: how.params,
        columns: how.columns,
        today: bishkekDate(new Date()),
        words,
      }),
    [how, token, words],
  );
  const { copy: copyText } = copier;
  const copied = t('dm.how.copied');
  const codeCopied = t('dm.how.code_copied');
  const copy = useCallback<Copy>(
    (value, code = false) => void copyText(value, code ? codeCopied : copied),
    [copyText, copied, codeCopied],
  );
  const tip = t('dm.how.copy_tip');
  const chip = (value: string, mark?: string) => (
    <CopyChip value={value} mark={mark} tip={tip} copy={copy} />
  );
  const code = (text: string, mark: string) => (
    <CodeBlock
      text={text}
      mark={mark}
      tip={t('dm.how.copy_code_tip')}
      label={t('dm.how.copy_code')}
      copy={copy}
    />
  );
  const has = x.pairs.length > 0;
  const first = x.pairs[0];
  // «Части URL-адреса» и заголовок — одни и те же шаги у Excel «Из Интернета» и Power BI «Интернет».
  const urlParts = (
    <li>
      {t('dm.how.parts')}
      <div className={CHIPS}>
        {x.parts.map((part) => (
          <Fragment key={part}>{chip(part)}</Fragment>
        ))}
      </div>
    </li>
  );
  const header = (
    <li>{stepText(t('dm.how.hdr'), { name: chip('Authorization'), value: chip(x.bearer) })}</li>
  );
  const paramRows: MiniRow[] = how.params.map((p) => {
    const format = dmHowFormat(p.type, words);
    return {
      key: p.code,
      cells: {
        param: chip(p.code),
        value: p.value ? chip(p.value) : <span className="text-faint">—</span>,
        what: (
          <>
            {p.name}
            {format ? (
              <>
                , <span className={MONO_CLASS}>{format}</span>
              </>
            ) : null}
            {p.required ? null : (
              <>
                {' · '}
                <span className="text-faint">{t('dm.how.optional')}</span>
              </>
            )}
          </>
        ),
      },
      blank: p.value ? [] : ['value'],
    };
  });
  return (
    <div data-dm-how="">
      <Box title={t('dm.how.title')}>
        <Hint>{t('dm.how.tap')}</Hint>
        {token === null ? (
          <Note tone="warn" icon="alert">
            <span data-dm-how-part="">{stepText(t('dm.how.part'), { token: chip(x.token) })}</span>
          </Note>
        ) : null}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
          <span className={LABEL}>{t('dm.how.csv')}</span>
          <span>{chip(x.csv, 'csv')}</span>
          <span className={LABEL}>{t('dm.how.url')}</span>
          <span>{chip(how.base, 'url')}</span>
          <span className={LABEL}>{t('dm.how.header')}</span>
          <span className="flex flex-wrap gap-1.5">
            {chip('Authorization', 'header')}
            {chip(x.bearer, 'bearer')}
          </span>
        </div>
        {how.params.length ? (
          <div data-dm-how-params="">
            <MiniTable
              label={t('dm.how.col.param')}
              empty="—"
              phoneCards={false}
              columns={[
                { key: 'param', label: t('dm.how.col.param') },
                { key: 'value', label: t('dm.how.col.value') },
                { key: 'what', label: t('dm.how.col.what') },
              ]}
              rows={paramRows}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <AppBlock id="pq" icon="table" title={t('dm.how.pq.title')} sub={t('dm.how.pq.sub')} open>
            <h4 className={H4}>{t('dm.how.pq.h1')}</h4>
            <ol className={STEPS}>
              <li>{t('dm.how.pq.a1')}</li>
              {urlParts}
              {header}
              <li>{t('dm.how.pq.a4')}</li>
              <li>{t('dm.how.pq.a5')}</li>
            </ol>
            <h4 className={H4}>{t('dm.how.pq.h2')}</h4>
            <ol className={STEPS}>
              <li>{t('dm.how.pq.b1')}</li>
              <li>{t('dm.how.pq.b2')}</li>
              {first && x.cell ? (
                <>
                  <li>{t('dm.how.pq.b3')}</li>
                  <li>
                    {stepText(t('dm.how.pq.b4'), { name: chip(first.code) })}
                    <div className={CHIPS}>{chip(x.cell)}</div>
                    {t('dm.how.pq.b4_privacy')}
                  </li>
                </>
              ) : null}
            </ol>
            {code(x.powerQuery, 'pq')}
          </AppBlock>
          <AppBlock id="vba" icon="list" title={t('dm.how.vba.title')} sub={t('dm.how.vba.sub')}>
            <ol className={STEPS}>
              <li>{t('dm.how.vba.a1')}</li>
              {has ? (
                <li>{stepText(t('dm.how.vba.a2'), { cell: chip('Range("B1").Text') })}</li>
              ) : null}
              <li>{stepText(t('dm.how.vba.a3'), { macro: chip('LoadBuhuchet') })}</li>
            </ol>
            {code(x.vba, 'vba')}
          </AppBlock>
          <AppBlock id="gs" icon="board" title={t('dm.how.gs.title')} sub={t('dm.how.gs.sub')}>
            <ol className={STEPS}>
              <li>{t('dm.how.gs.a1')}</li>
              <li>{stepText(t('dm.how.gs.a2'), { fn: chip('load') })}</li>
              <li>{t('dm.how.gs.a3')}</li>
              {has ? <li>{t('dm.how.gs.a4')}</li> : null}
            </ol>
            {code(x.sheets, 'gs')}
          </AppBlock>
          <AppBlock id="pbi" icon="chart" title={t('dm.how.pbi.title')} sub={t('dm.how.pbi.sub')}>
            <ol className={STEPS}>
              <li>{t('dm.how.pbi.a1')}</li>
              {urlParts}
              {header}
              <li>{t('dm.how.pbi.a4')}</li>
            </ol>
            <h4 className={H4}>{t('dm.how.pbi.h2')}</h4>
            <ol className={STEPS}>
              <li>{t('dm.how.pbi.b1')}</li>
              {first ? <li>{stepText(t('dm.how.pbi.b2'), { name: chip(first.name) })}</li> : null}
            </ol>
            {code(x.powerQuery, 'pbi')}
          </AppBlock>
          <AppBlock id="1c" icon="building" title={t('dm.how.c1.title')} sub={t('dm.how.c1.sub')}>
            <ol className={STEPS}>
              <li>{t('dm.how.c1.a1')}</li>
              {has ? <li>{t('dm.how.c1.a2')}</li> : null}
              <li>{stepText(t('dm.how.c1.a3'), { page: chip('page=2') })}</li>
            </ol>
            {code(x.code1c, '1c')}
          </AppBlock>
          <AppBlock id="oth" icon="link" title={t('dm.how.oth.title')} sub={t('dm.how.oth.sub')}>
            <ol className={STEPS}>
              <li>
                {stepText(t(has ? 'dm.how.oth.a1_params' : 'dm.how.oth.a1'), {
                  url: chip(how.base),
                  params: x.pairs.map((p, i) => (
                    <Fragment key={p.code}>
                      {i ? ' ' : null}
                      {chip(p.pair)}
                    </Fragment>
                  )),
                })}
              </li>
              <li>
                {stepText(t('dm.how.oth.a2'), {
                  name: chip('Authorization'),
                  value: chip(x.bearer),
                })}
              </li>
              <li>
                {stepText(t('dm.how.oth.a3'), {
                  csv: chip('format=csv'),
                  limit: chip('limit=5000'),
                  page: chip('page=2'),
                })}
              </li>
            </ol>
            {code(x.curl, 'curl')}
            {code(x.python, 'py')}
          </AppBlock>
        </div>
        <details>
          <summary className={SUMMARY}>{t('dm.how.answer')}</summary>
          <pre className={`${PRE} mt-1.5`} data-dm-how-sample="">
            {x.sample}
          </pre>
        </details>
        <ul className="my-1 list-disc pl-[18px] text-[13px] leading-[1.6]">
          <li>{t('dm.how.limits')}</li>
        </ul>
        <Hint>{t('dm.how.note')}</Hint>
      </Box>
      {copier.node}
    </div>
  );
}
