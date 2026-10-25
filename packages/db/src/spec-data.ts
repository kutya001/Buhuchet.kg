import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Папка spec/ в корне репозитория: копия ТЗ и прототипа (только чтение). */
export const SPEC_DIR = fileURLToPath(new URL('../../../spec/', import.meta.url));

export async function readSpecJson<T = unknown>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(`${SPEC_DIR}${relativePath}`, 'utf8')) as T;
}

/** Коммит прототипа, из которого скопирована spec/ (spec/SOURCE.json). */
export async function specCommit(): Promise<string> {
  try {
    const source = await readSpecJson<{ commit?: string }>('SOURCE.json');
    return source.commit?.slice(0, 7) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
