'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Building2,
  Users,
  FolderArchive,
  ShieldAlert,
  CreditCard,
  LayoutDashboard,
  Check,
  X,
  Info,
  ChevronDown,
  ChevronUp,
  Save,
  CheckCheck,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  SYSTEM_PERMISSION_CATALOG,
  type PermissionGroupMeta,
  type PermissionMeta,
  type ModuleName,
  type ActionName,
} from '@/lib/auth/permissions';
import type { CompanyRole, RolePermissions, ModulePermissions } from '@/types/database.types';

interface PermissionMatrixEditorProps {
  role: CompanyRole | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedPermissions: RolePermissions) => Promise<void> | void;
  isSaving?: boolean;
}

const ICON_MAP = {
  FileText,
  Building2,
  Users,
  FolderArchive,
  ShieldAlert,
  CreditCard,
  LayoutDashboard,
};

export function PermissionMatrixEditor({
  role,
  isOpen,
  onClose,
  onSave,
  isSaving = false,
}: PermissionMatrixEditorProps) {
  if (!isOpen || !role) return null;

  const isOwnerSystemRole = role.is_system && role.name.toLowerCase() === 'владелец';

  // Исходные права роли для отслеживания dirty-состояния
  const initialPermissions = useMemo<RolePermissions>(() => {
    return role.permissions || {};
  }, [role]);

  const [permissions, setPermissions] = useState<RolePermissions>(initialPermissions);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [activeTooltipKey, setActiveTooltipKey] = useState<string | null>(null);

  // Синхронизация при открытии
  useEffect(() => {
    setPermissions(role.permissions || {});
    // По умолчанию раскрываем группы, где есть хотя бы одно активное право
    const initialOpenState: Record<string, boolean> = {};
    SYSTEM_PERMISSION_CATALOG.forEach((grp) => {
      const modPerms = (role.permissions as any)?.[grp.id] || {};
      const hasActive = grp.permissions.some((p) => !!modPerms[p.action]);
      initialOpenState[grp.id] = hasActive || grp.id === 'documents' || grp.id === 'counterparties';
    });
    setOpenGroups(initialOpenState);
  }, [role]);

  // Подсчет статистики
  const stats = useMemo(() => {
    let total = 0;
    let enabled = 0;

    SYSTEM_PERMISSION_CATALOG.forEach((grp) => {
      const modPerms = (permissions as any)?.[grp.id] || {};
      grp.permissions.forEach((p) => {
        total++;
        if (modPerms[p.action]) {
          enabled++;
        }
      });
    });

    const percent = total > 0 ? Math.round((enabled / total) * 100) : 0;
    return { total, enabled, percent };
  }, [permissions]);

  // Проверка изменений (dirty state)
  const isDirty = useMemo(() => {
    if (isOwnerSystemRole) return false;
    return JSON.stringify(permissions) !== JSON.stringify(initialPermissions);
  }, [permissions, initialPermissions, isOwnerSystemRole]);

  // Одиночный переключатель права
  const handleToggleSingle = (module: ModuleName, action: ActionName) => {
    if (isOwnerSystemRole) return;
    setPermissions((prev) => {
      const modPerms = (prev as any)?.[module] || {};
      const current = !!modPerms[action];
      return {
        ...prev,
        [module]: {
          ...modPerms,
          [action]: !current,
        },
      };
    });
  };

  // Переключатель группы (Мастер-чекбокс)
  const handleToggleGroup = (group: PermissionGroupMeta) => {
    if (isOwnerSystemRole) return;
    const modPerms = (permissions as any)?.[group.id] || {};
    const allEnabled = group.permissions.every((p) => !!modPerms[p.action]);
    const targetState = !allEnabled;

    setPermissions((prev) => {
      const currentMod = { ...((prev as any)?.[group.id] || {}) };
      group.permissions.forEach((p) => {
        currentMod[p.action] = targetState;
      });
      return {
        ...prev,
        [group.id]: currentMod,
      };
    });
  };

  // Выбрать все права системы
  const handleSelectAll = () => {
    if (isOwnerSystemRole) return;
    const next: Record<string, Record<string, boolean>> = {};
    SYSTEM_PERMISSION_CATALOG.forEach((grp) => {
      next[grp.id] = {};
      grp.permissions.forEach((p) => {
        next[grp.id][p.action] = true;
      });
    });
    setPermissions(next as RolePermissions);
  };

  // Сбросить все права
  const handleResetAll = () => {
    if (isOwnerSystemRole) return;
    const next: Record<string, Record<string, boolean>> = {};
    SYSTEM_PERMISSION_CATALOG.forEach((grp) => {
      next[grp.id] = {};
      grp.permissions.forEach((p) => {
        next[grp.id][p.action] = false;
      });
    });
    setPermissions(next as RolePermissions);
  };

  // Сворачивание / разворачивание группы
  const toggleGroupOpen = (groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Сохранение
  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty || isOwnerSystemRole) return;
    await onSave(permissions);
  }, [isSaving, isDirty, isOwnerSystemRole, onSave, permissions]);

  // Горячая клавиша Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-background/80 backdrop-blur-md overflow-hidden">
      <Card className="max-w-4xl w-full bg-card border-border rounded-2xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
        
        {/* ========================================================================= */}
        {/* 1. STICKY TOPBAR HEADER */}
        {/* ========================================================================= */}
        <div className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            
            {/* Название роли и бейджи */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <span>Матрица прав:</span>
                  <span className="text-purple-400 font-extrabold">{role.name}</span>
                </h3>
                {role.is_system ? (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-[10px] font-bold">
                    Системная роль
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-purple-500/40 text-purple-400 bg-purple-500/10 text-[10px] font-bold">
                    Пользовательская
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {role.description || 'Гранулярная настройка доступа к модулям, кнопкам и операциям компании'}
              </p>
            </div>

            {/* Индикатор и действия */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Прогресс выбранных прав */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/40 border border-border/80">
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-foreground">
                    {stats.enabled} из {stats.total} прав
                  </div>
                  <div className="text-[10px] text-muted-foreground">{stats.percent}% доступно</div>
                </div>
                <div className="w-10 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-purple-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${stats.percent}%` }}
                  />
                </div>
              </div>

              {/* Кнопка закрытия модалки */}
              <Button size="icon" variant="ghost" onClick={onClose} className="rounded-xl h-9 w-9">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Панель массовых действий */}
          {!isOwnerSystemRole && (
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/50 flex-wrap">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectAll}
                  className="h-7 text-[11px] font-medium rounded-lg hover:bg-purple-500/10 hover:text-purple-300"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1" />
                  Выбрать все
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResetAll}
                  className="h-7 text-[11px] font-medium rounded-lg hover:bg-muted text-muted-foreground"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Сбросить все
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground hidden md:inline">
                  Горячая клавиша: <kbd className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono">Ctrl + S</kbd>
                </span>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className={`h-8 text-xs font-bold rounded-xl px-4 transition-all ${
                    isDirty
                      ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20'
                      : 'bg-muted text-muted-foreground opacity-60'
                  }`}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Сохранение...
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      Сохранить изменения
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 2. ТЕЛО МАТРИЦЫ С АККОРДЕОНАМИ И ПОДСКАЗКАМИ */}
        {/* ========================================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          
          {/* Баннер для Владельца */}
          {isOwnerSystemRole && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-amber-400">Неограниченные полномочия Владельца</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Системная роль «Владелец» обладает 100% доступом ко всем модулям, финансовому замку периодов и
                  управлению тарифами компании. Права владельца не подлежат ограничению.
                </p>
              </div>
            </div>
          )}

          {/* Список групп разрешений */}
          {SYSTEM_PERMISSION_CATALOG.map((group) => {
            const IconComponent = ICON_MAP[group.iconName] || FileText;
            const isOpen = !!openGroups[group.id];
            const modPerms = (permissions as any)?.[group.id] || {};

            const groupTotal = group.permissions.length;
            const groupEnabled = group.permissions.filter((p) => !!modPerms[p.action]).length;
            const isAllGroupChecked = groupTotal > 0 && groupEnabled === groupTotal;
            const isPartiallyChecked = groupEnabled > 0 && groupEnabled < groupTotal;

            return (
              <div
                key={group.id}
                className="rounded-2xl border border-border bg-card/60 overflow-hidden transition-all duration-200 hover:border-purple-500/30"
              >
                {/* Заголовок группы (Модуля) */}
                <div
                  className="p-3.5 sm:p-4 bg-muted/20 flex items-center justify-between gap-3 cursor-pointer select-none"
                  onClick={() => toggleGroupOpen(group.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <IconComponent className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{group.title}</span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${
                            groupEnabled === groupTotal
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : groupEnabled > 0
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {groupEnabled} из {groupTotal}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground hidden sm:block mt-0.5">
                        {group.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    {/* Мастер-переключатель группы */}
                    {!isOwnerSystemRole && (
                      <button
                        type="button"
                        onClick={() => handleToggleGroup(group)}
                        title={isAllGroupChecked ? 'Снять выбор со всего раздела' : 'Выбрать весь раздел'}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
                          isAllGroupChecked
                            ? 'bg-purple-600 text-white border-purple-600'
                            : isPartiallyChecked
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
                        }`}
                      >
                        <span className="text-[11px]">
                          {isAllGroupChecked ? 'Выбран весь раздел' : isPartiallyChecked ? 'Выбрать все' : 'Включить раздел'}
                        </span>
                      </button>
                    )}

                    {/* Стрелка раскрытия */}
                    <button
                      type="button"
                      onClick={() => toggleGroupOpen(group.id)}
                      className="text-muted-foreground hover:text-foreground p-1"
                    >
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Содержимое группы: Список прав */}
                {isOpen && (
                  <div className="p-3 sm:p-4 space-y-2.5 border-t border-border/40 bg-card/40">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {group.permissions.map((perm) => {
                        const isChecked = isOwnerSystemRole || !!modPerms[perm.action];
                        const isTooltipOpen = activeTooltipKey === perm.key;

                        return (
                          <div
                            key={perm.key}
                            className={`relative rounded-xl p-3 border transition-all flex flex-col justify-between gap-2 ${
                              isChecked
                                ? 'bg-purple-500/5 border-purple-500/30'
                                : 'bg-muted/10 border-border/60 hover:border-border'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              
                              {/* Чекбокс + Заголовок */}
                              <label
                                className={`flex items-start gap-2.5 flex-1 select-none ${
                                  isOwnerSystemRole ? 'cursor-default' : 'cursor-pointer'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={isOwnerSystemRole}
                                  checked={isChecked}
                                  onChange={() => handleToggleSingle(perm.module, perm.action)}
                                  className="mt-0.5 w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                                />
                                <div className="space-y-1">
                                  <div className="text-xs font-bold text-foreground leading-snug">
                                    {perm.label}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                                    {perm.shortDesc}
                                  </div>
                                </div>
                              </label>

                              {/* Кнопка подробного Tooltip/Popover */}
                              <div className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setActiveTooltipKey(isTooltipOpen ? null : perm.key)}
                                  className={`p-1 rounded-lg transition-all ${
                                    isTooltipOpen
                                      ? 'bg-purple-500/20 text-purple-400'
                                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                  }`}
                                  title="Показать подробное описание и назначение"
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>

                                {/* Всплывающая карточка описания (Tooltip Popover) */}
                                {isTooltipOpen && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-40"
                                      onClick={() => setActiveTooltipKey(null)}
                                    />
                                    <div className="absolute right-0 top-6 z-50 w-72 sm:w-80 p-3.5 rounded-xl bg-popover text-popover-foreground border border-border shadow-2xl space-y-2 animate-in fade-in zoom-in-95 duration-150">
                                      <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                          <Info className="w-3.5 h-3.5 text-purple-400" />
                                          Детали права доступа
                                        </span>
                                        <Badge variant="outline" className="text-[9px] font-mono">
                                          {perm.key}
                                        </Badge>
                                      </div>

                                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        {perm.detailedDesc}
                                      </p>

                                      {/* Связанная кнопка в интерфейсе */}
                                      <div className="p-2 rounded-lg bg-muted/40 border border-border/40 text-[10px] text-muted-foreground flex items-center gap-1.5">
                                        <span className="font-semibold text-foreground">Элемент в UI:</span>
                                        <span className="text-purple-300 font-mono">{perm.uiTarget}</span>
                                      </div>

                                      {/* Предупреждение об опасности */}
                                      {perm.warning && (
                                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-400 flex items-start gap-1.5">
                                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                          <span>{perm.warning}</span>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Бейдж элемента интерфейса */}
                            <div className="pt-1 flex items-center justify-between border-t border-border/30 text-[10px]">
                              <span className="text-muted-foreground font-mono truncate max-w-[200px]">
                                {perm.uiTarget}
                              </span>
                              {perm.warning && (
                                <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-[9px] px-1.5 py-0">
                                  Критическое
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* 3. STICKY FOOTER ACTION BAR */}
        {/* ========================================================================= */}
        <div className="sticky bottom-0 z-30 bg-card border-t border-border p-3 sm:p-4 flex items-center justify-between gap-3 shadow-lg">
          <div className="text-xs text-muted-foreground hidden sm:block">
            {isDirty ? (
              <span className="text-amber-400 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Есть несохраненные изменения в матрице прав
              </span>
            ) : (
              <span>Все изменения сохранены</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button variant="ghost" onClick={onClose} className="h-9 text-xs rounded-xl">
              Закрыть
            </Button>
            {!isOwnerSystemRole && (
              <Button
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className={`h-9 text-xs font-bold rounded-xl px-5 transition-all ${
                  isDirty
                    ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20'
                    : 'bg-muted text-muted-foreground opacity-60'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Сохранить матрицу прав
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

      </Card>
    </div>
  );
}
