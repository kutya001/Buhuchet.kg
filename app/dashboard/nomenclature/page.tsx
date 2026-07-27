'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Barcode,
  Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  createNomenclatureAction,
  updateNomenclatureAction,
  deleteNomenclatureAction,
} from './actions';
import { UNITS } from '@/types/nomenclature.types';
import type { Nomenclature } from '@/types/database.types';

export default function NomenclaturePage() {
  const [items, setItems] = useState<Nomenclature[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();

  // Модальные состояния
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Nomenclature | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Формовые поля
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState('шт');
  const [price, setPrice] = useState('0.00');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadNomenclature = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('nomenclature')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setItems(data as Nomenclature[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadNomenclature();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingItem(null);
    setTitle('');
    setCode('');
    setUnit('шт');
    setPrice('0.00');
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (item: Nomenclature) => {
    setEditingItem(item);
    setTitle(item.title);
    setCode(item.code || '');
    setUnit(item.unit || 'шт');
    setPrice(item.price?.toString() || '0.00');
    setIsFormModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    const formData = new FormData();
    if (editingItem) {
      formData.append('id', editingItem.id);
    }
    formData.append('title', title);
    formData.append('code', code);
    formData.append('unit', unit);
    formData.append('price', price);

    startTransition(async () => {
      const res = editingItem
        ? await updateNomenclatureAction(formData)
        : await createNomenclatureAction(formData);

      if (res.success) {
        setMsg({
          type: 'success',
          text: `Товар/услуга "${title}" успешно ${editingItem ? 'обновлен(а)' : 'создан(а)'}!`,
        });
        setIsFormModalOpen(false);
        loadNomenclature();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при сохранении' });
      }
    });
  };

  const handleDeleteConfirm = (id: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await deleteNomenclatureAction(id);
      if (res.success) {
        setMsg({ type: 'success', text: 'Позиция успешно удалена из номенклатуры.' });
        setDeletingId(null);
        loadNomenclature();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления товара' });
      }
    });
  };

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Справочник Номенклатуры</h2>
          <p className="text-sm text-slate-400 mt-1">
            Товары, материалы и оказываемые услуги компании (всего: {items.length})
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по наименованию или коду..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-900/60 border-slate-800 text-slate-100"
            />
          </div>

          <Button onClick={handleOpenCreateModal} className="bg-blue-600 hover:bg-blue-500 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Добавить Позицию
          </Button>
        </div>
      </div>

      {msg && (
        <Alert
          variant={msg.type === 'success' ? 'success' : 'destructive'}
          className={
            msg.type === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/50 bg-red-500/10 text-red-400'
          }
        >
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* Таблица Номенклатуры */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка номенклатуры...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              {searchTerm ? 'Товары по вашему запросу не найдены' : 'Справочник товаров пуст. Нажмите "Добавить Позицию"'}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Наименование Товара / Услуги</TableHead>
                  <TableHead>Код 1С / Артикул</TableHead>
                  <TableHead>Ед. Измерения</TableHead>
                  <TableHead>Базовая Цена (сом)</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium text-white flex items-center space-x-2">
                        <Package className="h-4 w-4 text-purple-400 flex-shrink-0" />
                        <span>{item.title}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-slate-300 text-xs">
                      {item.code || '—'}
                    </TableCell>

                    <TableCell className="text-slate-300 text-xs font-mono">
                      {item.unit || 'шт'}
                    </TableCell>

                    <TableCell className="font-mono font-bold text-emerald-400 text-sm">
                      {Number(item.price).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEditModal(item)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeletingId(item.id)}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Модалка Создания / Редактирования */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg bg-slate-900 border-slate-800 shadow-2xl">
            <div className="p-6 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center">
                <Package className="h-5 w-5 mr-2 text-purple-400" />
                {editingItem ? 'Редактирование Позиции' : 'Новая Товарная Позиция'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Укажите название, код из 1С и базовую стоимость
              </p>
            </div>

            <form onSubmit={handleSaveForm}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="n_title">Наименование Товара / Услуги</Label>
                  <Input
                    id="n_title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Вода Легенда 1.5л ПЭТ"
                    required
                    className="bg-slate-950 border-slate-800 text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="n_code">Код / Артикул (из 1С)</Label>
                    <div className="relative">
                      <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <Input
                        id="n_code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="1C-0042"
                        className="pl-9 bg-slate-950 border-slate-800 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="n_unit">Единица Измерения</Label>
                    <select
                      id="n_unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="n_price">Базовая цена продажи (сом)</Label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      id="n_price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="35.00"
                      required
                      className="pl-9 bg-slate-950 border-slate-800 text-slate-100 font-mono font-bold text-emerald-400"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 pt-0 flex justify-end space-x-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsFormModalOpen(false)}
                  className="border-slate-800 text-slate-400"
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Сохранение...
                    </>
                  ) : editingItem ? (
                    'Сохранить изменения'
                  ) : (
                    'Добавить товар'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Модалка Удаления */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-slate-900 border-slate-800 shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-red-400" />
              Подтверждение удаления
            </h3>
            <p className="text-sm text-slate-300">
              Вы действительно хотите удалить этот товар из номенклатуры?
            </p>
            <div className="flex justify-end space-x-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setDeletingId(null)}
                className="border-slate-800 text-slate-400"
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteConfirm(deletingId)}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
