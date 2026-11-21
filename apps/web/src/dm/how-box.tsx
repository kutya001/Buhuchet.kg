'use client';

import { bishkekDate, dmExtHow } from '@buhuchet/domain';
import type { DmTokenHow } from '@buhuchet/shared';
import { Box, Hint, MONO_CLASS } from '@buhuchet/ui';
import { Fragment, useMemo, type ReactNode } from 'react';
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

const PRE =
  'mt-1.5 mb-0 max-h-[280px] overflow-auto whitespace-pre rounded-lg border border-line bg-pane-alt p-2.5 text-[12px] leading-normal';
const SUMMARY = 'cursor-pointer text-[13px] text-muted';
const TIPS = [
  'dm.how.tip_csv',
  'dm.how.tip_limits',
  'dm.how.tip_apps',
  'dm.how.tip_sheets',
] as const;

/**
 * «Как подключить» (доработки 20.11.2026: Витрина данных, блок 6, пункт 6; поток Т, этап 2, П12;
 * прототип `dmHow`): адрес с параметрами по умолчанию и заголовок, пример запроса, пример ответа,
 * подсказки для Excel, Power BI, 1С и скрипт для Google Таблиц. Адрес и столбцы — с сервера (`how`
 * окна токена), `token` — токен целиком в окне выпуска или его начало `bk_…` в окне токена.
 * Пример ответа — по типам столбцов, шаблон не выполняется (docs/deviations.md п. Т-27).
 */
export function HowBox({ how, token }: { how: DmTokenHow; token: string }) {
  const t = useT();
  const word = t('dm.how.sample');
  const x = useMemo(
    () =>
      dmExtHow({ url: how.url, token, columns: how.columns, today: bishkekDate(new Date()), word }),
    [how, token, word],
  );
  const code = `${MONO_CLASS} min-w-0 text-[12.5px] break-all`;
  return (
    <div data-dm-how="">
      <Box title={t('dm.how.title')}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
          <span className="text-[12px] text-muted">{t('dm.how.url')}</span>
          <code className={code} data-dm-how-url="">{`GET ${how.url}`}</code>
          <span className="text-[12px] text-muted">{t('dm.how.header')}</span>
          <code className={code} data-dm-how-header="">{`Authorization: Bearer ${token}`}</code>
        </div>
        <details>
          <summary className={SUMMARY}>{t('dm.how.curl')}</summary>
          <pre className={`${MONO_CLASS} ${PRE}`} data-dm-how-curl="">
            {x.curl}
          </pre>
        </details>
        <details>
          <summary className={SUMMARY}>{t('dm.how.answer')}</summary>
          <pre className={`${MONO_CLASS} ${PRE}`} data-dm-how-sample="">
            {x.sample}
          </pre>
        </details>
        <ul className="my-1 pl-[18px] text-[13px] leading-[1.6]">
          {TIPS.map((key) => (
            <li key={key}>{markedText(t(key))}</li>
          ))}
        </ul>
        <details>
          <summary className={SUMMARY}>{t('dm.how.script')}</summary>
          <pre className={`${MONO_CLASS} ${PRE}`} data-dm-how-script="">
            {x.script}
          </pre>
        </details>
        <Hint>{t('dm.how.note')}</Hint>
      </Box>
    </div>
  );
}
