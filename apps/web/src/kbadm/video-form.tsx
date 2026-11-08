'use client';

import {
  ADMIN_MENU_MODULES,
  KB_MODULE_TITLES,
  MENU_MODULES,
  VIDEO_COVER_MAX_BYTES,
  VIDEO_DESC_MAX,
  VIDEO_FILE_MAX_BYTES,
  VIDEO_MESSAGES,
  VIDEO_TITLE_MAX,
  videoContentType,
  videoFormProblems,
  videoTime,
  videoYtId,
  type VideoMessage,
} from '@buhuchet/domain';
import { VideoAdminSaved, type VideoAdminFields, type VideoAdminItem } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  RecordChangedNotice,
  Segments,
  SWITCH_CLASS,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure, callApi } from '../api-client';
import { fileSizeText } from '../files/files-data';
import { videoCoverUrl } from '../kb/video/video-data';
import { PlayerHost } from '../kb/video/video-window';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { kbAdminMetaQuery } from './kbadm-data';
import { adminStatus, adminVideoCardQuery, refreshAdminVideos } from './kbadm-video';
import {
  allParts,
  cancelVideoUpload,
  captureFrame,
  completeVideoUpload,
  missingParts,
  partsBytes,
  putVideoParts,
  shrinkCover,
  startVideoUpload,
  uploadVideoCover,
  type VideoUploadJob,
} from './video-upload';

const videos = () => api.api.admin.videos;

type Field = 'title' | 'module' | 'yt' | 'file' | 'description' | 'cover';

interface FormState {
  title: string;
  kind: 'instr' | 'pres';
  source: 'file' | 'yt';
  yt: string;
  description: string;
  module: string;
  article: string;
  ord: string;
  audience: 'all' | 'adm';
  landing: boolean;
  landingOrd: string;
}

const stateOf = (v: VideoAdminItem | null, next: { ord: number; landing: number }): FormState => ({
  title: v?.title ?? '',
  kind: v?.kind ?? 'instr',
  source: v?.source ?? 'file',
  yt: v?.ytId ? `https://youtu.be/${v.ytId}` : '',
  description: v?.description ?? '',
  module: v?.module ?? '',
  article: v?.article ?? '',
  ord: String(v?.ord ?? next.ord),
  audience: v?.audience ?? 'all',
  landing: v?.landing ?? false,
  landingOrd: String(v?.landingOrd ?? next.landing),
});

/** Модули по порядку меню (прототип `modL`): «Общее», модули организации, Админки, «База знаний». */
function moduleOptions(t: Translate): [string, string][] {
  const biz = MENU_MODULES.map((m) => m.id).filter((id) => id !== 'kb');
  const adm = ADMIN_MENU_MODULES.filter((id) => id !== 'kb');
  return [
    ['', t('video.mod.none')],
    ...biz.map((id): [string, string] => [id, t(KB_MODULE_TITLES[id])]),
    ...adm.map((id): [string, string] => [
      id,
      t('video.mod.admin', { title: t(KB_MODULE_TITLES[id]) }),
    ]),
    ['kb', t(KB_MODULE_TITLES.kb)],
  ];
}

/** Текст ошибки формы по коду (словарь `video.msg.*`); нет в словаре — текст сервера. */
const msg = (t: Translate, code: string) =>
  Object.hasOwn(VIDEO_MESSAGES, code)
    ? t(`video.msg.${code as VideoMessage}` as 'video.msg.file')
    : code;

type Phase = 'idle' | 'up' | 'paused' | 'check' | 'done';

interface UploadView {
  phase: Phase;
  name: string;
  size: number;
  pct: number;
  /** Проверенный файл: код загрузки и длительность. */
  upload: string | null;
  duration: number | null;
}

const NO_UPLOAD: UploadView = {
  phase: 'idle',
  name: '',
  size: 0,
  pct: 0,
  upload: null,
  duration: null,
};

/**
 * Загрузка файла в форме (прототип `pick`, `startUp`, `tickUp`, `check`): полоса с процентами,
 * «Отменить»; обрыв связи — «Загрузка прервалась» и «Продолжить» с той части, что не дошла.
 */
