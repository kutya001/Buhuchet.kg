'use client';

import { ReportPickApplied, ReportPickPreview } from '@buhuchet/shared';
import { ConfirmDialog, useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import { useContractorsRefresh } from './contractor-data';

/**
 * «Снять» у заметки «По статусу «…» не нужны» в блоке «Сдаёт отчёты» карточки (ТЗ «Подбор отчётов»;
 * прототип pkNotNeededNote с `data-nnrm` → pkConfirm): сервер считает, сколько отчётов удалится, окно
 * спрашивает, как «Применить» во вкладке «Подбор отчётов» (pkConfirm: «Сохранить», красная), и снимает
 * виды тем же методом; итог — «Снято отчётов: N».
 */
export function useNotNeededRemove(
  contractorId: string,
  assigned: readonly string[],
): { onRemove: (codes: string[]) => void; dialog: ReactNode } {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const catalog = useQuery(catalogQuery).data;
  const [ask, setAsk] = useState<{ codes: string[]; text: string; open: boolean } | null>(null);
  const names = (codes: readonly string[]) =>
    codes.map((c) => catalog?.type(c)?.shortName ?? c).join(', ');
  const keep = (codes: readonly string[]) => assigned.filter((c) => !codes.includes(c));

  const onRemove = (codes: string[]) => {
    void (async () => {
      const res = await callApi(() =>
        api.api.contractors[':id']['report-pick'].preview.$post({
          param: { id: contractorId },
          json: { codes: keep(codes) },
        }),
      );
      if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
      const { deleted, kept } = ReportPickPreview.parse(res.data);
      setAsk({
        codes,
        open: true,
        text:
          `${t('cp.pick.ui.confirm_remove')} ` +
          t('cp.pick.ui.confirm_remove_text', { names: names(codes), n: deleted }) +
          (kept > 0 ? t('cp.pick.ui.confirm_kept', { n: kept }) : '') +
          t('cp.pick.ui.confirm_past'),
      });
    })();
  };

  const remove = async (codes: readonly string[]) => {
    const res = await callApi(() =>
      api.api.contractors[':id']['report-pick'].$put({
        param: { id: contractorId },
        json: { assigned: [...assigned], codes: keep(codes) },
      }),
    );
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true, icon: 'alert' });
    const done = ReportPickApplied.parse(res.data);
    toast(t('cp.card.asg.removed', { n: done.remove.length }), { icon: 'check' });
  };

  const dialog = ask ? (
    <ConfirmDialog
      open={ask.open}
      onClose={() => setAsk({ ...ask, open: false })}
      title={t('cp.pick.ui.confirm_title')}
      text={ask.text}
      ok={t('btn.save')}
      danger
      onConfirm={() => void remove(ask.codes)}
    />
  ) : null;
  return { onRemove, dialog };
}
