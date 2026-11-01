'use client';

import { linkButtonClass } from '@buhuchet/ui';
import { useShell } from '../shell/context';
import { openProjectCard } from './project-card-store';

/**
 * Название проекта ссылкой на его карточку (прототип `.linkbtn` с `openProject(pj)` в карточке задачи).
 * Без «Проектов контрагентов» или права «Просматривать проекты» — просто текст.
 */
export function ProjectLink({ id, name }: { id: string; name: string }) {
  const { access } = useShell();
  if (!access.feature('projects') || !access.can('projView')) return <span>{name}</span>;
  return (
    <button
      type="button"
      data-project-link={id}
      className={`${linkButtonClass()} max-w-full text-left`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openProjectCard(id);
      }}
    >
      {name}
    </button>
  );
}
