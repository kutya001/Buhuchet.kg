import { describe, expect, it } from 'vitest';
import {
  FILE_MAX_BYTES,
  FILE_NAME_MAX_LENGTH,
  fileContentType,
  fileDeleteRefusal,
  fileExtension,
  fileSizeParts,
  fileUploadProblem,
  isFileSourceKind,
} from './files';

describe('файлы записей', () => {
  it('расширение — как `fext` прототипа: после последней точки; у «.bashrc» и «файл» его нет', () => {
    expect(fileExtension('Договор_2026.PDF')).toBe('pdf');
    expect(fileExtension('архив.tar.gz')).toBe('gz');
    expect(fileExtension('.bashrc')).toBeNull();
    expect(fileExtension('файл')).toBeNull();
    expect(fileExtension('файл.')).toBeNull();
  });

  it('размер — как `fmtSize` прототипа: до 1 МБ целые КБ, дальше МБ с запятой', () => {
    expect(fileSizeParts(0)).toEqual({ value: '0', unit: 'kb' });
    expect(fileSizeParts(38_000)).toEqual({ value: '37', unit: 'kb' });
    expect(fileSizeParts(1048575)).toEqual({ value: '1024', unit: 'kb' });
    expect(fileSizeParts(1048576)).toEqual({ value: '1,0', unit: 'mb' });
    expect(fileSizeParts(2_438_000)).toEqual({ value: '2,3', unit: 'mb' });
    expect(fileSizeParts(FILE_MAX_BYTES)).toEqual({ value: '20,0', unit: 'mb' });
  });

  it('файл больше 20 МБ не загружается; ровно 20 МБ — загружается', () => {
    expect(fileUploadProblem({ name: 'выписка.pdf', size: FILE_MAX_BYTES })).toBeNull();
    expect(fileUploadProblem({ name: 'выписка.pdf', size: FILE_MAX_BYTES + 1 })).toBe(
      'file_too_large',
    );
  });

  it('программы, сценарии и веб-страницы не загружаются; документы, картинки и архивы — да', () => {
    for (const name of [
      'setup.exe',
      'run.BAT',
      'page.html',
      'logo.svg',
      'x.js',
      'help.chm',
      'a.iso',
    ]) {
      expect(fileUploadProblem({ name, size: 10 })).toBe('file_type_forbidden');
    }
    for (const name of [
      'Устав.pdf',
      'скан.JPG',
      'отчёт.xlsx',
      'архив.zip',
      'Отчёт ГНС.xml',
      'без',
    ]) {
      expect(fileUploadProblem({ name, size: 10 })).toBeNull();
    }
  });

  it('имя: не пустое, не длиннее 255 символов, без управляющих символов и разделителей пути', () => {
    expect(fileUploadProblem({ name: '   ', size: 1 })).toBe('file_name_invalid');
    expect(fileUploadProblem({ name: 'a'.repeat(FILE_NAME_MAX_LENGTH), size: 1 })).toBeNull();
    expect(fileUploadProblem({ name: 'a'.repeat(FILE_NAME_MAX_LENGTH + 1), size: 1 })).toBe(
      'file_name_invalid',
    );
    for (const name of ['../x.pdf', 'a\\b.pdf', 'a\nb.pdf', 'a\u0000.pdf']) {
      expect(fileUploadProblem({ name, size: 1 })).toBe('file_name_invalid');
    }
    // Точка в конце (Windows её срежет: «Акт.exe.» → «Акт.exe») и знаки смены направления текста.
    for (const name of [
      'Акт.exe.',
      'Акт.pdf..',
      'Акт\u202efdp.exe',
      'a\u2066b.pdf',
      'a\u200fb.pdf',
    ]) {
      expect(fileUploadProblem({ name, size: 1 }), JSON.stringify(name)).toBe('file_name_invalid');
    }
  });

  it('тип содержимого — по расширению; неизвестное — application/octet-stream', () => {
    expect(fileContentType('Скан.JPEG')).toBe('image/jpeg');
    expect(fileContentType('отчёт.pdf')).toBe('application/pdf');
    expect(fileContentType('книга.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(fileContentType('база.1cd')).toBe('application/octet-stream');
    expect(fileContentType('без')).toBe('application/octet-stream');
  });

  it('свой файл удаляется без права в течение суток, чужой и старый — только с правом «Удалять файлы»', () => {
    const uploadedAt = new Date('2026-10-18T03:00:00Z');
    const file = { uploadedBy: 'u1', uploadedAt };
    const at = (iso: string, userId = 'u1', canDeleteAny = false) => ({
      userId,
      canDeleteAny,
      now: new Date(iso),
    });
    expect(fileDeleteRefusal(file, at('2026-10-19T02:59:59Z'))).toBeNull();
    expect(fileDeleteRefusal(file, at('2026-10-19T03:00:00Z'))).toBe('file_delete_forbidden');
    expect(fileDeleteRefusal(file, at('2026-10-18T04:00:00Z', 'u2'))).toBe('file_delete_forbidden');
    expect(fileDeleteRefusal(file, at('2026-12-01T00:00:00Z', 'u2', true))).toBeNull();
    expect(fileDeleteRefusal({ uploadedBy: null, uploadedAt }, at('2026-10-18T04:00:00Z'))).toBe(
      'file_delete_forbidden',
    );
  });

  it('виды источников', () => {
    expect(isFileSourceKind('manual')).toBe(true);
    expect(isFileSourceKind('report')).toBe(true);
    expect(isFileSourceKind('contractor')).toBe(false);
  });
});
