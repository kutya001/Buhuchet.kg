'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  ChevronUp,
  ArrowUpDown,
  Filter,
  EyeOff,
  Eye,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Search,
  RotateCcw,
} from 'lucide-react';

export type ColumnDef<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  hiddenByDefault?: boolean;
  render?: (item: T) => React.ReactNode;
  getValue?: (item: T) => any;
};

export type UnifiedDataGridProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  renderCard?: (item: T) => React.ReactNode;
  title?: string;
  subtitle?: string;
  searchPlaceholder?: string;
  actionButton?: React.ReactNode;
  emptyMessage?: string;
  isLoading?: boolean;
  defaultPageSize?: 25 | 50 | 100 | 'all';
};

export function UnifiedDataGrid<T extends Record<string, any>>({
  columns: initialColumns,
  data,
  keyExtractor,
  renderCard,
  title,
  subtitle,
  searchPlaceholder = 'Поиск по записям...',
  actionButton,
  emptyMessage = 'Записи не найдены',
  isLoading = false,
  defaultPageSize = 25,
}: UnifiedDataGridProps<T>) {
  // 1. Порядок и конфигурация столбцов
  const [columns, setColumns] = useState<ColumnDef<T>[]>(initialColumns);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    initialColumns.forEach((c) => {
      if (!c.hiddenByDefault) keys.add(c.key);
    });
    return keys;
  });

  // 2. Режим отображения: Таблица vs Карточки (На ПК по умолчанию Таблица, на Мобильных — Карточки)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  useEffect(() => {
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
  }, []);

  // 3. Поиск, Сортировка и Фильтрация по столбцам
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeMenuColumn, setActiveMenuColumn] = useState<string | null>(null);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);

  // 4. Пагинация (25 / 50 / 100 / 'all')
  const [pageSize, setPageSize] = useState<25 | 50 | 100 | 'all'>(defaultPageSize);
  const [currentPage, setCurrentPage] = useState(1);

  // 5. Drag & Drop перетягивание столбцов
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

  // Сброс пагинации при изменении условий
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortKey, sortOrder, columnFilters, pageSize]);

  // Фильтрация и Сортировка данных
  const processedData = useMemo(() => {
    let result = [...data];

    // Поисковый запрос по всем видимым полям
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

    // Фильтры по отдельным столбцам
    Object.entries(columnFilters).forEach(([colKey, filterVal]) => {
      if (filterVal.trim()) {
        const f = filterVal.toLowerCase().trim();
        const col = columns.find((c) => c.key === colKey);
        result = result.filter((item) => {
          const val = col?.getValue ? col.getValue(item) : item[colKey];
          return val != null && String(val).toLowerCase().includes(f);
        });
      }
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

  // Пагинированные данные
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
    <div className="space-y-4">
      {/* ВЕРХНЯЯ ПАНЕЛЬ С ИНСТРУМЕНТАМИИ, ПОИСКОМ И ТУМБЛЕРАМИ */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-md">
        {/* Заголовок или Поиск */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
          {title && (
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
              {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
          )}

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border-slate-800 text-white text-xs pl-9 min-h-[40px] focus:border-amber-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Инструменты: Вид, Столбцы, Действие */}
        <div className="flex flex-wrap items-center gap-2">
          {actionButton}

          {/* КОНТРОЛЬ ВИДИМОСТИ СТОЛБЦОВ */}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
              className="border-slate-800 bg-slate-950 text-slate-300 hover:text-white text-xs min-h-[40px]"
            >
              <SlidersHorizontal className="h-4 w-4 mr-1.5 text-amber-400" />
              Столбцы ({visibleColumns.length}/{columns.length})
            </Button>

            {showVisibilityMenu && (
              <div className="absolute right-0 top-12 z-50 w-56 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300 border-b border-slate-800 pb-2">
                  <span>Отображение столбцов</span>
                  <button onClick={() => setShowVisibilityMenu(false)} className="text-slate-500 hover:text-white">
                    ✕
                  </button>
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                  {columns.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center space-x-2 text-xs text-slate-300 hover:bg-slate-800/60 p-1.5 rounded-lg cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleColumnKeys.has(col.key)}
                        onChange={() => toggleColumnVisibility(col.key)}
                        className="rounded bg-slate-950 border-slate-700 text-amber-500"
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ТУМБЛЕР ПЕРЕКЛЮЧЕНИЯ ТАБЛИЦА / КАРТОЧКИ */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 rounded-lg text-xs font-semibold transition-all min-h-[34px] flex items-center space-x-1 ${
                viewMode === 'table' ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : 'text-slate-400 hover:text-white'
              }`}
              title="Режим Таблицы (для ПК)"
            >
              <TableIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Таблица</span>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-2 rounded-lg text-xs font-semibold transition-all min-h-[34px] flex items-center space-x-1 ${
                viewMode === 'cards' ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : 'text-slate-400 hover:text-white'
              }`}
              title="Режим Карточек (для мобильных)"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Карточки</span>
            </button>
          </div>
        </div>
      </div>

      {/* ОТОБРАЖЕНИЕ РЕЖИМА 1: ТАБЛИЦА С DRAG&DROP И КНОПКОЙ ТРЕУГОЛЬНИКОМ ▼ */}
      {viewMode === 'table' ? (
        <Card className="bg-slate-900/50 border-slate-800 overflow-hidden shadow-2xl">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400 text-sm">Загрузка данных...</div>
            ) : paginatedData.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm">{emptyMessage}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-950/80">
                    <TableRow>
                      {visibleColumns.map((col) => {
                        const isSorted = sortKey === col.key;
                        const isMenuOpen = activeMenuColumn === col.key;
                        const hasFilter = !!columnFilters[col.key];

                        return (
                          <TableHead
                            key={col.key}
                            draggable
                            onDragStart={(e) => handleDragStart(e, col.key)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, col.key)}
                            className="relative group select-none text-slate-300 font-semibold text-xs border-b border-slate-800 py-3"
                          >
                            <div className="flex items-center justify-between space-x-2">
                              {/* Перетягиваемый элемент и сортировка по клику */}
                              <div
                                onClick={() => col.sortable !== false && handleSort(col.key)}
                                className="flex items-center space-x-1.5 cursor-pointer hover:text-white truncate"
                              >
                                <GripVertical className="h-3 w-3 text-slate-600 group-hover:text-slate-400 cursor-grab" />
                                <span className="truncate">{col.label}</span>
                                {isSorted && (
                                  <span className="text-amber-400 font-bold text-[10px]">
                                    {sortOrder === 'asc' ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>

                              {/* КНОПКА С ПЕРЕВЕРНУТЫМ ТРЕУГОЛЬНИКОМ (▼) С ВЫПАДАЮЩИМ МЕНЮ */}
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuColumn(isMenuOpen ? null : col.key);
                                  }}
                                  className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                                    hasFilter ? 'text-amber-400' : 'text-slate-500 hover:text-slate-200'
                                  }`}
                                  title="Опции столбца (Сортировка, Фильтр, Скрыть)"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>

                                {/* ВЫПАДАЮЩЕЕ МЕНЮ ТРЕУГОЛЬНИКА С ОПЦИЯМИ */}
                                {isMenuOpen && (
                                  <div className="absolute right-0 top-7 z-50 w-52 bg-slate-950 border border-slate-800 rounded-xl p-2.5 shadow-2xl space-y-2 text-xs font-normal">
                                    <div className="font-bold text-slate-300 border-b border-slate-800 pb-1.5 flex justify-between items-center">
                                      <span className="truncate">{col.label}</span>
                                      <button onClick={() => setActiveMenuColumn(null)} className="text-slate-500 hover:text-white">
                                        ✕
                                      </button>
                                    </div>

                                    <div className="space-y-1">
                                      <button
                                        onClick={() => {
                                          setSortKey(col.key);
                                          setSortOrder('asc');
                                          setActiveMenuColumn(null);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-900 text-slate-300 flex items-center space-x-2"
                                      >
                                        <ChevronUp className="h-3.5 w-3.5 text-amber-400" />
                                        <span>Сортировка А-Я (▲)</span>
                                      </button>

                                      <button
                                        onClick={() => {
                                          setSortKey(col.key);
                                          setSortOrder('desc');
                                          setActiveMenuColumn(null);
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-900 text-slate-300 flex items-center space-x-2"
                                      >
                                        <ChevronDown className="h-3.5 w-3.5 text-amber-400" />
                                        <span>Сортировка Я-А (▼)</span>
                                      </button>
                                    </div>

                                    {/* Фильтр по этому столбцу */}
                                    <div className="pt-1 border-t border-slate-800 space-y-1">
                                      <span className="text-[10px] text-slate-400 block font-semibold">Фильтр по полю:</span>
                                      <Input
                                        placeholder="Поиск..."
                                        value={columnFilters[col.key] || ''}
                                        onChange={(e) =>
                                          setColumnFilters((prev) => ({
                                            ...prev,
                                            [col.key]: e.target.value,
                                          }))
                                        }
                                        className="h-7 text-xs bg-slate-900 border-slate-800 text-white"
                                      />
                                    </div>

                                    <button
                                      onClick={() => {
                                        toggleColumnVisibility(col.key);
                                        setActiveMenuColumn(null);
                                      }}
                                      className="w-full text-left px-2 py-1.5 rounded hover:bg-red-500/10 text-red-400 flex items-center space-x-2 pt-1 border-t border-slate-800"
                                    >
                                      <EyeOff className="h-3.5 w-3.5" />
                                      <span>Скрыть столбец</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedData.map((item) => (
                      <TableRow key={keyExtractor(item)} className="hover:bg-slate-800/40 transition-colors">
                        {visibleColumns.map((col) => (
                          <TableCell key={col.key} className="py-3 text-xs text-slate-200">
                            {col.render ? col.render(item) : item[col.key]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ОТОБРАЖЕНИЕ РЕЖИМА 2: СЕТКА КАРТОЧЕК */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-full p-12 text-center text-slate-400 text-sm">Загрузка данных...</div>
          ) : paginatedData.length === 0 ? (
            <div className="col-span-full p-12 text-center text-slate-500 text-sm">{emptyMessage}</div>
          ) : (
            paginatedData.map((item) => (
              <div key={keyExtractor(item)}>
                {renderCard ? (
                  renderCard(item)
                ) : (
                  <Card className="bg-slate-900/60 border-slate-800 p-4 space-y-2">
                    {visibleColumns.map((col) => (
                      <div key={col.key} className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-medium">{col.label}:</span>
                        <span className="text-white font-semibold">{col.render ? col.render(item) : item[col.key]}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ЕДИНООБРАЗНАЯ ПАГИНАЦИЯ (25-50-100-ВСЕ) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
          <span>Размер страницы:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const val = e.target.value;
              setPageSize(val === 'all' ? 'all' : (Number(val) as any));
            }}
            className="bg-slate-950 border border-slate-800 text-amber-400 font-bold text-xs rounded-xl px-2.5 py-1.5 min-h-[36px]"
          >
            <option value={25}>25 записей</option>
            <option value={50}>50 записей</option>
            <option value={100}>100 записей</option>
            <option value="all">Все записи ({totalItems})</option>
          </select>

          <span>
            Показано <strong className="text-white">{pageSize === 'all' ? totalItems : Math.min(totalItems, (currentPage - 1) * pageSize + 1)}</strong> - <strong className="text-white">{pageSize === 'all' ? totalItems : Math.min(totalItems, currentPage * pageSize)}</strong> из <strong className="text-white">{totalItems}</strong>
          </span>
        </div>

        {pageSize !== 'all' && totalPages > 1 && (
          <div className="flex items-center space-x-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="border-slate-800 text-slate-300 min-h-[36px] text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <span className="text-xs font-mono text-slate-400">
              {currentPage} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="border-slate-800 text-slate-300 min-h-[36px] text-xs"
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
