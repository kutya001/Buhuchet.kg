'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, Download, Calendar, Filter, CheckCircle2, Loader2, Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { exportTo1CExcel } from '@/lib/export/1c-exporter';
import type { Document, Counterparty } from '@/types/database.types';

type FullDocForExport = Document & {
  counterparties?: Counterparty | null;
};

export default function Export1CPage() {
  const [documents, setDocuments] = useState<FullDocForExport[]>([]);
  const [companyName, setCompanyName] = useState('Компания');
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('approved_or_posted');
  const [docTypeFilter, setDocTypeFilter] = useState('all');

  const supabase = createClient();

  useEffect(() => {
    async function loadExportData() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('company_id, companies(name)')
          .eq('id', user.id)
          .single();

        if (profile?.companies) {
          const comp = Array.isArray(profile.companies) ? profile.companies[0] : profile.companies;
          if (comp?.name) {
            setCompanyName(comp.name);
          }
        }

        const { data: docs } = await supabase
          .from('documents')
          .select('*, counterparties(*)')
          .order('doc_date', { ascending: false });

        if (docs) {
          setDocuments(docs as FullDocForExport[]);
        }
      }
      setLoading(false);
    }
    loadExportData();
  }, []);

  const filteredDocs = documents.filter((doc) => {
    if (dateFrom && doc.doc_date < dateFrom) return false;
    if (dateTo && doc.doc_date > dateTo) return false;
    if (docTypeFilter !== 'all' && doc.doc_type !== docTypeFilter) return false;

    if (statusFilter === 'approved_or_posted') {
      return (doc.status as string) === 'approved' || (doc.status as string) === 'posted_1c';
    }
    if (statusFilter !== 'all') {
      return doc.status === statusFilter;
    }
    return true;
  });

  // Расчет сумм и количества строк
  const totalItemsCount = filteredDocs.length;
  const totalSum = filteredDocs.reduce((sum, doc) => sum + Number(doc.total_amount), 0);

  const handleExportClick = () => {
    if (filteredDocs.length === 0) return;
    exportTo1CExcel(filteredDocs, companyName);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Выгрузка данных в 1С (Excel)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Формирование форматированного таблицы `.xlsx` для интеграции с «1С: Бухгалтерия» на стороне клиента
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Форма фильтров экспорта */}
        <Card className="md:col-span-2 bg-slate-900/40 border-slate-800">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Filter className="h-5 w-5 mr-2 text-blue-400" />
              Параметры выгрузки
            </CardTitle>
            <CardDescription>Выберите период, статусы и типы первичных документов</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateFrom">Дата С</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dateTo">Дата ПО</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="statusFilter">Фильтр по статусу документа</Label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="approved_or_posted">Только Одобренные и Проведенные в 1С (Рекомендуется)</option>
                <option value="approved">Только Одобренные бухгалтером</option>
                <option value="posted_1c">Только Проведенные в 1С</option>
                <option value="all">Все документы (включая черновики)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="docTypeFilter">Тип документа</Label>
              <select
                id="docTypeFilter"
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Все типы документов</option>
                <option value="realization">Реализация (Продажа)</option>
                <option value="purchase">Закуп (Поступление)</option>
                <option value="payment">Оплата (Чек / Перевод)</option>
                <option value="advance">Авансовый отчет</option>
              </select>
            </div>
          </CardContent>

          <CardFooter className="pt-2 pb-6 flex justify-end border-t border-slate-800/60">
            <Button
              onClick={handleExportClick}
              disabled={loading || filteredDocs.length === 0}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-600/20"
            >
              <Download className="mr-2 h-4 w-4" />
              Скачать выгрузку (.xlsx)
            </Button>
          </CardFooter>
        </Card>

        {/* Сводная карточка результатов */}
        <Card className="bg-slate-900/40 border-slate-800 space-y-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <FileSpreadsheet className="h-5 w-5 mr-2 text-emerald-400" />
              Сводная информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {loading ? (
              <div className="flex items-center text-slate-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Расчет данных...
              </div>
            ) : (
              <>
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">
                    Организация
                  </span>
                  <div className="font-semibold text-white truncate">{companyName}</div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">
                    Найдено документов
                  </span>
                  <div className="text-2xl font-bold font-mono text-white">{filteredDocs.length} шт.</div>
                  <p className="text-[11px] text-slate-500">Строк в таблице 1С: {totalItemsCount}</p>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                  <span className="text-xs text-slate-500 uppercase tracking-wider font-mono">
                    Общая сумма выгрузки
                  </span>
                  <div className="text-xl font-bold font-mono text-emerald-400">
                    {totalSum.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                  <CheckCircle2 className="h-4 w-4 inline mr-1.5" />
                  Генерация выполняется браузером без ожидания ответа сервера.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
