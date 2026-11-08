'use client';

import { videoTime } from '@buhuchet/domain';
import type { VideoOption } from '@buhuchet/shared';
import { ActionMenu, useToast, type MenuPlace } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../l10n/provider';
import { videoOptionsQuery } from './video-data';

/**
 * Выбор видео в редакторах новостей и статей (прототип `vidPickMenu`): меню всех не удалённых видео —
 * название, вид, модуль, длительность и «не опубликовано»; видео нет — подсказка «добавьте его во
 * вкладке «Видео»».
 */
export function useVideoPick() {
  const t = useT();
  const toast = useToast();
  const options = useQuery(videoOptionsQuery);
  const [menu, setMenu] = useState<{ place: MenuPlace; run: (v: VideoOption) => void } | null>(
    null,
  );
  const open = (anchor: HTMLElement, run: (v: VideoOption) => void) => {
    if (!options.data?.items.length) return toast(t('video.pick.none'), { icon: 'film' });
    setMenu({ place: { anchor }, run });
  };
  const node = menu ? (
    <ActionMenu
      label={t('video.pick')}
      place={menu.place}
      onClose={() => setMenu(null)}
      items={(options.data?.items ?? []).map((v) => ({
        id: v.id,
        label: v.title,
        icon: 'film',
        sub: `${t(`video.kind.${v.kind}`)} · ${v.moduleTitle}${v.duration ? ` · ${videoTime(v.duration)}` : ''}${v.live ? '' : t('video.pick.unpublished')}`,
        run: () => menu.run(v),
      }))}
    />
  ) : null;
  return { open, menu: node };
}
