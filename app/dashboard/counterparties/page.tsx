'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  Phone,
  MessageSquare,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  createCounterpartyAction,
  updateCounterpartyAction,
  deleteCounterpartyAction,
} from './actions';
import type { Counterparty } from '@/types/database.types';

export default function CounterpartiesPage() {
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();

  // Модальные состояния
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Counterparty | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Формовые поля
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [isVatPayer, setIsVatPayer] = useState(false);
  const [phone, setPhone] = useState('+996 ');
  const [comment, setComment] = useState('');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadCounterparties = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('counterparties')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setCounterparties(data as Counterparty[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCounterparties();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingItem(null);
    setName('');
    setInn('');
    setIsVatPayer(false);
    setPhone('+996 ');
    setComment('');
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (item: Counterparty) => {
    setEditingItem(item);
    setName(item.name);
    setInn(item.inn);
    setIsVatPayer(item.is_vat_payer);
    setPhone(item.phone || '+996 ');
    setComment(item.comment || '');
    setIsFormModalOpen(true);
  };

  const handleInnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 14);
    setInn(digits);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let input = e.target.value;
    if (!input.startsWith('+996')) input = '+996 ';
    const digits = input.slice(4).replace(/\D/g, '').slice(0, 9);
    let formatted = '+996';
    if (digits.length > 0) formatted += ` (${digits.slice(0, 3)}`;
    if (digits.length >= 4) formatted += `) ${digits.slice(3, 5)}`;
    if (digits.length >= 6) formatted += `-${digits.slice(5, 7)}`;
    if (digits.length >= 8) formatted += `-${digits.slice(7, 9)}`;
    setPhone(formatted);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    const formData = new FormData();
    if (editingItem) {
      formData.append('id', editingItem.id);
    }
    formData.append('name', name);
    formData.append('inn', inn);
    formData.append('is_vat_payer', isVatPayer ? 'true' : 'false');
    formData.append('phone', phone);
    formData.append('comment', comment);

    startTransition(async () => {
      const res = editingItem
        ? await updateCounterpartyAction(formData)
        : await createCounterpartyAction(formData);

      if (res.success) {
        setMsg({
          type: 'success',
          text: `Контрагент "${name}" успешно ${editingItem ? 'обновлен' : 'создан'}!`,
        });
        setIsFormModalOpen(false);
        loadCounterparties();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при сохранении' });
      }
    });
  };

  const handleDeleteConfirm = (id: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await deleteCounterpartyAction(id);
      if (res.success) {
        setMsg({ type: 'success', text: 'Контрагент успешно удален из справочника.' });
        setDeletingId(null);
        loadCounterparties();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка удаления контрагента' });
      }
    });
  };

  const filteredCounterparties = counterparties.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.inn.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Справочник Контрагентов</h2>
          <p className="text-sm text-slate-400 mt-1">
            База клиентов, поставщиков и партнеров компании (всего: {counterparties.length})
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по названию или ИНН..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-900/60 border-slate-800 text-slate-100"
            />
          </div>

          <Button onClick={handleOpenCreateModal} className="bg-blue-600 hover:bg-blue-500 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Добавить Контрагента
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

      {/* Таблица Контрагентов */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка справочника контрагентов...</span>
            </div>
          ) : filteredCounterparties.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              {searchTerm ? 'Контрагенты по вашему запросу не найдены' : 'Справочник контрагентов пуст. Нажмите "Добавить Контрагента"'}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Наименование Контрагента</TableHead>
                  <TableHead>ИНН (14 цифр)</TableHead>
                  <TableHead>Учет НДС</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Примечание</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCounterparties.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium text-white flex items-center space-x-2">
                        <Users className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <span>{item.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-slate-300 text-xs">
                      {item.inn}
                    </TableCell>

                    <TableCell>
                      {item.is_vat_payer ? (
                        <Badge variant="success" className="text-[10px]">
                          Плательщик НДС (12%)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-800">
                          Без НДС
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="font-mono text-slate-300 text-xs">
                      {item.phone || '—'}
                    </TableCell>

                    <TableCell className="text-slate-400 text-xs max-w-xs truncate">
                      {item.comment || '—'}
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
                <Users className="h-5 w-5 mr-2 text-blue-400" />
                {editingItem ? 'Редактирование Контрагента' : 'Новый Контрагент'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Заполните реквизиты контрагента в соответствии со стандартами КР
              </p>
            </div>

            <form onSubmit={handleSaveForm}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="c_name">Наименование (ОсОО / ИП / Физлицо)</Label>
                  <Input
                    id="c_name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ОсОО «Торговый Дом»"
                    required
                    className="bg-slate-950 border-slate-800 text-slate-100"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="c_inn">ИНН (14 цифр)</Label>
                    <span className="text-[11px] font-mono text-slate-500">{inn.length} / 14</span>
                  </div>
                  <div className="relative">
                    <FileCheck2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      id="c_inn"
                      value={inn}
                      onChange={handleInnChange}
                      placeholder="20101202310050"
                      required
                      maxLength={14}
                      className="pl-9 bg-slate-950 border-slate-800 text-slate-100 font-mono tracking-wider"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="c_vat"
                    checked={isVatPayer}
                    onChange={(e) => setIsVatPayer(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-800 bg-slate-950 text-blue-600 focus:ring-blue-500"
                  />
                  <Label htmlFor="c_vat" className="cursor-pointer text-slate-200">
                    Организация является плательщиком НДС (12%)
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c_phone">Телефон (+996)</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      id="c_phone"
                      value={phone}
                      onChange={handlePhoneChange}
                      placeholder="+996 (555) 00-11-22"
                      className="pl-9 bg-slate-950 border-slate-800 text-slate-100 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c_comment">Примечание</Label>
                  <Input
                    id="c_comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Дополнительные контакты или отсрочка"
                    className="bg-slate-950 border-slate-800 text-slate-100"
                  />
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
                  disabled={isPending || inn.length !== 14}
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
                    'Создать контрагента'
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
              Вы действительно хотите удалить этого контрагента из справочника компании?
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
