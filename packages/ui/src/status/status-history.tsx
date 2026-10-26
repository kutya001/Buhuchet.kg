import type { StatusTone } from '@buhuchet/domain';
import type { ReactNode } from 'react';
import { Pill } from '../form';
import { Icon } from '../icon';
import type { IconName } from '../icons';
import { StatusPill } from './status-scale';

/**
 * «История статусов» (ТЗ «История статусов», «Статусы на телефоне»; прототип `statusHistHtml`, стили
 * `table.sh`, `.sh-sum`, `.sh-d`): когда, было → стало, кто, комментарий или причина, файл и сколько
 * запись была в статусе; сверху — новые. На ПК — таблица, на телефоне — записи одна под другой без
 * прокрутки вбок; под ними — сколько всего в каждом статусе. Записи не правятся и не удаляются.
 */

export interface StatusHistoryRow {
  key: string;
  /** «ДД.ММ.ГГГГ ЧЧ:ММ» по Бишкеку. */
  at: string;
  /** Название прежнего статуса; пусто — первая запись. */
  from?: string | null | undefined;
  to: { label: string; tone: StatusTone; icon: IconName };
  /** Кто изменил: краткое ФИО или «Система». */
  actor: string;
  /** Комментарий или причина. */
  note?: string | null | undefined;
  /** Откат — отдельная пометка «Откат» перед причиной. */
  rollback?: boolean | undefined;
  /** Файл; ссылка — только относительная или `https:` (иначе имя без ссылки). */
  file?: { name: string; href?: string | undefined } | null | undefined;
  /** Сколько в статусе: «3 дня», «меньше часа». */
  duration: string;
  /** Текущий статус — «· сейчас». */
  now?: boolean | undefined;
}

export interface StatusHistoryLabels {
  when: string;
  status: string;
  who: string;
  note: string;
  inStatus: string;
  /** «сейчас». */
  now: string;
  /** «Откат». */
  rollback: string;
  /** На телефоне: «Кто: Тилекова А.». */
  whoLine: (name: string) => string;
}

const TH = 'border-b border-line px-2 py-1.5 text-left text-[11.5px] font-[650] text-faint';
const TD =
  'border-b border-line px-2 py-[7px] align-top whitespace-normal [tr:last-child>&]:border-b-0 max-md:block max-md:border-0 max-md:p-0 max-md:[overflow-wrap:anywhere]';

export function StatusHistory({
  rows,
  totals,
  title,
  labels,
}: {
  /** По порядку: сначала старые (показываются сверху новые). */
  rows: readonly StatusHistoryRow[];
  /** Сколько всего в каждом статусе: «В работе: 3 дня». */
  totals: readonly { label: string; duration: string }[];
  /** Название, если историй несколько («Сдача», «Оплата»). */
  title?: string | undefined;
  labels: StatusHistoryLabels;
}) {
  if (rows.length === 0) return null;
  return (
    <div data-status-history="" className="min-w-0 [&+&]:mt-3.5">
      {title ? <div className="mb-1.5 text-[12.5px] font-[650]">{title}</div> : null}
      {/* Узкая карточка на ПК — таблица прокручивается вбок, как `.tbl-wrap`; на телефоне — список. */}
      <div className="overflow-x-auto max-md:overflow-visible">
        <table className="w-full table-fixed border-collapse text-[13px] tabular-nums max-md:block">
          <thead className="max-md:hidden">
            <tr>
              <th className={`${TH} w-32`}>{labels.when}</th>
              <th className={`${TH} w-[220px]`}>{labels.status}</th>
              <th className={`${TH} w-[110px]`}>{labels.who}</th>
              <th className={TH}>{labels.note}</th>
              <th className={`${TH} w-[120px] text-right`}>{labels.inStatus}</th>
            </tr>
          </thead>
          <tbody className="max-md:block max-md:w-full">
            {[...rows].reverse().map((row) => {
              const empty = !row.note && !row.file && !row.rollback;
              return (
                <tr
                  key={row.key}
                  className="max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-2.5 max-md:gap-y-1 max-md:border-b max-md:border-line max-md:py-[9px] max-md:first:pt-0.5 max-md:last:border-b-0"
                >
                  <td className={`${TD} max-md:order-1 max-md:text-[12px] max-md:text-muted`}>
                    {row.at}
                  </td>
                  <td className={`${TD} max-md:order-3 max-md:col-span-full max-md:text-[13px]`}>
                    {row.from ? <span className="text-faint">{row.from} → </span> : null}
                    <StatusPill {...row.to} size="sm" />
                  </td>
                  <td
                    className={`${TD} max-md:order-4 max-md:col-span-full max-md:text-[12px] max-md:text-muted`}
                  >
                    <span className="max-md:hidden">{row.actor}</span>
                    <span className="md:hidden">{labels.whoLine(row.actor)}</span>
                  </td>
                  <td
                    className={`${TD} max-md:order-5 max-md:col-span-full max-md:text-[13px] ${empty ? 'max-md:hidden' : ''}`}
                  >
                    <Note row={row} rollback={labels.rollback} />
                  </td>
                  <td
                    className={`${TD} text-right max-md:order-2 max-md:text-[12px] max-md:text-muted`}
                  >
                    {row.duration}
                    {row.now ? <span className="text-faint"> · {labels.now}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted max-md:gap-x-3">
        {totals.map((total) => (
          <span key={total.label}>
            {total.label}: <b>{total.duration}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ссылка на файл — путь сайта или `https:`; `data:`, `javascript:` и адреса без схемы не открываются. */
export function safeHref(href: string | undefined): boolean {
  if (!href) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\');
  return /^https:\/\//i.test(href);
}

/** Комментарий, пометка «Откат» и файл; пусто — «—». */
function Note({ row, rollback }: { row: StatusHistoryRow; rollback: string }) {
  const parts: ReactNode[] = [];
  if (row.rollback)
    parts.push(
      <Pill key="rollback" tone="caution" size="sm" icon="history">
        {rollback}
      </Pill>,
    );
  if (row.note) parts.push(<span key="note">{row.note}</span>);
  if (row.file) {
    const name = (
      <>
        <Icon name="clip" size="sm" />
        {row.file.name}
      </>
    );
    parts.push(
      safeHref(row.file.href) ? (
        <a
          key="file"
          href={row.file.href}
          className="inline-flex items-center gap-1 rounded bg-label-bg px-1.5 text-[10.5px] leading-[17px] font-[650] text-label"
        >
          {name}
        </a>
      ) : (
        <span
          key="file"
          className="inline-flex items-center gap-1 rounded bg-label-bg px-1.5 text-[10.5px] leading-[17px] font-[650] text-label"
        >
          {name}
        </span>
      ),
    );
  }
  if (parts.length === 0) return <span className="text-faint">—</span>;
  return <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">{parts}</span>;
}

/**
 * Свёрнутая «История статусов» (карточка контрагента, прототип `.sh-d`): строка со значком истории и
 * стрелкой справа, не ниже 32 px, без подсветки при нажатии; раскрывается по нажатию.
 */
export function StatusHistoryDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-[5px] px-0.5 py-1.5 text-[13px] font-semibold text-muted select-none [-webkit-tap-highlight-color:transparent] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Icon name="history" size="sm" />
        <span className="flex-1">{title}</span>
        <Icon
          name="down"
          size="sm"
          className="transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}
