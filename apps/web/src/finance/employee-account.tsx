'use client';

import { formatSom } from '@buhuchet/domain';
import { Box, MiniTable, Note, Plate, Plates } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { openContractorCard } from '../contractors/card-store';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { employeeAccountQuery } from './finance-data';

/*
 * Вкладка «Счёт» карточки сотрудника (задача 2.20; ТЗ «Сотрудники» → «Счёт»; прототип modules/staff.js,
 * вкладка `acc`): баланс счёта, поступления, оплаты налогов, накопленные бонусы и «В разрезе
 * контрагентов» — строка открывает карточку контрагента. Суммы — по контрагентам в области группы
 * «Финансовые операции» (docs/deviations.md п. В-22).
 */

/** Целые сомы на плашке (прототип `fmtM(…, false)`). */
const whole = (tyiyn: number) => formatSom(Math.round(tyiyn / 100) * 100, 'auto');

/** Вкладка видна (прототип empCard `tabs`): «Управлять сотрудниками», «Виртуальные счета», «Учёт оплаты налогов». */
export function useEmployeeAccountOn(): boolean {
  const { access } = useShell();
  return access.can('staff') && access.feature('accounts') && access.feature('taxpay');
}

export function EmployeeAccountTab({ employeeId }: { employeeId: string }) {
  const t = useT();
  const query = useQuery(employeeAccountQuery(employeeId));
  const a = query.data;
  if (query.isError && !a) return <Note tone="bad">{t('fin.acc.load_error')}</Note>;
  if (!a) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-employee-account={employeeId}>
      <Plates>
        <Plate
          id="1"
          icon="wallet"
          color="blue"
          label={t('fin.acc.balance')}
          value={whole(a.balance)}
          unit={t('report.plate.som')}
        />
        <Plate
          id="2"
          icon="dn"
          color="green"
          label={t('fin.acc.received')}
          value={whole(a.received)}
          unit={t('report.plate.som')}
        />
        <Plate
          id="3"
          icon="up"
          color="yellow"
          label={t('fin.acc.paid')}
          value={whole(a.paid)}
          unit={t('report.plate.som')}
        />
        <Plate
          id="4"
          icon="gift"
          color="purple"
          label={t('fin.acc.bonus')}
          value={whole(a.bonus)}
          unit={t('report.plate.som')}
        />
      </Plates>
      <Box title={t('fin.acc.by_cp')}>
        <MiniTable
          label={t('fin.acc.by_cp')}
          empty={t('fin.acc.empty')}
          onOpen={(id) => openContractorCard({ id })}
          columns={[
            { key: 'name', label: t('fin.acc.col.cp') },
            { key: 'received', label: t('fin.acc.col.received'), numeric: true },
            { key: 'paid', label: t('fin.acc.col.paid'), numeric: true },
            { key: 'bonus', label: t('fin.acc.col.bonus'), numeric: true },
            { key: 'rest', label: t('fin.acc.col.rest'), numeric: true },
          ]}
          rows={a.rows.map((x) => ({
            key: x.contractorId,
            cells: {
              name: x.name,
              received: formatSom(x.received),
              paid: formatSom(x.paid),
              bonus: formatSom(x.bonus),
              rest: <b>{formatSom(x.rest)}</b>,
            },
          }))}
        />
        <span className="block text-[11.5px] leading-[1.4] text-faint">{t('fin.acc.hint')}</span>
      </Box>
    </div>
  );
}
