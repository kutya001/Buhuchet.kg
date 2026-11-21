'use client';

import type { OrgPolicy } from '@buhuchet/shared';
import { Box, CheckRow, ConfirmDialog, HelpTip, Hint } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../l10n/provider';
import { extApiQuery } from './org-data';

/**
 * «Моя организация» → «Настройки» → «Внешний доступ по API» (доработки 20.11.2026: Витрина данных,
 * блок 5, пункт 9; этап 3, П2; прототип v155 `dmApiBox`, `dmApiMount`): выдавать ли данные внешним
 * программам по API-токенам. Сначала выключен; меняет только владелец, в демо-организации —
 * никто. Выключение при действующих токенах — сначала вопрос «Выключить внешний доступ?» с их числом.
 * Сохраняется сразу — `save` (поле `extApi` учётной политики с её версией, запись в историю
 * организации).
 */
export function ExtApiBox({
  policy,
  own,
  busy,
  save,
}: {
  policy: OrgPolicy;
  own: boolean;
  busy: boolean;
  save: (on: boolean) => Promise<void>;
}) {
  const t = useT();
  const info = useQuery(extApiQuery);
  const [ask, setAsk] = useState(0);
  const demo = info.data?.demo ?? false;
  const live = info.data?.activeTokens ?? 0;
  const off = !own || busy || demo || !info.data;

  const toggle = (on: boolean) => {
    if (!on && live > 0) return setAsk(live);
    void save(on);
  };

  return (
    <div data-ext-api="">
      <Box title={t('dm.api.title')}>
        <CheckRow
          data-ext-api-switch=""
          checked={policy.extApi}
          disabled={off}
          onChange={toggle}
          label={t('dm.api.label')}
          tip={<HelpTip label={t('dm.api.title')} text={t('dm.api.tip')} />}
        >
          <Hint>
            {t(demo ? 'dm.api.demo' : own ? 'dm.api.own' : 'dm.api.other')}
            {live > 0 ? ` ${t('dm.api.live', { n: live })}` : null}
          </Hint>
        </CheckRow>
      </Box>
      <ConfirmDialog
        open={ask > 0}
        onClose={() => setAsk(0)}
        title={t('dm.api.off_title')}
        text={t('dm.api.off_text', { n: ask })}
        ok={t('dm.api.off_ok')}
        danger
        onConfirm={() => void save(false)}
      />
    </div>
  );
}