function useVideoUpload(onChecked: (file: File, duration: number | null) => void) {
  const t = useT();
  const toast = useToast();
  const [view, setView] = useState<UploadView>(NO_UPLOAD);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<VideoUploadJob | null>(null);
  const abort = useRef<AbortController | null>(null);
  const sent = useRef(0);
  // Конец проверки и закрытие формы читают обработчик и состояние на момент события.
  const checked = useRef(onChecked);
  const viewRef = useRef(view);
  useEffect(() => {
    checked.current = onChecked;
    viewRef.current = view;
  }, [onChecked, view]);

  // Форму закрыли во время загрузки — загрузка прерывается, части убираются.
  useEffect(
    () => () => {
      abort.current?.abort();
      const j = job.current;
      if (j && !viewRef.current.upload) cancelVideoUpload(j.id);
    },
    [],
  );

  const run = async (j: VideoUploadJob, numbers: readonly number[]) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setView((v) => ({ ...v, phase: 'up' }));
    try {
      await putVideoParts(j, numbers, ctrl.signal, (bytes) => {
        sent.current += bytes;
        setView((v) => ({ ...v, pct: Math.min(100, (sent.current / j.file.size) * 100) }));
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof ApiFailure && e.status !== 0 && e.status < 500) {
        setError(msg(t, e.error.code));
        return reset();
      }
      return setView((v) => ({ ...v, phase: 'paused' }));
    }
    setView((v) => ({ ...v, phase: 'check', pct: 100 }));
    try {
      const done = await completeVideoUpload(j.id);
      setView((v) => ({ ...v, phase: 'done', upload: done.id, duration: done.duration }));
      checked.current(j.file, done.duration);
      toast(
        done.duration
          ? t('video.form.up_done', { dur: videoTime(done.duration) })
          : t('video.form.up_done_nodur'),
        { icon: 'film' },
      );
    } catch (e) {
      job.current = null;
      setError(msg(t, e instanceof ApiFailure ? e.error.code : 'video_not_uploaded'));
      setView(NO_UPLOAD);
    }
  };

  const reset = () => {
    if (job.current) cancelVideoUpload(job.current.id);
    job.current = null;
    setView(NO_UPLOAD);
  };

  const pick = async (file: File) => {
    setError(null);
    const type = videoContentType(file.name, file.type);
    if (!type || !file.size || file.size > VIDEO_FILE_MAX_BYTES) {
      return setError(msg(t, 'video_file'));
    }
    abort.current?.abort();
    if (job.current && !view.upload) cancelVideoUpload(job.current.id);
    sent.current = 0;
    setView({ ...NO_UPLOAD, phase: 'up', name: file.name, size: file.size });
    try {
      const j = await startVideoUpload(file);
      job.current = j;
      await run(j, allParts(j));
    } catch (e) {
      job.current = null;
      setView(NO_UPLOAD);
      setError(msg(t, e instanceof ApiFailure ? e.error.code : 'video_not_uploaded'));
    }
  };

  const resume = async () => {
    const j = job.current;
    if (!j) return;
    try {
      const todo = await missingParts(j);
      sent.current = j.file.size - partsBytes(j, todo);
      await run(j, todo);
    } catch {
      setView((v) => ({ ...v, phase: 'paused' }));
    }
  };

  const cancel = () => {
    abort.current?.abort();
    reset();
    toast(t('video.form.up_cancelled'), { icon: 'x' });
  };

  return {
    view,
    error,
    busy: view.phase === 'up' || view.phase === 'check' || view.phase === 'paused',
    pick: (file: File) => void pick(file),
    resume: () => void resume(),
    cancel,
  };
}

interface CoverPick {
  upload: string;
  url: string;
}

/**
 * Окно «Видео» (прототип v79 `vidEditDlg`): название, вид, источник — файл (частями прямо в
 * хранилище) или ссылка YouTube с предпросмотром, обложка, описание, модуль, связанная статья, порядок,
 * для кого, лендинг. Новое — сначала черновиком; «Заменить файл / ссылку» сохраняет ссылки и просмотры.
 */
