'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  FileText,
  Plus,
  Search,
  Calendar,
  Building2,
  Loader2,
  Eye,
  Paperclip,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { exportTo1CExcel } from '@/lib/export/1c-exporter';
import { DOCUMENT_TYPES, DOCUMENT_STATUSES } from '@/types/document.types';
import type { Document, Counterparty, DocumentItem, DocumentType, DocumentStatus } from '@/types/database.types';

type DocumentWithRelations = Document & {
  counterparties?: Counterparty | null;
  document_items?: DocumentItem[];
  users?: { full_name: string } | null;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentWithRelations[]>([]);
  const [companyName, setCompanyName] = useState('Компания');
  const [loading, setLoading] = useState(true);

  // Фильтры
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const supabase = createClient();

  const loadDocuments = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('companies(name)')
        .eq('id', user.id)
        .single();

      if (profile?.companies) {
        const comp = Array.isArray(profile.companies) ? profile.companies[0] : profile.companies;
        if (comp?.name) {
          setCompanyName(comp.name);
        }
      }
    }

    const { data } = await supabase
      .from('documents')
      .select('*, counterparties(*), document_items(*), users(full_name)')
      .order('created_at', { ascending: false });

    if (data) {
      setDocuments(data as DocumentWithRelations[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      (doc.doc_number && doc.doc_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (doc.counterparties?.name && doc.counterparties.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (doc.comment && doc.comment.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = selectedType === 'all' || doc.doc_type === selectedType;
    const matchesStatus = selectedStatus === 'all' || doc.status === selectedStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const handleQuickExport = () => {
    if (filteredDocuments.length === 0) return;
    exportTo1CExcel(filteredDocuments, companyName);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Реестр Первичных Документов</h2>
          <p className="text-sm text-slate-400 mt-1">
            Всего документов компании: <span className="text-white font-medium">{documents.length}</span>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            onClick={handleQuickExport}
            disabled={filteredDocuments.length === 0}
            variant="outline"
            className="border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/30"
          >
            <Download className="h-4 w-4 mr-1.5 text-emerald-400" />
            Выгрузить в 1С (Excel)
          </Button>

          <Link href="/dashboard/documents/new">
            <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20">
              <Plus className="h-4 w-4 mr-1.5" />
              Создать Документ
            </Button>
          </Link>
        </div>
      </div>

      {/* Панель фильтров */}
      <Card className="bg-slate-900/40 border-slate-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Поиск по номеру, контрагенту..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-sm"
            />
          </div>

          <div>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все типы документов</option>
              <option value="realization">Реализация (Продажа)</option>
              <option value="purchase">Закуп (Поступление)</option>
              <option value="payment">Оплата (Чек / Перевод)</option>
              <option value="advance">Авансовый отчет</option>
            </select>
          </div>

          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Все статусы</option>
              <option value="draft">Черновик</option>
              <option value="review">На проверке</option>
              <option value="approved">Одобрен</option>
              <option value="rejected">Отклонен</option>
              <option value="posted_1c">Проведен в 1С</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Реестр Документов */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка реестра документов...</span>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              {searchTerm || selectedType !== 'all' || selectedStatus !== 'all'
                ? 'Документы по выбранным фильтрам не найдены'
                : 'Документы пока не созданы. Нажмите "Создать Документ"'}
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Дата / Номер</TableHead>
                  <TableHead>Тип Документа</TableHead>
                  <TableHead>Контрагент</TableHead>
                  <TableHead>Сумма (сом)</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Скан</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((doc) => {
                  const typeMeta = DOCUMENT_TYPES[doc.doc_type as DocumentType];
                  const statusMeta = DOCUMENT_STATUSES[doc.status as DocumentStatus];

                  return (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <div className="font-mono text-white font-medium">
                          № {doc.doc_number || '—'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center mt-0.5">
                          <Calendar className="h-3 w-3 mr-1" />
                          {doc.doc_date}
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className={`inline-block px-2.5 py-1 rounded-md text-xs border font-medium ${typeMeta?.color || ''}`}>
                          {typeMeta?.label || doc.doc_type}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-200 text-sm flex items-center space-x-1.5">
                          <Building2 className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                          <span className="truncate max-w-[180px]">
                            {doc.counterparties?.name || '—'}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="font-mono font-bold text-emerald-400 text-sm">
                        {Number(doc.total_amount).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} сом
                      </TableCell>

                      <TableCell>
                        <Badge variant={statusMeta?.variant || 'secondary'}>
                          {statusMeta?.label || doc.status}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {doc.mock_file_name ? (
                          <div className="flex items-center text-xs text-blue-400 font-mono truncate max-w-[120px]">
                            <Paperclip className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                            <span className="truncate">{doc.mock_file_name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <Link href={`/dashboard/documents/${doc.id}`}>
                          <Button size="sm" variant="outline" className="border-slate-800 text-xs text-slate-300 hover:text-white">
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Открыть
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
