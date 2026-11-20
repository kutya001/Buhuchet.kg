'use client';

import { formatCount, formatDateRu, formatMomentRu, type ListFilterValue } from '@buhuchet/domain';
import type { AdminStorageSummary } from '@buhuchet/shared';
import {
  Box,
  Hint,
  Icon,
  iconButtonClass,
  MiniTable,
  Note,
  Plate,
  Plates,
  type MiniRow,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { fileSizeText } from '../files/files-data';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { presetHref } from '../lists/preset';
import { useAdminCards } from '../admin/admin-cards';
import { storageSummaryQuery } from './afiles-data';
import {
  barHeight,
  filesCountText,
  gbText,
  mbText,
  monthBars,
  oneDecimal,
  orgFilesFilter,
  pctClass,
  STORE_PRESETS,
  storePlateColors,
} from './afiles-model';
import { useTrashDialog } from './afiles-trash';

type Filters = Readonly<Record<string, ListFilterValue>>;

/** Объём плашки: от 1 ГБ — гигабайтами, меньше — как размер файла (прототип `gbmb`). */
const bigSize = (t: Translate, bytes: number) =>
  bytes >= 1e9 ? gbText(t, bytes) : fileSizeText(t, bytes);

/**
 * Админка → «Файлы» → «Хранилище» (пакет 2, блок 3, пункт 3; прототип `renderAFStore`): плашки —
 * сколько занято и чем, «Ждут удаления» (окно), «Расхождений» (вкладка «Проверка хранилища»), остальные
 * открывают «Все файлы» с фильтром; «Загружено по месяцам» за 12 месяцев; «По организациям» — строка
 * открывает «Все файлы» этой организации.
 */
export function AdminFilesStore() {
  const t = useT();
  const router = useRouter();
  const summary = useQuery(storageSummaryQuery);
  const trash = useTrashDialog();
  const { openOrg, cards } = useAdminCards();
  const s = summary.data;
  const colors = storePlateColors(s);
  const toAll = (filters: Filters) => router.push(presetHref('afiles', 'all', filters));
  const count = (n: number | undefined) => (n === undefined ? '' : formatCount(n));
  const size = (bytes: number | undefined) => (bytes === undefined ? '' : fileSizeText(t, bytes));
  return (
    <div data-afiles-store="" className="flex flex-col gap-3.5">
      {summary.isError ? <Note tone="bad">{t('afiles.load_error')}</Note> : null}
      <Plates static>
        <Plate
          id="tot"
          icon="db"
          color="blue"
          label={t('afiles.plate.tot')}
          value={s ? bigSize(t, s.total.bytes) : ''}
          sub={s ? filesCountText(t, s.total.n) : undefined}
          onClick={() => toAll(STORE_PRESETS.tot)}
        />
        <Plate
          id="org"
          icon="folder"
          color="green"
          label={t('afiles.plate.org')}
          value={s ? bigSize(t, s.org.bytes) : ''}
          sub={s ? filesCountText(t, s.org.n) : undefined}
          onClick={() => toAll(STORE_PRESETS.org)}
        />
        <Plate
          id="sent"
          icon="clip"
          color={colors.sent}
          label={t('afiles.plate.sent')}
          value={count(s?.sent.n)}
          sub={size(s?.sent.bytes)}
          onClick={() => toAll(STORE_PRESETS.sent)}
        />
        <Plate
          id="lead"
          icon="send"
          color="purple"
          label={t('afiles.plate.lead')}
          value={count(s?.lead.n)}
          sub={size(s?.lead.bytes)}
          onClick={() => toAll(STORE_PRESETS.lead)}
        />
        <Plate
          id="pf"
          icon="film"
          color="purple"
          label={t('afiles.plate.pf')}
          value={size(s?.platform.bytes)}
          sub={t('afiles.plate.pf_sub')}
        />
        <Plate
          id="rcpt"
          icon="coins"
          color="blue"
          label={t('afiles.plate.rcpt')}
          value={count(s?.rcpt.n)}
          sub={size(s?.rcpt.bytes)}
          onClick={() => toAll(STORE_PRESETS.rcpt)}
        />
        <Plate
          id="trash"
          icon="trash"
          color={colors.trash}
          label={t('afiles.plate.trash')}
          value={count(s?.trash.n)}
          sub={s ? t(s.trash.n ? 'afiles.plate.trash_sub' : 'afiles.plate.trash_none') : undefined}
          onClick={() => trash.open()}
        />
        <Plate
          id="diff"
          icon="alert"
          color={colors.diff}
          label={t('afiles.plate.diff')}
          value={count(s?.diff)}
          sub={
            s
              ? s.checkedAt
                ? t('afiles.plate.diff_at', { at: formatMomentRu(new Date(s.checkedAt)) })
                : t('afiles.plate.diff_never')
              : undefined
          }
          onClick={() => router.push(presetHref('afiles', 'check'))}
        />
      </Plates>
      <Box title={t('afiles.months.title')}>
        {s ? <MonthsChart t={t} months={s.months} /> : null}
      </Box>
      <Box title={t('afiles.orgs.title')}>
        <div data-afiles-orgs="">
          {s ? (
            <OrgsTable
              t={t}
              orgs={s.orgs}
              onFiles={(id) => toAll(orgFilesFilter(id))}
              onOrg={(id) => openOrg(id, null, 'files')}
            />
          ) : null}
        </div>
        <Hint>{t('afiles.orgs.hint')}</Hint>
      </Box>
      {trash.node}
      {cards}
    </div>
  );
}

/** Столбики «Загружено по месяцам · МБ» (прототип `actChart`). */
function MonthsChart({ t, months }: { t: Translate; months: AdminStorageSummary['months'] }) {
  const bars = monthBars(t, months);
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div
      data-afiles-months=""
      role="img"
      aria-label={t('afiles.months.value')}
      className="flex h-[150px] items-stretch gap-[3px] max-md:h-[120px] max-md:gap-px"
    >
      {bars.map((b) => (
        <div
          key={b.key}
          data-afiles-month={b.key}
          title={b.title}
          className="group grid min-w-0 flex-1 grid-rows-[1fr_16px] justify-items-center"
        >
          <div className="flex w-full items-end justify-center border-b border-line">
            <i
              className="block w-full max-w-[34px] rounded-t bg-info opacity-85 group-hover:opacity-100"
              style={{ height: `${barHeight(b.value, max)}%` }}
            />
          </div>
          <span className="text-[10.5px] leading-4 whitespace-nowrap text-faint">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** «По организациям» (прототип `af-orgs`): больше места — выше; «Открыть организацию» — кнопкой строки. */
function OrgsTable({
  t,
  orgs,
  onFiles,
  onOrg,
}: {
  t: Translate;
  orgs: AdminStorageSummary['orgs'];
  onFiles: (orgId: string) => void;
  onOrg: (orgId: string) => void;
}) {
  const sorted = [...orgs].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'ru'));
  const rows: MiniRow[] = sorted.map((o) => ({
    key: o.orgId,
    cells: {
      name: <span className="font-semibold">{o.name}</span>,
      n: formatCount(o.n),
      mb: mbText(o.bytes),
      lim: o.limitBytes === null ? '—' : gbText(t, o.limitBytes),
      pct:
        o.pct === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className={pctClass(o.pct)}>{t('afiles.mem.pct', { pct: oneDecimal(o.pct) })}</span>
        ),
      last: o.last ? formatDateRu(o.last) : '—',
      act: (
        <button
          type="button"
          data-afiles-open-org={o.orgId}
          className={iconButtonClass()}
          title={t('afiles.act.org')}
          aria-label={t('afiles.act.org')}
          onClick={(e) => {
            e.stopPropagation();
            onOrg(o.orgId);
          }}
        >
          <Icon name="building" size="sm" />
        </button>
      ),
    },
    blank: [...(o.limitBytes === null ? ['lim'] : []), ...(o.last ? [] : ['last'])],
  }));
  return (
    <MiniTable
      label={t('afiles.orgs.title')}
      columns={[
        { key: 'name', label: t('afiles.orgs.col.name'), width: 260 },
        { key: 'n', label: t('afiles.orgs.col.n'), numeric: true, width: 100 },
        { key: 'mb', label: t('afiles.orgs.col.mb'), numeric: true, width: 120 },
        { key: 'lim', label: t('afiles.orgs.col.lim'), numeric: true, width: 130 },
        { key: 'pct', label: t('afiles.orgs.col.pct'), numeric: true, width: 110 },
        { key: 'last', label: t('afiles.orgs.col.last'), width: 150 },
        { key: 'act', label: '', actions: true, width: 56 },
      ]}
      rows={rows}
      empty={t('afiles.empty')}
      onOpen={onFiles}
    />
  );
}
