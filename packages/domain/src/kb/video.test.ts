import { describe, expect, it } from 'vitest';
import {
  compareLandingVideos,
  compareVideos,
  probeVideo,
  videoContentType,
  videoFormProblems,
  videoModuleOrder,
  videoOnLanding,
  videoPct,
  videoProgressProblem,
  videoReachedDone,
  videoSecs,
  videoSegAdd,
  videoSegLen,
  videoSegMerge,
  videoTime,
  videoViewStatus,
  videoVisible,
  videoYtId,
  type VideoVisibility,
} from './video';

describe('Видео платформы: учёт просмотренных секунд (прототип v79 segAdd, vidPct, vidSt)', () => {
  it('отрезки сливаются, каждая секунда считается один раз, концы — до 0,1 с', () => {
    let segs = videoSegAdd([], 0, 60);
    segs = videoSegAdd(segs, 30, 90);
    expect(segs).toEqual([[0, 90]]);
    // Разрыв до 0,25 с — тот же отрезок; больше — новый.
    expect(videoSegAdd([[0, 10]], 10.2, 20)).toEqual([[0, 20]]);
    expect(videoSegAdd([[0, 10]], 10.5, 20)).toEqual([
      [0, 10],
      [10.5, 20],
    ]);
    expect(videoSegAdd([], 1.234, 5.678)).toEqual([[1.2, 5.7]]);
    // Пустой и обратный отрезок ничего не добавляют.
    expect(videoSegAdd([[0, 5]], 7, 7)).toEqual([[0, 5]]);
    expect(
      videoSegMerge(
        [[0, 10]],
        [
          [5, 15],
          [40, 50],
        ],
      ),
    ).toEqual([
      [0, 15],
      [40, 50],
    ]);
    expect(
      videoSegLen([
        [0, 15],
        [40, 50],
      ]),
    ).toBe(25);
  });

  it('1 минута из 3 и перемотка в конец — «Начал», 33 %; с начала до конца — «Просмотрено»', () => {
    const segs = videoSegMerge([], [[0, 60]]);
    expect(videoPct(180, segs)).toBe(33);
    expect(videoViewStatus({ done: videoReachedDone(180, segs), segs })).toBe('started');
    const all = videoSegMerge(segs, [[60, 180]]);
    expect(videoReachedDone(180, all)).toBe(true);
    expect(videoViewStatus({ done: true, segs: all })).toBe('done');
    expect(videoPct(180, all)).toBe(100);
  });

  it('«Просмотрено» — с 90 % секунд; «Начал» — с первой проигранной секунды', () => {
    expect(videoReachedDone(100, [[0, 89.9]])).toBe(false);
    expect(videoReachedDone(100, [[0, 90]])).toBe(true);
    expect(videoViewStatus({ done: false, segs: [[0, 0.5]] })).toBe('none');
    expect(videoViewStatus({ done: false, segs: [[0, 1]] })).toBe('started');
    expect(videoViewStatus(null)).toBe('none');
  });

  it('длительность неизвестна (YouTube до первого запуска) — 0 %, секунды копятся', () => {
    expect(videoPct(null, [[0, 50]])).toBe(0);
    expect(videoReachedDone(null, [[0, 5000]])).toBe(false);
    expect(videoSecs(null, [[0, 50]])).toBe(50);
    expect(videoSecs(40, [[0, 50]])).toBe(40);
  });

  it('браузер не может засчитать больше, чем проигралось бы за время открытия на скорости 2', () => {
    const openedAt = new Date('2026-11-08T10:00:00Z');
    const now = new Date('2026-11-08T10:01:00Z');
    expect(videoProgressProblem({ segs: [[0, 120]], duration: 180, openedAt, now })).toBeNull();
    expect(videoProgressProblem({ segs: [[0, 130]], duration: 180, openedAt, now })).toBe(
      'video_progress_invalid',
    );
    expect(
      videoProgressProblem({
        segs: [[0, 200]],
        duration: 180,
        openedAt,
        now: new Date('2026-11-08T11:00:00Z'),
      }),
    ).toBe('video_progress_invalid');
    expect(videoProgressProblem({ segs: [[5, 3]], duration: 180, openedAt, now })).toBe(
      'video_progress_invalid',
    );
    expect(videoProgressProblem({ segs: [[-1, 3]], duration: 180, openedAt, now })).toBe(
      'video_progress_invalid',
    );
    expect(videoProgressProblem({ segs: [[0, Number.NaN]], duration: 180, openedAt, now })).toBe(
      'video_progress_invalid',
    );
  });

  it('серия сохранений и несколько окон сразу не дают больше 2× прошедшего времени', () => {
    const openedAt = new Date('2026-11-08T10:00:00Z');
    const now = new Date('2026-11-08T10:01:00Z');
    // Через минуту после открытия сохранено [0, 120]: следующие 5 секунд (и запас) — можно, [120, 250] — нет.
    const earlier: [number, number][] = [[0, 120]];
    expect(
      videoProgressProblem({ segs: [[120, 125]], duration: 600, openedAt, now, earlier }),
    ).toBeNull();
    expect(
      videoProgressProblem({ segs: [[125, 250]], duration: 600, openedAt, now, earlier }),
    ).toBe('video_progress_invalid');
    // Повтор уже засчитанных секунд не тратит запас.
    expect(
      videoProgressProblem({ segs: [[0, 120]], duration: 600, openedAt, now, earlier }),
    ).toBeNull();
  });

  it('нулевые отрезки не копятся: короче 0,1 с после округления отбрасываются', () => {
    const tiny = Array.from({ length: 1000 }, (_, i) => [i, i + 0.04] as const);
    expect(videoSegMerge([], tiny)).toEqual([]);
    expect(videoSegAdd([[0, 5]], 7, 7.04)).toEqual([[0, 5]]);
    // Отрезков больше 2 000 вместе с прежними — сохранение не принимается.
    const many = Array.from({ length: 1500 }, (_, i) => [i, i + 0.1] as [number, number]);
    const openedAt = new Date('2026-11-08T10:00:00Z');
    const now = new Date('2026-11-08T12:00:00Z');
    expect(videoProgressProblem({ segs: many, duration: null, openedAt, now })).toBeNull();
    expect(
      videoProgressProblem({
        segs: many.map(([a, b]) => [a + 1500, b + 1500]),
        duration: null,
        openedAt,
        now,
        earlier: many,
      }),
    ).toBe('video_progress_invalid');
  });

  it('слияние 100 000 отрезков — за доли секунды', () => {
    const many = Array.from({ length: 100_000 }, (_, i) => [i * 0.4, i * 0.4 + 0.1] as const);
    const start = performance.now();
    expect(videoSegMerge(many, many).length).toBe(100_000);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('время — «2:15» и «1:02:05» (прототип vidT)', () => {
    expect(videoTime(135)).toBe('2:15');
    expect(videoTime(3725)).toBe('1:02:05');
    expect(videoTime(null)).toBe('0:00');
  });
});

describe('Видео платформы: ссылка YouTube (прототип ytId)', () => {
  it('понимает все виды ссылок YouTube', () => {
    for (const link of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'youtu.be/dQw4w9WgXcQ',
    ]) {
      expect(videoYtId(link), link).toBe('dQw4w9WgXcQ');
    }
  });

  it('ссылка не на YouTube — null', () => {
    expect(videoYtId('https://vimeo.com/123456')).toBeNull();
    expect(videoYtId('https://youtu.be/short')).toBeNull();
    expect(videoYtId('https://evil.example/youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(videoYtId('')).toBeNull();
  });
});

describe('Видео платформы: кому видно и порядок (прототип vidOk, vidLand, vidSortF)', () => {
  const v = (patch: Partial<VideoVisibility> = {}): VideoVisibility => ({
    status: 'published',
    off: false,
    deleted: false,
    audience: 'all',
    module: 'cps',
    landing: false,
    ...patch,
  });
  const user = { admin: false, modules: new Set(['home', 'cps', 'kb']) };
  const admin = { admin: true, modules: new Set(['kbadm']) };

  it('видео модуля не из меню, «только Админка», черновик, снятое и удалённое — не видны', () => {
    expect(videoVisible(v(), user)).toBe(true);
    expect(videoVisible(v({ module: null }), user)).toBe(true);
    expect(videoVisible(v({ module: 'reports' }), user)).toBe(false);
    expect(videoVisible(v({ audience: 'adm' }), user)).toBe(false);
    expect(videoVisible(v({ status: 'draft' }), user)).toBe(false);
    expect(videoVisible(v({ off: true }), user)).toBe(false);
    expect(videoVisible(v({ deleted: true }), user)).toBe(false);
  });

  it('администратор платформы видит любое опубликованное', () => {
    expect(videoVisible(v({ module: 'reports', audience: 'adm' }), admin)).toBe(true);
    expect(videoVisible(v({ status: 'draft' }), admin)).toBe(false);
  });

  it('на лендинге — опубликованное с отметкой, не «только Админка»', () => {
    expect(videoOnLanding(v({ landing: true }))).toBe(true);
    expect(videoOnLanding(v({ landing: true, audience: 'adm' }))).toBe(false);
    expect(videoOnLanding(v({ landing: true, off: true }))).toBe(false);
    expect(videoOnLanding(v())).toBe(false);
  });

  it('«Общее» первым, дальше в порядке левой панели, внутри — «Порядок», затем название', () => {
    const menu = ['home', 'reports', 'cps'];
    expect(videoModuleOrder(null, menu)).toBe(-1);
    expect(videoModuleOrder('cps', menu)).toBe(2);
    expect(videoModuleOrder('tasks', menu)).toBeGreaterThan(500);
    const list = [
      { module: 'cps', ord: 2, title: 'Б' },
      { module: 'cps', ord: 1, title: 'В' },
      { module: null, ord: 9, title: 'А' },
      { module: 'reports', ord: 1, title: 'Г' },
      { module: 'cps', ord: 1, title: 'А' },
    ].sort((a, b) => compareVideos(a, b, menu));
    expect(list.map((x) => x.title)).toEqual(['А', 'Г', 'А', 'В', 'Б']);
    expect(
      [
        { landingOrd: 2, ord: 1 },
        { landingOrd: 1, ord: 5 },
      ].sort(compareLandingVideos),
    ).toEqual([
      { landingOrd: 1, ord: 5 },
      { landingOrd: 2, ord: 1 },
    ]);
  });
});

describe('Видео платформы: форма в Админке (прототип vidEditDlg)', () => {
  const base = {
    title: 'Как добавить контрагента',
    kind: 'instr' as const,
    source: 'file' as const,
    hasFile: true,
    module: 'cps',
    description: '',
  };

  it('всё заполнено — ошибок нет', () => {
    expect(videoFormProblems(base)).toEqual({});
    expect(
      videoFormProblems({
        ...base,
        source: 'yt',
        hasFile: false,
        yt: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    ).toEqual({});
    expect(videoFormProblems({ ...base, kind: 'pres', module: null })).toEqual({});
  });

  it('ошибки — как в прототипе', () => {
    expect(videoFormProblems({ ...base, title: '  ' }).title).toBe('title_required');
    expect(videoFormProblems({ ...base, title: 'я'.repeat(121) }).title).toBe('title_long');
    expect(videoFormProblems({ ...base, module: null }).module).toBe('module_required');
    expect(videoFormProblems({ ...base, module: 'nope' }).module).toBe('module_unknown');
    expect(videoFormProblems({ ...base, source: 'yt', yt: 'https://vimeo.com/1' }).yt).toBe('yt');
    expect(videoFormProblems({ ...base, hasFile: false }).file).toBe('file');
    expect(videoFormProblems({ ...base, description: 'д'.repeat(1001) }).description).toBe(
      'description_long',
    );
  });

  it('файл — только .mp4 и .webm, заявленный тип совпадает с именем', () => {
    expect(videoContentType('a.MP4')).toBe('video/mp4');
    expect(videoContentType('a.webm', 'video/webm')).toBe('video/webm');
    expect(videoContentType('a.mp4', 'video/webm')).toBeNull();
    expect(videoContentType('a.mov')).toBeNull();
  });
});

/* ───────────── Проверка файла ───────────── */

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, body: number[]) => [...be32(8 + body.length), ...text(type), ...body];

/** Короткий MP4: ftyp, mdat, moov с mvhd (длительность 135 с при шкале 1000). */
function mp4(moovFirst: boolean, mdatBytes = 32): Uint8Array {
  const ftyp = box('ftyp', [...text('isom'), 0, 0, 2, 0, ...text('isomavc1')]);
  const mvhd = box('mvhd', [
    0,
    0,
    0,
    0,
    ...be32(0),
    ...be32(0),
    ...be32(1000),
    ...be32(135_000),
    ...new Array(80).fill(0),
  ]);
  const moov = box('moov', mvhd);
  const mdat = box('mdat', new Array(mdatBytes).fill(7));
  return Uint8Array.from(moovFirst ? [...ftyp, ...moov, ...mdat] : [...ftyp, ...mdat, ...moov]);
}

/** Короткий WebM: EBML (DocType webm), Segment, Info с TimecodeScale 1 мс и Duration 70 000. */
function webm(withDuration: boolean): Uint8Array {
  const docType = [0x42, 0x82, 0x84, ...text('webm')];
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80 | docType.length, ...docType];
  const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
  const dur = new Uint8Array(8);
  new DataView(dur.buffer).setFloat64(0, 70_000);
  const duration = withDuration ? [0x44, 0x89, 0x88, ...dur] : [];
  const infoBody = [...scale, ...duration];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00];
  const segBody = [...info, ...cluster];
  const segment = [
    0x18,
    0x53,
    0x80,
    0x67,
    0x01,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    ...segBody,
  ];
  return Uint8Array.from([...ebml, ...segment]);
}

const reader = (bytes: Uint8Array) => async (offset: number, length: number) =>
  bytes.subarray(offset, offset + length);

describe('Видео платформы: сервер проверяет загруженный файл по содержимому', () => {
  it('MP4 с moov в начале и в конце — длительность из mvhd', async () => {
    for (const first of [true, false]) {
      const bytes = mp4(first, 100_000);
      expect(await probeVideo(reader(bytes), bytes.length, 'video/mp4')).toEqual({
        type: 'video/mp4',
        duration: 135,
      });
    }
  });

  it('WebM — длительность из Info; запись без длительности — тоже видео', async () => {
    const a = webm(true);
    expect(await probeVideo(reader(a), a.length, 'video/webm')).toEqual({
      type: 'video/webm',
      duration: 70,
    });
    const b = webm(false);
    expect(await probeVideo(reader(b), b.length, 'video/webm')).toEqual({
      type: 'video/webm',
      duration: null,
    });
  });

  it('не видео или не тот тип — null', async () => {
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...new Array(64).fill(0),
    ]);
    expect(await probeVideo(reader(png), png.length, 'video/mp4')).toBeNull();
    expect(await probeVideo(reader(png), png.length, 'video/webm')).toBeNull();
    const m = mp4(true);
    expect(await probeVideo(reader(m), m.length, 'video/webm')).toBeNull();
    const w = webm(true);
    expect(await probeVideo(reader(w), w.length, 'video/mp4')).toBeNull();
    const html = Uint8Array.from(text('<html><script>alert(1)</script></html>'));
    expect(await probeVideo(reader(html), html.length, 'video/mp4')).toBeNull();
  });
});
