'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Table as TableIcon,
  LayoutGrid,
  ChevronDown,
  Search,
  Filter,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  RotateCcw,
  X,
  Check,
  Calendar,
  Layers,
  Maximize2,
  Minimize2,
  MoreVertical,
} from 'lucide-react';
import { LayoutWidthToggle } from '@/components/ui/LayoutWidthToggle';

export type ColumnDataType = 'text' | 'number' | 'date' | 'dictionary';

export type ColumnDef<T> = {
  key: string;
  label: string;
  type?: ColumnDataType;
  dictionaryOptions?: { label: string; value: string | number }[];
  sortable?: boolean;
  filterable?: boolean;
  hiddenByDefault?: boolean;
  width?: number;
  render?: (item: T) => React.ReactNode;
  getValue?: (item: T) => any;
};

export type RowAction<T> = {
  label: string;
  action: (item: T) => void;
  icon?: React.ReactNode;
  danger?: boolean;
};

export type UnifiedDataGridProps<T> = {
  gridId?: string;
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  getRowActions?: (item: T) => RowAction<T>[];
  renderCard?: (item: T) => React.ReactNode;
  title?: string;
  subtitle?: string;
  searchPlaceholder?: string;
  actionButton?: React.ReactNode;
  emptyMessage?: string;
  isLoading?: boolean;
  defaultPageSize?: 25 | 50 | 100 | 'all';
  forceView?: 'table' | 'cards';
};

