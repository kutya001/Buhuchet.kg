import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes?: number | string | null): string {
  if (bytes == null || bytes === '') return '0 Б';
  const num = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (isNaN(num) || num <= 0) return '0 Б';

  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  const val = num / Math.pow(k, i);
  return `${parseFloat(val.toFixed(i === 0 ? 0 : 2))} ${sizes[i]}`;
}
