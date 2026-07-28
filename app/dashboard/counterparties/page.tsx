'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
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
  Users,
  Search,
  Building2,
  Mail,
  Phone,
  BarChart3,
  FileText,
  Loader2,
  X,
  Send,
  Inbox,
  FolderOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Company, Document, DocumentFile } from '@/types/database.types';

type PartnerReport = {
  company: Company;
  inboxDocsCount: number;
  outboxDocsCount: number;
  totalFilesCount: number;
  documents: Document[];
};

export default function CounterpartiesPage() {
  const [partners, setPartners] = useState<Company[]>([]);
  const [currentCompanyId, setCurrentCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Отчет по контрагенту (Модалка)
  const [selectedPartnerReport, setSelectedPartnerReport] = useState<PartnerReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function loadPartners() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let myCompanyId = '';
      if (user) {
        const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
        if (prof?.company_id) {
          myCompanyId = prof.company_id;
          setCurrentCompanyId(prof.company_id);
        }
      }

      // Все зарегистрированные компании системы (кроме собственной)
      const { data: compData } = await supabase
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (compData) {
        setPartners((compData as Company[]).filter((c) => c.id !== myCompanyId));
      }

      setLoading(false);
    }

    loadPartners();
  }, []);

  const filteredPartners = partners.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.inn.includes(searchTerm) ||
      (p.phone && p.phone.includes(searchTerm))
  );

  // Формирование отчета по контрагенту
  const handleOpenReport = async (partner: Company) => {
    setReportLoading(true);

    const { data: docs } = await supabase
      .from('documents')
      .select('*, document_files(*)')
      .or(`and(sender_company_id.eq.${currentCompanyId},receiver_company_id.eq.${partner.id}),and(sender_company_id.eq.${partner.id},receiver_company_id.eq.${currentCompanyId})`)
      .order('created_at', { ascending: false });

    const docList = (docs as (Document & { document_files?: DocumentFile[] })[]) || [];

    const inboxCount = docList.filter((d) => d.sender_company_id === partner.id).length;
    const outboxCount = docList.filter((d) => d.receiver_company_id === partner.id).length;
    const filesCount = docList.reduce((sum, d) => sum + (d.document_files?.length || 1), 0);

    setSelectedPartnerReport({
      company: partner,
      inboxDocsCount: inboxCount,
      outboxDocsCount: outboxCount,
      totalFilesCount: filesCount,
      documents: docList,
    });

    setReportLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
            <Users className="h-6 w-6 mr-2 text-purple-400" />
            Справочник Контрагентов & B2B Партнеров
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Зарегистрированные организации системы для обмена документами
          </p>
        </div>
      </div>

      {/* Поиск */}
      <Card className="bg-slate-900/40 border-slate-800 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Поиск организации по названию, ИНН 14 цифр, телефону..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-950/60 border-slate-800 text-slate-100 text-sm"
          />
        </div>
      </Card>

      {/* Таблица Контрагентов */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка списка партнеров...</span>
            </div>
          ) : filteredPartners.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Партнеры по вашему запросу не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Организация</TableHead>
                  <TableHead>ИНН КР (14 цифр)</TableHead>
                  <TableHead>Контакты</TableHead>
                  <TableHead>Адрес</TableHead>
                  <TableHead className="text-right">Аналитический Отчет</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPartners.map((partner) => (
                  <TableRow key={partner.id}>
                    <TableCell>
                      <div className="font-semibold text-white text-sm flex items-center space-x-1.5">
                        <Building2 className="h-4 w-4 text-purple-400 flex-shrink-0" />
                        <span>{partner.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-sm text-slate-300 font-bold">
                      {partner.inn}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs space-y-0.5">
                        {partner.phone && (
                          <div className="text-slate-300 flex items-center font-mono">
                            <Phone className="h-3 w-3 mr-1 text-slate-500" />
                            {partner.phone}
                          </div>
                        )}
                        <div className="text-slate-400 flex items-center font-mono">
                          <Mail className="h-3 w-3 mr-1 text-slate-500" />
                          contact@{partner.inn}.kg
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-slate-400">
                      {partner.address || 'Бишкек, Кыргызстан'}
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReport(partner)}
                        className="border-slate-800 text-xs text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/30"
                      >
                        <BarChart3 className="h-3.5 w-3.5 mr-1" />
                        Отчет по контрагенту
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Модалка Аналитического отчета по контрагенту */}
      {selectedPartnerReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl bg-slate-900 border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <CardHeader className="border-b border-slate-800 flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-white flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-purple-400" />
                  Аналитика: {selectedPartnerReport.company.name}
                </CardTitle>
                <CardDescription>
                  ИНН: <span className="font-mono text-slate-300">{selectedPartnerReport.company.inn}</span>
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPartnerReport(null)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>

            <CardContent className="p-6 space-y-6 overflow-y-auto">
              {/* Статистические плашки */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <Inbox className="mx-auto h-5 w-5 text-emerald-400 mb-1" />
                  <span className="text-2xl font-bold font-mono text-white">
                    {selectedPartnerReport.inboxDocsCount}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">Получено от него</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <Send className="mx-auto h-5 w-5 text-blue-400 mb-1" />
                  <span className="text-2xl font-bold font-mono text-white">
                    {selectedPartnerReport.outboxDocsCount}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">Отправлено ему</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <FolderOpen className="mx-auto h-5 w-5 text-purple-400 mb-1" />
                  <span className="text-2xl font-bold font-mono text-white">
                    {selectedPartnerReport.totalFilesCount}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">Всего B2B файлов</p>
                </div>
              </div>

              {/* История документов с контрагентом */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                  История B2B документов
                </h4>
                {selectedPartnerReport.documents.length === 0 ? (
                  <div className="text-center p-6 text-slate-500 text-xs bg-slate-950/40 rounded-lg">
                    История обмена документами с данной организацией пока отсутствует
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {selectedPartnerReport.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-white font-mono">
                            № {doc.doc_number || '—'} ({doc.doc_type})
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {doc.sender_company_id === currentCompanyId ? 'Исходящий' : 'Входящий'} • Дата: {doc.doc_date}
                          </p>
                        </div>
                        <Badge variant="outline" className="border-slate-800 text-slate-300">
                          {doc.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
