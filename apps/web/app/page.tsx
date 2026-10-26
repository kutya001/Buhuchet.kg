import { redirect } from 'next/navigation';
import { canEnter } from '../src/shell/modules';
import { loadMe } from '../src/shell/server';

/** Главная сайта: вошедшего — в программу, остальных — на вход. */
export default async function HomePage() {
  redirect(canEnter(await loadMe()) ? '/app' : '/login');
}