export function VideoEditDialog({
  video,
  replace,
  open,
  onClose,
}: {
  video: VideoAdminItem | null;
  replace: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const meta = useQuery(kbAdminMetaQuery).data;
  const next = useQuery({
    queryKey: ['kbadm', 'video-next'],
    enabled: video === null,
    queryFn: async () => {
      const res = await videos().$get({ query: { size: 'all' } });
      const items = res.ok ? ((await res.json()) as { items: VideoAdminItem[] }).items : [];
      return {
        ord: items.reduce((a, v) => Math.max(a, v.ord), 0) + 1,
        landing: items.filter((v) => v.landing && adminStatus(v) === 'pub').length + 1,
      };
    },
  }).data ?? { ord: 1, landing: 1 };
  const [base, setBase] = useState(video);
  const isNew = base === null;
  const [form, setForm] = useState<FormState>(() => stateOf(video, next));
  const [touchedOrd, setTouchedOrd] = useState(false);
  const shownForm = isNew && !touchedOrd ? { ...form, ord: String(next.ord) } : form;
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const [ytDuration, setYtDuration] = useState<number | null>(null);
  const [ytPlay, setYtPlay] = useState(false);
  // Обложка: своя картинка (undefined — не трогали, null — убрали) и кадр с первой секунды нового файла.
  const [own, setOwn] = useState<CoverPick | null | undefined>(undefined);
  const [frame, setFrame] = useState<CoverPick | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const drop = useRef<HTMLLabelElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const blobUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };

  const upload = useVideoUpload((file) => {
    setErrors((e) => ({ ...e, file: undefined }));
    // Кадр с первой секунды — обложка по умолчанию (прототип `U.frame`).
    void captureFrame(file).then(async (blob) => {
      if (!blob) return;
      try {
        setFrame({ upload: await uploadVideoCover(blob), url: blobUrl(blob) });
      } catch {
        setFrame(null);
      }
    });
  });

  useEffect(() => {
    if (!replace || !open) return;
    const el = base?.source === 'yt' ? document.getElementById(`${id}-yt`) : drop.current;
    const timer = setTimeout(() => el?.focus(), 60);
    return () => clearTimeout(timer);
  }, [replace, open, base?.source, id]);

  const set = <K extends keyof FormState>(key: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: v }));
  const ytId = videoYtId(form.yt);
  const published = !!base && adminStatus(base) === 'pub';
  const hasOldFile = !!base && base.source === 'file' && !!base.fileName;
  const fileReady = upload.view.phase === 'done' || (upload.view.phase === 'idle' && hasOldFile);
  const dirty =
    JSON.stringify(shownForm) !== JSON.stringify(stateOf(base, next)) ||
    upload.view.phase !== 'idle' ||
    own !== undefined;

  const reload = async () => {
    if (!base) return;
    setReloading(true);
    const fresh = await client.fetchQuery(adminVideoCardQuery(base.id)).catch(() => null);
    setReloading(false);
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setBase(fresh.video);
    setForm(stateOf(fresh.video, next));
    setChanged(false);
  };

  const pickCover = async (file: File) => {
    setErrors((e) => ({ ...e, cover: undefined }));
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > VIDEO_COVER_MAX_BYTES) {
      return setErrors((e) => ({ ...e, cover: msg(t, 'video_cover') }));
    }
    const blob = await shrinkCover(file);
    if (!blob) return setErrors((e) => ({ ...e, cover: t('video.form.cover_bad') }));
    try {
      setOwn({ upload: await uploadVideoCover(blob), url: blobUrl(blob) });
    } catch (e) {
      setErrors((x) => ({
        ...x,
        cover: e instanceof ApiFailure ? msg(t, e.error.code) : t('video.form.cover_bad'),
      }));
    }
  };

  /** Что сохранить в обложке (поле `cover`): своя, кадр, убрать или оставить. */
  const coverInputOf = (): VideoAdminFields['cover'] => {
    if (own) return { upload: own.upload, kind: 'own' };
    const fileSource = form.source === 'file';
    if (own === null) {
      return fileSource && frame ? { upload: frame.upload, kind: 'frame' } : 'none';
    }
    if (fileSource && frame && (isNew || base?.coverKind !== 'own')) {
      return { upload: frame.upload, kind: 'frame' };
    }
    if (!fileSource && base?.coverKind === 'frame') return 'none';
    return 'keep';
  };

  const coverPreview = (): string | null => {
    if (own) return own.url;
    if (own === undefined && base?.coverKind && !(form.source === 'file' && frame)) {
      if (base.coverKind === 'own' || form.source === base.source) {
        return `${videoCoverUrl(base.id)}?v=${base.version}`;
      }
    }
    if (form.source === 'file') return frame?.url ?? null;
    return ytId ? `https://i.ytimg.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg` : null;
  };

  const save = async (publish: boolean) => {
    const problems = videoFormProblems({
      title: form.title,
      kind: form.kind,
      source: form.source,
      yt: form.yt,
      hasFile: fileReady,
      module: form.module || null,
      description: form.description,
    });
    const shown: Partial<Record<Field, string>> = Object.fromEntries(
      Object.entries(problems).map(([k, code]) => [k, msg(t, code)]),
    );
    if (form.source === 'file' && upload.busy) shown.file = msg(t, 'video_upload_wait');
    setErrors(shown);
    if (Object.keys(shown).length) return;
    if (!isNew && !dirty && !publish) return onClose();
    const fields = {
      title: form.title.trim(),
      kind: form.kind,
      source: form.source,
      ...(form.source === 'yt' ? { yt: form.yt.trim() } : {}),
      ...(form.source === 'file' && upload.view.upload ? { upload: upload.view.upload } : {}),
      ...(form.source === 'yt' && ytDuration ? { ytDuration } : {}),
      cover: coverInputOf(),
      description: form.description.trim().slice(0, VIDEO_DESC_MAX),
      module: form.module || null,
      article: form.article || null,
      ord: Math.max(0, Math.floor(Number(shownForm.ord) || 0)),
      audience: form.audience,
      ...(published
        ? {
            landing: form.landing,
            landingOrd: Math.max(1, Math.floor(Number(form.landingOrd) || 1)),
          }
        : {}),
    };
    setSaving(true);
    const res = await callApi(() =>
      base
        ? videos()[':id'].$put({
            param: { id: base.id },
            json: { ...fields, version: base.version, ...(publish ? { publish: true } : {}) },
          })
        : videos().$post({ json: { ...fields, publish } }),
    );
    setSaving(false);
    if (!res.ok) {
      if (res.error.code === 'record_changed') return setChanged(true);
      const field = (res.error.details as { field?: Field } | undefined)?.field;
      if (field && Object.hasOwn(VIDEO_MESSAGES, res.error.code)) {
        return setErrors({ [field]: msg(t, res.error.code) });
      }
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    const saved = VideoAdminSaved.parse(res.data);
    refreshAdminVideos(client);
    onClose();
    toast(
      t(
        saved.video.status === 'draft'
          ? 'video.form.saved_draft'
          : saved.replaced
            ? 'video.form.saved_replaced'
            : isNew
              ? 'video.form.saved_published'
              : 'video.form.saved',
      ),
      { icon: 'film' },
    );
  };

  const close = () => (upload.busy ? setAskStop(true) : onClose());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };
  const f = (k: string) => `${id}-${k}`;
  const formId = f('form');
  const draft = !base || base.status === 'draft';
  const title = isNew
    ? t('video.form.new')
    : replace
      ? t(base.source === 'yt' ? 'video.adm.replace_link' : 'video.adm.replace_file')
      : t('video.form.title');
  const sub = isNew
    ? t('video.form.new_sub')
    : `${base.title} · ${t(`video.st.${adminStatus(base)}`)}`;
  const preview = coverPreview();
  const u = upload.view;

  return (
    <Modal
      open={open}
      onClose={close}
      kind="form"
      size="mid"
      title={title}
      sub={sub}
      dirty={dirty && !upload.busy}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={close}>
            {t('video.form.cancel')}
          </button>
          <div className="flex-1" />
          {draft ? (
            <>
              <button
                type="submit"
                form={formId}
                className={buttonClass()}
                disabled={saving || changed}
              >
                {t('video.form.save_draft')}
              </button>
              <button
                type="button"
                className={buttonClass('cta')}
                disabled={saving || changed}
                onClick={() => void save(true)}
              >
                <Icon name="send" size="sm" />
                {t('video.form.publish')}
              </button>
            </>
          ) : (
            <button
              type="submit"
              form={formId}
              className={buttonClass('cta')}
              disabled={saving || changed}
            >
              {t('video.form.save')}
            </button>
          )}
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={submit} noValidate data-video-form="">
        <FormGrid>
          <Field
            id={f('title')}
            label={t('video.form.f.title')}
            required
            full
            hint={t('video.form.f.title_hint')}
            error={errors.title}
          >
            {(c) => (
              <input
                {...c}
                value={form.title}
                maxLength={VIDEO_TITLE_MAX}
                onChange={(e) => set('title', e.target.value)}
                className={inputClass()}
              />
            )}
          </Field>
          <Field
            id={f('kind')}
            label={t('video.form.f.kind')}
            required
            hint={t('video.form.f.kind_hint')}
          >
            {(c) => (
              <select
                {...c}
                value={form.kind}
                onChange={(e) => {
                  set('kind', e.target.value as FormState['kind']);
                  setErrors((x) => ({ ...x, module: undefined }));
                }}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="instr">{t('video.kind.instr')}</option>
                <option value="pres">{t('video.kind.pres')}</option>
              </select>
            )}
          </Field>
          <Field id={f('source')} label={t('video.form.f.source')} required>
            <Segments
              label={t('video.form.f.source')}
              value={form.source}
              onChange={(v) => {
                set('source', v);
                setYtPlay(false);
              }}
              options={[
                { value: 'file', label: t('video.form.src.file'), icon: 'upload' },
                { value: 'yt', label: t('video.form.src.yt'), icon: 'link' },
              ]}
            />
          </Field>
          {form.source === 'file' ? (
            <Field
              id={f('file')}
              label={t('video.form.f.file')}
              required
              full
              hint={t('video.form.f.file_hint')}
              error={errors.file ?? upload.error ?? undefined}
            >
              <div>
                <label
                  ref={drop}
                  className={`vf-drop${over ? ' over' : ''}${errors.file || upload.error ? ' bad' : ''}`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInput.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    const file = e.dataTransfer.files[0];
                    if (file) upload.pick(file);
                  }}
                >
                  <input
                    ref={fileInput}
                    id={f('file')}
                    type="file"
                    accept="video/mp4,video/webm,.mp4,.webm"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) upload.pick(file);
                    }}
                  />
                  <Icon name="upload" />
                  <span className="vf-fn">
                    {u.phase === 'done' ? (
                      <>
                        <b>{u.name}</b>
                        <span className="text-muted">
                          {fileSizeText(t, u.size)}
                          {u.duration ? ` · ${videoTime(u.duration)}` : ''}
                        </span>
                        <span className="text-link">{t('video.form.replace')}</span>
                      </>
                    ) : u.phase === 'idle' && hasOldFile ? (
                      <>
                        <b>{base.fileName}</b>
                        <span className="text-muted">
                          {base.fileSize ? fileSizeText(t, base.fileSize) : ''}
                          {base.duration ? ` · ${videoTime(base.duration)}` : ''}
                        </span>
                        <span className="text-link">{t('video.form.replace')}</span>
                      </>
                    ) : (
                      <b>{t('video.form.drop')}</b>
                    )}
                  </span>
                </label>
                {upload.busy ? (
                  <div className="vf-up" data-video-upload={u.phase}>
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${u.pct}%` }} />
                    </span>
                    <span className="vf-up-t">
                      {u.phase === 'check' ? (
                        t('video.form.up_check')
                      ) : u.phase === 'paused' ? (
                        <span className="text-danger">
                          {t('video.form.up_broken', { pct: Math.floor(u.pct) })}
                        </span>
                      ) : (
                        t('video.form.up', { name: u.name, pct: Math.floor(u.pct) })
                      )}
                    </span>
                    {u.phase !== 'check' ? (
                      <button
                        type="button"
                        className={buttonClass('default', 'sm')}
                        onClick={u.phase === 'paused' ? upload.resume : upload.cancel}
                      >
                        {t(u.phase === 'paused' ? 'video.form.up_resume' : 'video.form.up_cancel')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Field>
          ) : (
            <Field
              id={f('yt')}
              label={t('video.form.f.yt')}
              required
              full
              hint={t('video.form.f.yt_hint')}
              error={errors.yt}
            >
              {(c) => (
                <div>
                  <input
                    {...c}
                    value={form.yt}
                    inputMode="url"
                    placeholder="https://youtu.be/…"
                    onChange={(e) => {
                      set('yt', e.target.value);
                      setErrors((x) => ({ ...x, yt: undefined }));
                      setYtPlay(false);
                      setYtDuration(null);
                    }}
                    onBlur={() => {
                      if (form.yt.trim() && !ytId) setErrors((x) => ({ ...x, yt: msg(t, 'yt') }));
                    }}
                    className={inputClass()}
                  />
                  {ytId ? (
                    <div className="vf-ytp">
                      {ytPlay ? (
                        <div className="vid-w">
                          <PlayerHost
                            key={ytId}
                            video={{
                              id: base?.id ?? 'yt-preview',
                              title: form.title || t('video.form.yt_preview', { id: ytId }),
                              kind: form.kind,
                              source: 'yt',
                              ytId,
                              duration: null,
                              description: '',
                            }}
                            play={{ kind: 'yt', ytId }}
                            track={null}
                            view={null}
                            report={false}
                            onDuration={setYtDuration}
                          />
                        </div>
                      ) : (
                        <button type="button" className="vf-ytb" onClick={() => setYtPlay(true)}>
                          {/* Предпросмотр — обложка YouTube, размеры задаёт рамка 16:9. */}
                          <img
                            src={`https://i.ytimg.com/vi/${encodeURIComponent(ytId)}/hqdefault.jpg`}
                            alt=""
                          />
                          <span className="vcv-p" aria-hidden="true">
                            <Icon name="pl" />
                          </span>
                          <span className="vf-ytc">{t('video.form.yt_preview', { id: ytId })}</span>
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </Field>
          )}
          <Field
            id={f('cover')}
            label={t('video.form.f.cover')}
            full
            hint={t('video.form.f.cover_hint')}
            error={errors.cover}
          >
            <div className="vf-cvr flex items-center">
              <span className="vf-cvi">
                {preview ? (
                  // Обложка: своя, кадр или YouTube; размеры задаёт рамка 16:9.
                  <img src={preview} alt="" />
                ) : (
                  <span className="text-faint">
                    {form.source === 'file' ? t('video.form.cover_frame') : '—'}
                  </span>
                )}
              </span>
              <button
                type="button"
                className={buttonClass('default', 'sm')}
                onClick={() => coverInput.current?.click()}
              >
                <Icon name="image" size="sm" />
                {t('video.form.cover_pick')}
              </button>
              <input
                ref={coverInput}
                id={f('cover')}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void pickCover(file);
                }}
              />
              {own || (own === undefined && base?.coverKind === 'own') ? (
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => setOwn(null)}
                >
                  {t('video.form.cover_drop')}
                </button>
              ) : null}
            </div>
          </Field>
          <Field
            id={f('description')}
            label={t('video.form.f.description')}
            full
            hint={t('video.form.f.description_hint')}
            error={errors.description}
          >
            {(c) => (
              <textarea
                {...c}
                rows={3}
                maxLength={VIDEO_DESC_MAX}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className={inputClass({ multiline: true })}
              />
            )}
          </Field>
          <Field
            id={f('module')}
            label={t('video.form.f.module')}
            hint={t('video.form.f.module_hint')}
            error={errors.module}
          >
            {(c) => (
              <select
                {...c}
                value={form.module}
                onChange={(e) => {
                  set('module', e.target.value);
                  setErrors((x) => ({ ...x, module: undefined }));
                }}
                className={`${inputClass()} cursor-pointer`}
              >
                {moduleOptions(t).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('article')} label={t('video.form.f.article')}>
            {(c) => (
              <select
                {...c}
                value={form.article}
                onChange={(e) => set('article', e.target.value)}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="">{t('video.form.no_article')}</option>
                {(meta?.articles ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.sec} · {a.t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={f('ord')} label={t('video.form.f.ord')} hint={t('video.form.f.ord_hint')}>
            {(c) => (
              <input
                {...c}
                type="number"
                min={0}
                step={1}
                value={shownForm.ord}
                onChange={(e) => {
                  setTouchedOrd(true);
                  set('ord', e.target.value);
                }}
                className={inputClass()}
              />
            )}
          </Field>
          <Field id={f('audience')} label={t('video.form.f.audience')}>
            {(c) => (
              <select
                {...c}
                value={form.audience}
                onChange={(e) => set('audience', e.target.value as FormState['audience'])}
                className={`${inputClass()} cursor-pointer`}
              >
                <option value="all">{t('video.aud.all')}</option>
                <option value="adm">{t('video.aud.adm')}</option>
              </select>
            )}
          </Field>
          <Field
            id={f('landing')}
            label={t('video.form.f.landing')}
            hint={published ? undefined : t('video.form.landing_hint')}
          >
            {(c) => (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  {...c}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                  checked={form.landing}
                  disabled={!published}
                  onChange={(e) => set('landing', e.target.checked)}
                />
                {t('video.form.landing_label')}
              </label>
            )}
          </Field>
          <Field
            id={f('landingOrd')}
            label={t('video.form.f.landing_ord')}
            hint={t('video.form.f.landing_ord_hint')}
          >
            {(c) => (
              <input
                {...c}
                type="number"
                min={1}
                step={1}
                value={form.landingOrd}
                disabled={!published}
                onChange={(e) => set('landingOrd', e.target.value)}
                className={inputClass()}
              />
            )}
          </Field>
        </FormGrid>
      </form>
      <ConfirmDialog
        open={askStop}
        onClose={() => setAskStop(false)}
        title={t('video.form.stop.title')}
        text={t('video.form.stop.text')}
        ok={t('video.form.stop.ok')}
        danger
        onConfirm={() => {
          setAskStop(false);
          upload.cancel();
          onClose();
        }}
      />
    </Modal>
  );
}
