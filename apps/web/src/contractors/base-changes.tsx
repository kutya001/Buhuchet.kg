'use client';

import { ReportPickApplied } from '@buhuchet/shared';
import { Box, buttonClass, CheckRow, Modal, Note, useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import type { BaseChanges } from './contractor-edit';
import { useContractorsRefresh } from './contractor-data';

type Part = 'add' | 'remove';

/**
 * Окно «Основания изменились» после «Изменить» контрагента (прототип modules/report-pick.js, pkBaseDlg;
 * ТЗ «Основания для сквозных отчётов»; docs/deviations.md п. А-7, решение заказчика А): «Включено
 * основание: … Добавить его отчёты?» с галочками и «Добавить», «Выключено основание: … Снять отчёты,
 * которые больше не нужны?» и «Снять» (красная). Сделанная часть превращается в строку «Добавлено: …»
 * или «Снято: …»; когда сделаны обе — окно закрывается. «Не сейчас» — ничего не менять (виды можно
 * добавить и снять потом во вкладке «Подбор отчётов»).
 */
export function BaseChangesDialog({
  changes,
  open,
  onClose,
}: {
  changes: BaseChanges;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const catalog = useQuery(catalogQuery).data;
  const [picked, setPicked] = useState<Record<Part, ReadonlySet<string>>>(() => ({
    add: new Set(changes.add),
    remove: new Set(changes.remove),
  }));
  const [assigned, setAssigned] = useState<readonly string[]>(changes.assigned);
  const [done, setDone] = useState<Partial<Record<Part, string>>>({});
  const [busy, setBusy] = useState(false);
  const want = (changes.add.length ? 1 : 0) + (changes.remove.length ? 1 : 0);
  const short = (code: string) => catalog?.type(code)?.shortName ?? code;
  const bases = (codes: readonly string[]) =>
    codes.map((c) => (catalog?.base(c) ?? c).toLowerCase()).join(', ');

  const toggle = (part: Part, code: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p[part]);
      if (on) next.add(code);
      else next.delete(code);
      return { ...p, [part]: next };
    });

  const apply = async (part: Part) => {
    const chosen = picked[part];
    const codes =
      part === 'add'
        ? [...new Set([...assigned, ...chosen])]
        : assigned.filter((code) => !chosen.has(code));
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id']['report-pick'].$put({
        param: { id: changes.contractorId },
        json: { assigned: [...assigned], codes },
      }),
    );
    setBusy(false);
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    const r = ReportPickApplied.parse(res.data);
    refresh();
    setAssigned(codes);
    const text =
      part === 'add'
        ? t('cp.base.added', { names: r.add.map(short).join(', ') })
        : t('cp.base.removed', { names: r.remove.map(short).join(', ') }) +
          (r.deleted ? t('cp.pick.ui.done_deleted', { n: r.deleted }) : '');
    const next = { ...done, [part]: text };
    setDone(next);
    if (Object.keys(next).length === want) {
      onClose();
      toast(Object.values(next).join('. '), { icon: 'check' });
    }
  };

  const section = (part: Part, title: string, codes: readonly string[]) => {
    if (!codes.length) return null;
    const text = done[part];
    if (text) {
      return (
        <Note key={part} icon="check">
          {text}
        </Note>
      );
    }
    return (
      <Box key={part}>
        <div className="flex flex-col gap-1.5" data-base-part={part}>
          <p className="m-0 font-semibold">{title}</p>
          {codes.map((code) => {
            const type = catalog?.type(code);
            return (
              <CheckRow
                key={code}
                kind="check"
                data-base-type={code}
                checked={picked[part].has(code)}
                onChange={(on) => toggle(part, code, on)}
                label={type?.name ?? code}
              >
                {type ? catalog?.authority(type.authorityCode) : null}
              </CheckRow>
            );
          })}
          <div className="flex justify-end">
            <button
              type="button"
              data-base-go={part}
              className={buttonClass(part === 'add' ? 'cta' : 'danger', 'sm')}
              disabled={busy || picked[part].size === 0}
              onClick={() => void apply(part)}
            >
              {t(part === 'add' ? 'cp.base.add' : 'cp.base.remove')}
            </button>
          </div>
        </div>
      </Box>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('cp.base.title')}
      sub={changes.name}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {Object.keys(done).length ? t('btn.done') : t('cp.base.later')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-base-dialog="">
        {section('add', t('cp.base.on', { bases: bases(changes.on) }), changes.add)}
        {section('remove', t('cp.base.off', { bases: bases(changes.off) }), changes.remove)}
      </div>
    </Modal>
  );
}
