'use client';

import { videoTime } from '@buhuchet/domain';
import type { VideoItem } from '@buhuchet/shared';
import { Icon, linkButtonClass, useWindow } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo } from 'react';
import { useT } from '../../l10n/provider';
import { presetHref } from '../../lists/preset';
import { useShell } from '../../shell/context';
import { videoCatalogQuery, videoOptionsQuery } from './video-data';
import { ItemProgress, VideoCover } from './video-parts';
import { useVideo } from './video-window';

/** Видеоинструкции модуля по порядку (прототип `vidOfMod`); модуля нет — пусто. */
export function useModuleVideos(module: string | null | undefined): readonly VideoItem[] {
  const query = useQuery(videoCatalogQuery);
  return useMemo(
    () =>
      module
        ? (query.data?.items ?? []).filter((v) => v.kind === 'instr' && v.module === module)
        : [],
    [query.data, module],
  );
}

/** Видео из каталога по коду; нет (снято, удалено, недоступно) — null. */
export function useCatalogVideo(id: string | null | undefined): VideoItem | null {
  const query = useQuery(videoCatalogQuery);
  return id ? (query.data?.items.find((v) => v.id === id) ?? null) : null;
}

/**
 * Видео кнопки в тексте статьи и новости: из каталога, а у администратора платформы — и черновик или
 * снятое (предпросмотр в Админке, прототип `vidMdBtn` по всем видео); нет — null.
 */
export function useLinkedVideo(
  id: string | null | undefined,
): Pick<VideoItem, 'id' | 'title' | 'duration'> | null {
  const { access } = useShell();
  const found = useCatalogVideo(id);
  const options = useQuery({ ...videoOptionsQuery, enabled: access.admin && !!id && !found });
  if (found || !id || !access.admin) return found;
  return options.data?.items.find((v) => v.id === id) ?? null;
}

/**
 * Видеоинструкции модуля первыми в окне «?» (прототип `vidHelpHtml`): до трёх карточек и «Все видео
 * модуля · N», если их больше одной — вкладка «Видео» с фильтром по модулю.
 */
export function VideoHelpBlock({ module }: { module: string | null | undefined }) {
  const t = useT();
  const video = useVideo();
  const { leave } = useWindow();
  const list = useModuleVideos(module);
  if (!list.length) return null;
  const href = presetHref('kb', 'video', {
    module: { type: 'enum', vals: [list[0]!.moduleTitle] },
  });
  return (
    <div className="vh" data-video-help="">
      <div className="vh-h">
        <b>
          <Icon name="film" size="sm" />
          {t(list.length > 1 ? 'video.help.many' : 'video.help.one')}
        </b>
        {list.length > 1 ? (
          <Link href={href} replace onClick={leave} className={linkButtonClass()}>
            {t('video.help.all', { n: list.length })}
          </Link>
        ) : null}
      </div>
      <div className="vh-l">
        {list.slice(0, 3).map((v) => (
          <button
            key={v.id}
            type="button"
            className="vh-c"
            data-video-open={v.id}
            onClick={() => video.open(v.id)}
          >
            <VideoCover video={v} size="sm" isNew={v.isNew} />
            <span className="vh-t">
              <b>{v.title}</b>
              <span className="text-muted">{videoTime(v.duration)}</span>
              <ItemProgress video={v} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
