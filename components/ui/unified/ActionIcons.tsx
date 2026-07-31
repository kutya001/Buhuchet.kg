'use client';

import React from 'react';
import {
  Eye,
  FolderDown,
  FileText,
  RotateCcw,
  PauseCircle,
  Send,
  UserX,
  Trash2,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ActionIconButtonProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  href?: string;
  colorClass?: string;
}

export function ActionIconButton({
  icon: Icon,
  label,
  onClick,
  href,
  colorClass = 'text-muted-foreground hover:text-foreground',
}: ActionIconButtonProps) {
  const btn = (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={label}
      className={`h-8 w-8 rounded-xl hover:bg-muted/60 transition-colors ${colorClass}`}
    >
      <Icon className="w-4 h-4" />
    </Button>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={label}>
        {btn}
      </a>
    );
  }

  return btn;
}

export function ActionRowGroup({
  onView,
  onDownloadR2,
  onReport,
  onRevoke,
  onPause,
  onCollaborate,
  onEdit,
  onDelete,
}: {
  onView?: () => void;
  onDownloadR2?: (() => void) | string;
  onReport?: () => void;
  onRevoke?: () => void;
  onPause?: () => void;
  onCollaborate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {onView && (
        <ActionIconButton
          icon={Eye}
          label="Просмотреть карточку"
          onClick={onView}
          colorClass="text-sky-500 hover:bg-sky-500/10"
        />
      )}
      {onDownloadR2 && (
        <ActionIconButton
          icon={FolderDown}
          label="Скачать скан R2"
          onClick={typeof onDownloadR2 === 'function' ? onDownloadR2 : undefined}
          href={typeof onDownloadR2 === 'string' ? onDownloadR2 : undefined}
          colorClass="text-emerald-500 hover:bg-emerald-500/10"
        />
      )}
      {onReport && (
        <ActionIconButton
          icon={FileText}
          label="Сформировать отчет"
          onClick={onReport}
          colorClass="text-amber-500 hover:bg-amber-500/10"
        />
      )}
      {onCollaborate && (
        <ActionIconButton
          icon={Send}
          label="Запросить сотрудничество"
          onClick={onCollaborate}
          colorClass="text-primary hover:bg-primary/10"
        />
      )}
      {onRevoke && (
        <ActionIconButton
          icon={RotateCcw}
          label="Отозвать"
          onClick={onRevoke}
          colorClass="text-purple-500 hover:bg-purple-500/10"
        />
      )}
      {onPause && (
        <ActionIconButton
          icon={PauseCircle}
          label="Приостановить"
          onClick={onPause}
          colorClass="text-amber-500 hover:bg-amber-500/10"
        />
      )}
      {onEdit && (
        <ActionIconButton
          icon={Pencil}
          label="Редактировать"
          onClick={onEdit}
          colorClass="text-muted-foreground hover:text-foreground"
        />
      )}
      {onDelete && (
        <ActionIconButton
          icon={UserX}
          label="Удалить / Прекратить"
          onClick={onDelete}
          colorClass="text-red-500 hover:bg-red-500/10"
        />
      )}
    </div>
  );
}
