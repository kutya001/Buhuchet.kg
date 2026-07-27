'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FileText,
  Plus,
  Trash2,
  Building2,
  Calendar,
  Tag,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Package,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { createDocumentAction } from '../actions';
import { MockDropzone } from '@/components/documents/MockDropzone';
import type { Counterparty, Nomenclature, DocumentType } from '@/types/database.types';

interface ItemRow {
  id: string;
  nomenclature_id?: string;
  title: string;
  quantity: number;
  price: number;
  total: number;
}

export default function NewDocumentPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [nomenclatures, setNomenclatures] = useState<Nomenclature[]>([]);
  const [loading, setLoading] = useState(true);

  // Поля формы
  const [docType, setDocType] = useState<DocumentType>('realization');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);
  const [comment, setComment] = useState('');

  // Мок-файл
  const [mockFileName, setMockFileName] = useState<string | null>(null);
  const [mockFileSize, setMockFileSize] = useState<string | null>(null);

  // Табличная часть
  const [items, setItems] = useState<ItemRow[]>([
    { id: '1', title: '', quantity: 1, price: 0, total: 0 },
  ]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadData() {
      const { data: cData } = await supabase.from('counterparties').select('*').order('name');
      const { data: nData } = await supabase.from('nomenclature').select('*').order('title');

      if (cData) setCounterparties(cData as Counterparty[]);
      if (nData) setNomenclatures(nData as Nomenclature[]);
      setLoading(false);
    }
    loadData();
  }, []);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), title: '', quantity: 1, price: 0, total: 0 },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof ItemRow, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };

      if (field === 'nomenclature_id') {
        const nom = nomenclatures.find((n) => n.id === value);
        if (nom) {
          row.title = nom.title;
          row.price = Number(nom.price);
        }
      }

      row.total = Number(row.quantity) * Number(row.price);
      updated[index] = row;
      return updated;
    });
  };

  const grandTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const docPayload = {
      doc_type: docType,
      counterparty_id: counterpartyId || null,
      doc_number: docNumber || null,
      doc_date: docDate,
      comment: comment || null,
      status: 'draft',
      mock_file_name: mockFileName,
      mock_file_size: mockFileSize,
      items: items.map((i) => ({
        nomenclature_id: i.nomenclature_id || null,
        title: i.title,
        quantity: Number(i.quantity),
        price: Number(i.price),
        total: Number(i.total),
      })),
    };

    startTransition(async () => {
      const res = await createDocumentAction(docPayload);
      if (res.success && res.data) {
        router.push(`/dashboard/documents/${res.data.id}`);
      } else {
        setErrorMsg(res.error || 'Ошибка сохранения документа');
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        <span>Загрузка данных для формы...</span>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/dashboard/documents">
            <Button variant="outline" size="sm" className="border-slate-800 text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" />
              К реестру
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Создание Документа</h2>
            <p className="text-sm text-slate-400">Формирование первичного документа и прикрепление скана</p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Шапка документа */}
        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <FileText className="h-5 w-5 mr-2 text-blue-400" />
              Реквизиты Шапки Документа
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc_type">Тип Документа</Label>
              <select
                id="doc_type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
                className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="realization">Реализация (Продажа)</option>
                <option value="purchase">Закуп (Поступление)</option>
                <option value="payment">Оплата (Чек / Перевод)</option>
                <option value="advance">Авансовый отчет</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="counterparty_id">Контрагент</Label>
              <select
                id="counterparty_id"
                value={counterpartyId}
                onChange={(e) => setCounterpartyId(e.target.value)}
                className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Выберите из Справочника --</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (ИНН: {c.inn})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc_number">Номер Документа</Label>
              <Input
                id="doc_number"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="102-А"
                className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc_date">Дата Документа</Label>
              <Input
                id="doc_date"
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                required
                className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="comment">Примечание / Комментарий</Label>
              <Input
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: Поставка по договору №45"
                className="bg-slate-950 border-slate-800 text-slate-100"
              />
            </div>
          </CardContent>
        </Card>

        {/* Дропзона Скана */}
        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader>
            <CardTitle className="text-lg">Скан или фото накладной</CardTitle>
            <CardDescription>Прикрепите фото оригинал-документа для проверки бухгалтером</CardDescription>
          </CardHeader>
          <CardContent>
            <MockDropzone
              fileName={mockFileName}
              fileSize={mockFileSize}
              onFileUploaded={(name, size) => {
                setMockFileName(name);
                setMockFileSize(size);
              }}
              onFileRemoved={() => {
                setMockFileName(null);
                setMockFileSize(null);
              }}
            />
          </CardContent>
        </Card>

        {/* Табличная часть товаров */}
        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center">
                <Package className="h-5 w-5 mr-2 text-purple-400" />
                Товары и Услуги
              </CardTitle>
              <CardDescription>Табличная часть документа (позиции)</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddItem}
              className="border-slate-800 text-slate-300 hover:text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              Добавить позицию
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-3 items-center p-3 rounded-lg bg-slate-950/60 border border-slate-800"
              >
                {/* Выбор товара из справочника */}
                <div className="col-span-12 md:col-span-5 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">Товар из справочника</span>
                  <select
                    value={item.nomenclature_id || ''}
                    onChange={(e) => handleItemChange(index, 'nomenclature_id', e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="">-- Ввести наименование вручную --</option>
                    {nomenclatures.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title} ({n.unit || 'шт'}) - {n.price} сом
                      </option>
                    ))}
                  </select>
                  <Input
                    value={item.title}
                    onChange={(e) => handleItemChange(index, 'title', e.target.value)}
                    placeholder="Наименование товара/услуги"
                    required
                    className="h-9 text-xs bg-slate-900 border-slate-800 text-slate-100"
                  />
                </div>

                {/* Количество */}
                <div className="col-span-4 md:col-span-2 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">Кол-во</span>
                  <Input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                    required
                    className="h-9 text-xs bg-slate-900 border-slate-800 text-slate-100 font-mono"
                  />
                </div>

                {/* Цена */}
                <div className="col-span-4 md:col-span-2 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">Цена (сом)</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={(e) => handleItemChange(index, 'price', e.target.value)}
                    required
                    className="h-9 text-xs bg-slate-900 border-slate-800 text-slate-100 font-mono"
                  />
                </div>

                {/* Сумма */}
                <div className="col-span-3 md:col-span-2 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">Сумма (сом)</span>
                  <div className="h-9 px-2 flex items-center font-mono font-bold text-emerald-400 text-xs bg-slate-900 rounded border border-slate-800">
                    {item.total.toFixed(2)}
                  </div>
                </div>

                {/* Удаление */}
                <div className="col-span-1 flex justify-end pt-4">
                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveItem(index)}
                      className="h-8 w-8 p-0 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Итог по документу */}
            <div className="flex justify-end pt-4 border-t border-slate-800">
              <div className="text-right">
                <span className="text-xs text-slate-400 uppercase font-mono">ИТОГО ПО ДОКУМЕНТУ:</span>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {grandTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2 pb-6 flex justify-end">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                'Сохранить документ (Черновик)'
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