export function UnifiedDataGrid<T extends Record<string, any>>({
  gridId = 'default_grid',
  columns: initialColumns,
  data,
  keyExtractor,
  getRowActions,
  renderCard,
  title,
  subtitle,
  searchPlaceholder = 'Поиск по записям...',
  actionButton,
  emptyMessage = 'Записи не найдены',
  isLoading = false,
  defaultPageSize = 25,
  forceView,
}: UnifiedDataGridProps<T>) {
  // 1. Конфигурация колонок и видимости
  const [columns, setColumns] = useState<ColumnDef<T>[]>(initialColumns);

  useEffect(() => {
    setColumns(initialColumns);
    setVisibleColumnKeys(new Set(initialColumns.filter((c) => !c.hiddenByDefault).map((c) => c.key)));
  }, [initialColumns]);

  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    initialColumns.forEach((c) => {
      if (!c.hiddenByDefault) keys.add(c.key);
    });
    return keys;
  });

  // 2. Компактный режим плотности табличной верстки
  const [isCompact, setIsCompact] = useState<boolean>(false);

  // 3. Изменение ширины колонок (Resizing) & localStorage кэш
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingColKeyRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedWidths = localStorage.getItem(`buhuchet_col_widths_${gridId}`);
      if (savedWidths) {
        try {
          setColWidths(JSON.parse(savedWidths));
        } catch (e) {
          console.error('Col widths parse error:', e);
        }
      }
    }
  }, [gridId]);

  const handleMouseDownResize = (e: React.MouseEvent, colKey: string, currentWidth: number) => {
    e.stopPropagation();
    e.preventDefault();
    resizingColKeyRef.current = colKey;
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth || 150;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingColKeyRef.current) return;
      const deltaX = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(60, startWidthRef.current + deltaX);
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: newWidth };
        if (typeof window !== 'undefined') {
          localStorage.setItem(`buhuchet_col_widths_${gridId}`, JSON.stringify(next));
        }
        return next;
      });
    };

    const handleMouseUp = () => {
      resizingColKeyRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const resetWidths = () => {
    setColWidths({});
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`buhuchet_col_widths_${gridId}`);
    }
  };

  // 4. Режим отображения: Таблица vs Карточки
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(forceView || 'table');
  useEffect(() => {
    if (forceView) {
      setViewMode(forceView);
      return;
    }
    const checkViewport = () => {
      if (window.innerWidth < 768) {
        setViewMode('cards');
      } else {
        setViewMode('table');
      }
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, [forceView]);

  // 5. Поиск, Сортировка и Фильтры по типам
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Фильтры: text, dictionary (массив), number ({min, max}), date ({from, to})
  const [columnFilters, setColumnFilters] = useState<Record<string, any>>({});
  const [activeFilterPopover, setActiveFilterPopover] = useState<string | null>(null);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);

  const resetFilters = () => setColumnFilters({});

  // 6. Контекстное Меню (Right-Click) для строк и шапки
  const [contextMenu, setContextMenu] = useState<{
    type: 'header' | 'row';
    x: number;
    y: number;
    colKey?: string;
    rowItem?: T;
  } | null>(null);

  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // 7. Пагинация
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | 'all'>(defaultPageSize);
  const [currentPage, setCurrentPage] = useState(1);

  // 8. Переключение ширины (По центру vs На всю ширину)
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('buhuchet_grid_fullwidth');
      if (saved === 'true') {
        setIsFullWidth(true);
      }
    }
  }, []);

  const handleToggleFullWidth = (full: boolean) => {
    setIsFullWidth(full);
    if (typeof window !== 'undefined') {
      localStorage.setItem('buhuchet_grid_fullwidth', String(full));
    }
  };

  // Drag & Drop столбцов
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDraggedColumnKey(key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedColumnKey || draggedColumnKey === targetKey) return;

    const sourceIndex = columns.findIndex((c) => c.key === draggedColumnKey);
    const targetIndex = columns.findIndex((c) => c.key === targetKey);

    if (sourceIndex !== -1 && targetIndex !== -1) {
      const updated = [...columns];
      const [moved] = updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, moved);
      setColumns(updated);
    }
    setDraggedColumnKey(null);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortKey, sortOrder, columnFilters, pageSize]);

  // Фильтрация и Сортировка данных
  const processedData = useMemo(() => {
    let result = [...data];

    // Глобальный поиск
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        return columns.some((col) => {
          if (!visibleColumnKeys.has(col.key)) return false;
          const val = col.getValue ? col.getValue(item) : item[col.key];
          if (val == null) return false;
          return String(val).toLowerCase().includes(q);
        });
      });
    }

    // Фильтрация по типам данных колонок
    Object.entries(columnFilters).forEach(([colKey, filterConfig]) => {
      if (!filterConfig) return;
      const col = columns.find((c) => c.key === colKey);
      if (!col) return;

      result = result.filter((item) => {
        const rawVal = col.getValue ? col.getValue(item) : item[colKey];

        // 1. Текстовый фильтр
        if (typeof filterConfig === 'string' && filterConfig.trim()) {
          if (rawVal == null) return false;
          return String(rawVal).toLowerCase().includes(filterConfig.toLowerCase().trim());
        }

        // 2. Справочник (Массив выбранных значений)
        if (Array.isArray(filterConfig) && filterConfig.length > 0) {
          if (rawVal == null) return false;
          return filterConfig.includes(String(rawVal));
        }

        // 3. Числовой диапазон
        if (typeof filterConfig === 'object' && ('min' in filterConfig || 'max' in filterConfig)) {
          const numVal = Number(rawVal);
          if (isNaN(numVal)) return false;
          if (filterConfig.min !== undefined && filterConfig.min !== '' && numVal < Number(filterConfig.min)) return false;
          if (filterConfig.max !== undefined && filterConfig.max !== '' && numVal > Number(filterConfig.max)) return false;
          return true;
        }

        // 4. Диапазон дат
        if (typeof filterConfig === 'object' && ('from' in filterConfig || 'to' in filterConfig)) {
          if (!rawVal) return false;
          const itemDate = new Date(rawVal).getTime();
          if (isNaN(itemDate)) return false;
          if (filterConfig.from && itemDate < new Date(filterConfig.from).getTime()) return false;
          if (filterConfig.to && itemDate > new Date(filterConfig.to).getTime() + 86400000) return false;
          return true;
        }

        return true;
      });
    });

    // Сортировка
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      result.sort((a, b) => {
        const valA = col?.getValue ? col.getValue(a) : a[sortKey];
        const valB = col?.getValue ? col.getValue(b) : b[sortKey];

        if (valA == null && valB == null) return 0;
        if (valA == null) return sortOrder === 'asc' ? 1 : -1;
        if (valB == null) return sortOrder === 'asc' ? -1 : 1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortOrder === 'asc' ? valA - valB : valB - valA;
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();

        return sortOrder === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
      });
    }

    return result;
  }, [data, searchQuery, columnFilters, sortKey, sortOrder, columns, visibleColumnKeys]);

  const totalItems = processedData.length;
  const effectivePageSize = pageSize === 'all' ? totalItems || 1 : pageSize;
  const totalPages = Math.ceil(totalItems / effectivePageSize) || 1;

  const paginatedData = useMemo(() => {
    if (pageSize === 'all') return processedData;
    const start = (currentPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, currentPage, pageSize]);

  const toggleColumnVisibility = (key: string) => {
    setVisibleColumnKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else {
        setSortKey(null);
        setSortOrder('asc');
      }
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const visibleColumns = columns.filter((c) => visibleColumnKeys.has(c.key));

  return (
    <div className={`space-y-4 transition-all duration-200 ${isFullWidth ? 'w-full max-w-none' : 'max-w-7xl mx-auto'}`}>
      {/* Верхний тулбар управления */}
      <div className="relative z-30 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card p-4 rounded-2xl border border-border shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          {title && (
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">{title}</h3>
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          )}

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-card border-border text-foreground text-xs pl-9 min-h-[40px] focus:border-amber-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Кнопка переключения Компактного Вида */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCompact(!isCompact)}
            className={`border-border bg-card text-xs min-h-[40px] ${
              isCompact ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 font-bold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {isCompact ? <Minimize2 className="h-4 w-4 mr-1.5" /> : <Maximize2 className="h-4 w-4 mr-1.5" />}
            {isCompact ? 'Компактный вид' : 'Обычный вид'}
          </Button>

          <LayoutWidthToggle isFullWidth={isFullWidth} onToggle={handleToggleFullWidth} />
          {actionButton}

          {/* Настройка столбцов */}
          <div className="relative z-50">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
              className="border-border bg-card text-muted-foreground hover:text-foreground text-xs min-h-[40px]"
            >
              <SlidersHorizontal className="h-4 w-4 mr-1.5 text-amber-500" />
              Столбцы ({visibleColumns.length}/{columns.length})
            </Button>

            {showVisibilityMenu && (
              <div className="absolute right-0 top-12 z-50 w-60 bg-card border border-border rounded-2xl p-3 shadow-2xl space-y-2 ring-1 ring-border">
                <div className="flex items-center justify-between text-xs font-bold text-foreground border-b border-border pb-2">
                  <span>Отображение столбцов</span>
                  <button onClick={() => setShowVisibilityMenu(false)} className="text-muted-foreground hover:text-foreground p-1">
                    ✕
                  </button>
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                  {columns.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center space-x-2 text-xs text-foreground hover:bg-muted p-1.5 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumnKeys.has(col.key)}
                        onChange={() => toggleColumnVisibility(col.key)}
                        className="rounded bg-background border-border text-amber-500 focus:ring-0"
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!forceView && (
            <div className="flex items-center space-x-1 bg-card p-1 rounded-xl border border-border">
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 rounded-lg text-xs font-semibold transition-all min-h-[34px] flex items-center space-x-1 ${
                  viewMode === 'table' ? 'bg-amber-500/20 text-amber-600 font-bold border border-amber-500/30' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Режим Таблицы (для ПК)"
              >
                <TableIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Таблица</span>
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 rounded-lg text-xs font-semibold transition-all min-h-[34px] flex items-center space-x-1 ${
                  viewMode === 'cards' ? 'bg-amber-500/20 text-amber-600 font-bold border border-amber-500/30' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Режим Карточек (для мобильных)"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Карточки</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ОТОБРАЖЕНИЕ ТАБЛИЦЫ С RESIZING, ФИЛЬТРАМИ И RIGHT-CLICK МЕНЮ */}
      {viewMode === 'table' ? (
        <Card className="relative z-10 bg-card border-border shadow-2xl overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground text-sm">Загрузка данных...</div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="border-collapse w-full">
                  <TableHeader className="bg-muted/60 border-b border-border">
                    <TableRow>
                      {visibleColumns.map((col) => {
                        const isSorted = sortKey === col.key;
                        const currentW = colWidths[col.key] || col.width || 160;
                        const hasFilter = !!columnFilters[col.key];

                        return (
                          <TableHead
                            key={col.key}
                            style={{ width: `${currentW}px`, minWidth: `${currentW}px` }}
                            draggable
                            onDragStart={(e) => handleDragStart(e, col.key)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.key)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({
                                type: 'header',
                                x: e.clientX,
                                y: e.clientY,
                                colKey: col.key,
                              });
                            }}
                            className={`relative group select-none text-foreground font-semibold border-r border-border/40 last:border-r-0 transition-colors ${
                              isCompact ? 'py-1.5 px-2 text-xs' : 'py-3 px-4 text-xs'
                            }`}
                          >
                            <div className="flex items-center justify-between space-x-2">
                              {/* Заголовок + Сортировка */}
                              <div
                                onClick={() => col.sortable !== false && handleSort(col.key)}
                                className="flex items-center space-x-1.5 cursor-pointer hover:text-amber-400 truncate"
                              >
                                <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0" />
                                <span className="truncate">{col.label}</span>
                                {isSorted && (
                                  <span className="text-amber-500 font-bold text-[10px]">
                                    {sortOrder === 'asc' ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>

                              {/* Интерактивный фильтр по типам данных */}
                              <div className="relative flex items-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveFilterPopover(activeFilterPopover === col.key ? null : col.key);
                                  }}
                                  className={`p-1 rounded hover:bg-accent transition-colors ${
                                    hasFilter ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'
                                  }`}
                                  title="Фильтр по полю"
                                >
                                  <Filter className="h-3.5 w-3.5" />
                                </button>

                                {activeFilterPopover === col.key && (
                                  <FilterPopover
                                    column={col}
                                    columnFilters={columnFilters}
                                    setColumnFilters={setColumnFilters}
                                    onClose={() => setActiveFilterPopover(null)}
                                  />
                                )}
                              </div>
                            </div>

                            {/* Drag-to-Resize Маркер */}
                            <div
                              onMouseDown={(e) => handleMouseDownResize(e, col.key, currentW)}
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-amber-500/50 transition-colors z-20"
                              title="Потяните для изменения ширины"
                            />
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={visibleColumns.length || 1} className="py-12 text-center text-muted-foreground text-sm">
                          {emptyMessage}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedData.map((item) => {
                        const rowId = keyExtractor(item);
                        return (
                          <TableRow
                            key={rowId}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({
                                type: 'row',
                                x: e.clientX,
                                y: e.clientY,
                                rowItem: item,
                              });
                            }}
                            className={`border-b border-border/60 hover:bg-muted/40 transition-colors cursor-pointer ${
                              isCompact ? 'py-1 px-2 text-xs' : 'py-2.5 px-4 text-xs'
                            }`}
                          >
                            {visibleColumns.map((col) => {
                              const currentW = colWidths[col.key] || col.width || 160;
                              return (
                                <TableCell
                                  key={col.key}
                                  style={{ width: `${currentW}px`, minWidth: `${currentW}px` }}
                                  className={isCompact ? 'py-1 px-2 text-xs text-foreground' : 'py-2.5 px-4 text-xs text-foreground'}
                                >
                                  {col.render ? col.render(item) : item[col.key]}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* РЕЖИМ КАРТОЧЕК */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-full p-12 text-center text-slate-400 text-sm">Загрузка данных...</div>
          ) : paginatedData.length === 0 ? (
            <div className="col-span-full p-12 text-center text-slate-500 text-sm">{emptyMessage}</div>
          ) : (
            paginatedData.map((item) => {
              const rowId = keyExtractor(item);
              const actions = getRowActions ? getRowActions(item) : [];

              return (
                <div
                  key={rowId}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      type: 'row',
                      x: e.clientX,
                      y: e.clientY,
                      rowItem: item,
                    });
                  }}
                  className="relative group"
                >
                  {renderCard ? (
                    renderCard(item)
                  ) : (
                    <Card className="bg-card border-border p-4 space-y-2 hover:border-amber-500/40 transition-all">
                      <div className="flex justify-between items-center border-b border-border pb-2">
                        <span className="font-bold text-xs text-foreground">Запись ID: {rowId}</span>
                        {actions.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                type: 'row',
                                x: rect.left,
                                y: rect.bottom,
                                rowItem: item,
                              });
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {visibleColumns.map((col) => (
                        <div key={col.key} className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground font-medium">{col.label}:</span>
                          <span className="text-foreground font-semibold">{col.render ? col.render(item) : item[col.key]}</span>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ПЛАВАЮЩЕЕ КОНТЕКСТНОЕ МЕНЮ (RIGHT-CLICK) */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-56 bg-card border border-border rounded-xl shadow-2xl p-1.5 space-y-1 ring-1 ring-border text-xs animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'header' ? (
            <>
              <div className="font-bold text-[11px] text-muted-foreground px-2 py-1 border-b border-border">
                Настройки шапки таблицы
              </div>
              <button
                onClick={() => {
                  resetWidths();
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground flex items-center space-x-2"
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                <span>Сбросить размеры колонок</span>
              </button>
              <button
                onClick={() => {
                  resetFilters();
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground flex items-center space-x-2"
              >
                <X className="h-3.5 w-3.5 text-red-400" />
                <span>Сбросить все фильтры</span>
              </button>
            </>
          ) : (
            <>
              <div className="font-bold text-[11px] text-muted-foreground px-2 py-1 border-b border-border">
                Действия над записью
              </div>
              {contextMenu.rowItem && getRowActions ? (
                getRowActions(contextMenu.rowItem).map((act, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      act.action(contextMenu.rowItem!);
                      setContextMenu(null);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center space-x-2 transition-colors ${
                      act.danger ? 'hover:bg-red-500/10 text-red-400' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {act.icon && <span className="h-3.5 w-3.5 flex-shrink-0">{act.icon}</span>}
                    <span>{act.label}</span>
                  </button>
                ))
              ) : (
                <div className="text-muted-foreground px-2 py-1 text-center">Нет доступных действий</div>
              )}
            </>
          )}
        </div>
      )}

      {/* ЕДИНООБРАЗНАЯ ПАГИНАЦИЯ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center space-x-3 text-xs text-muted-foreground font-mono">
          <span>Размер страницы:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const val = e.target.value;
              setPageSize(val === 'all' ? 'all' : (Number(val) as any));
            }}
            className="bg-card border border-border text-amber-500 font-bold text-xs rounded-xl px-2.5 py-1.5 min-h-[36px]"
          >
            <option value={25}>25 записей</option>
            <option value={50}>50 записей</option>
            <option value={100}>100 записей</option>
            <option value="all">Все записи ({totalItems})</option>
          </select>

          <span>
            Показано <strong className="text-foreground">{pageSize === 'all' ? totalItems : Math.min(totalItems, (currentPage - 1) * pageSize + 1)}</strong> - <strong className="text-foreground">{pageSize === 'all' ? totalItems : Math.min(totalItems, currentPage * pageSize)}</strong> из <strong className="text-foreground">{totalItems}</strong>
          </span>
        </div>

        {pageSize !== 'all' && totalPages > 1 && (
          <div className="flex items-center space-x-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="border-border text-foreground min-h-[36px] text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <span className="text-xs font-mono text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="border-border text-foreground min-h-[36px] text-xs"
            >
              Вперед
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Компонент типажно-зависимого фильтра в шапке
function FilterPopover<T>({
  column,
  columnFilters,
  setColumnFilters,
  onClose,
}: {
  column: ColumnDef<T>;
  columnFilters: Record<string, any>;
  setColumnFilters: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onClose: () => void;
}) {
  const currentVal = columnFilters[column.key];

  // 1. Фильтр справочников (Enum / Dictionary)
  if (column.type === 'dictionary' && column.dictionaryOptions) {
    const selectedList: string[] = Array.isArray(currentVal) ? currentVal : [];

    const toggleAll = () => {
      if (selectedList.length === column.dictionaryOptions!.length) {
        setColumnFilters((prev) => ({ ...prev, [column.key]: [] }));
      } else {
        setColumnFilters((prev) => ({
          ...prev,
          [column.key]: column.dictionaryOptions!.map((o) => String(o.value)),
        }));
      }
    };

    const toggleItem = (val: string) => {
      const exists = selectedList.includes(val);
      const next = exists ? selectedList.filter((v) => v !== val) : [...selectedList, val];
      setColumnFilters((prev) => ({ ...prev, [column.key]: next }));
    };

    return (
      <div className="absolute right-0 top-7 z-50 w-60 bg-card border border-border rounded-xl p-3 shadow-2xl space-y-2 text-xs text-foreground ring-1 ring-border">
        <div className="flex items-center justify-between font-bold text-[11px] border-b border-border pb-1.5">
          <span>Справочник: {column.label}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex items-center space-x-2 border-b border-border/60 pb-1.5">
          <Checkbox
            checked={selectedList.length === column.dictionaryOptions.length && selectedList.length > 0}
            onCheckedChange={toggleAll}
          />
          <span className="text-xs font-bold">Выбрать все</span>
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
          {column.dictionaryOptions.map((opt) => {
            const strVal = String(opt.value);
            return (
              <label key={strVal} className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer">
                <Checkbox checked={selectedList.includes(strVal)} onCheckedChange={() => toggleItem(strVal)} />
                <span className="truncate">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  // 2. Числовой фильтр (Диапазон От - До)
  if (column.type === 'number') {
    const range = currentVal || { min: '', max: '' };

    return (
      <div className="absolute right-0 top-7 z-50 w-56 bg-card border border-border rounded-xl p-3 shadow-2xl space-y-2 text-xs text-foreground ring-1 ring-border">
        <div className="flex items-center justify-between font-bold text-[11px] border-b border-border pb-1.5">
          <span>Диапазон: {column.label}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">От:</label>
            <Input
              type="number"
              placeholder="0"
              value={range.min || ''}
              onChange={(e) =>
                setColumnFilters((prev) => ({
                  ...prev,
                  [column.key]: { ...range, min: e.target.value },
                }))
              }
              className="h-7 text-xs bg-background border-border text-foreground"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">До:</label>
            <Input
              type="number"
              placeholder="99999"
              value={range.max || ''}
              onChange={(e) =>
                setColumnFilters((prev) => ({
                  ...prev,
                  [column.key]: { ...range, max: e.target.value },
                }))
              }
              className="h-7 text-xs bg-background border-border text-foreground"
            />
          </div>
        </div>
      </div>
    );
  }

  // 3. Фильтр дат (Интервал С - По)
  if (column.type === 'date') {
    const dates = currentVal || { from: '', to: '' };

    return (
      <div className="absolute right-0 top-7 z-50 w-60 bg-card border border-border rounded-xl p-3 shadow-2xl space-y-2 text-xs text-foreground ring-1 ring-border">
        <div className="flex items-center justify-between font-bold text-[11px] border-b border-border pb-1.5">
          <span>Период: {column.label}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground">С даты:</label>
            <Input
              type="date"
              value={dates.from || ''}
              onChange={(e) =>
                setColumnFilters((prev) => ({
                  ...prev,
                  [column.key]: { ...dates, from: e.target.value },
                }))
              }
              className="h-7 text-xs bg-background border-border text-foreground"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">По дату:</label>
            <Input
              type="date"
              value={dates.to || ''}
              onChange={(e) =>
                setColumnFilters((prev) => ({
                  ...prev,
                  [column.key]: { ...dates, to: e.target.value },
                }))
              }
              className="h-7 text-xs bg-background border-border text-foreground"
            />
          </div>
        </div>
      </div>
    );
  }

  // 4. Текстовый фильтр по умолчанию
  return (
    <div className="absolute right-0 top-7 z-50 w-56 bg-card border border-border rounded-xl p-3 shadow-2xl space-y-2 text-xs text-foreground ring-1 ring-border">
      <div className="flex items-center justify-between font-bold text-[11px] border-b border-border pb-1.5">
        <span>Поиск: {column.label}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
      <Input
        autoFocus
        placeholder="Содержит текст..."
        value={typeof currentVal === 'string' ? currentVal : ''}
        onChange={(e) =>
          setColumnFilters((prev) => ({
            ...prev,
            [column.key]: e.target.value,
          }))
        }
        className="h-8 text-xs bg-background border-border text-foreground"
      />
    </div>
  );
}
