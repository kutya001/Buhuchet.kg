'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Building2,
  Search,
  Lock,
  Unlock,
  Sliders,
  Calendar,
  HardDrive,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toggleCompanyStatusAction, updateCompanySubscriptionAction } from './actions';
import type { Company, Subscription } from '@/types/database.types';

type CompanyWithSub = Company & {
  subscriptions?: Subscription | null;
  users_count?: number;
};

export default function SuperAdminPage() {
  const [companies, setCompanies] = useState<CompanyWithSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();

  const [selectedCompany, setSelectedCompany] = useState<CompanyWithSub | null>(null);
  const [daysToAdd, setDaysToAdd] = useState('30');
  const [planType, setPlanType] = useState<'basic' | 'standard' | 'pro'>('basic');
  const [storageLimitGb, setStorageLimitGb] = useState('10');

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();

  const loadData = async () => {
    setLoading(true);
    const { data: compData } = await supabase
      .from('companies')
      .select('*, subscriptions(*)');

    if (compData) {
      setCompanies(compData as CompanyWithSub[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleActive = (company: CompanyWithSub) => {
    const nextStatus = !company.is_active;
    setMsg(null);

    startTransition(async () => {
      const res = await toggleCompanyStatusAction(company.id, nextStatus);
      if (res.success) {
        setMsg({
          type: 'success',
          text: `Статус компании "${company.name}" изменен на ${nextStatus ? 'Активна' : 'Заблокирована'}`,
        });
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка изменения статуса' });
      }
    });
  };

  const handleOpenSubModal = (company: CompanyWithSub) => {
    setSelectedCompany(company);
    setPlanType(company.subscriptions?.plan_type || 'basic');
    setStorageLimitGb(company.storage_limit_gb?.toString() || '10');
    setDaysToAdd('30');
  };

  const handleSaveSub = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    setMsg(null);

    const formData = new FormData();
    formData.append('companyId', selectedCompany.id);
    formData.append('planType', planType);
    formData.append('daysToAdd', daysToAdd);
    formData.append('storageLimitGb', storageLimitGb);

    startTransition(async () => {
      const res = await updateCompanySubscriptionAction(formData);
      if (res.success) {
        setMsg({
          type: 'success',
          text: `Подписка компании "${selectedCompany.name}" успешно обновлена!`,
        });
        setSelectedCompany(null);
        loadData();
      } else {
        setMsg({ type: 'error', text: res.error || 'Ошибка при обновлении подписки' });
      }
    });
  };

  const filteredCompanies = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.inn.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Реестр Организаций</h2>
          <p className="text-sm text-slate-400 mt-1">
            Всего компаний в системе: <span className="text-white font-medium">{companies.length}</span>
          </p>
        </div>

        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Поиск по названию или ИНН..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-900/60 border-slate-800 text-slate-100"
          />
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
          {msg.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      {/* Таблица Организаций */}
      <Card className="bg-slate-900/40 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Загрузка списка организаций...</span>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Организации не найдены
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-950/60">
                <TableRow>
                  <TableHead>Организация / ИНН</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Тариф / Статус</TableHead>
                  <TableHead>Истекает</TableHead>
                  <TableHead>Память (ГБ)</TableHead>
                  <TableHead>Статус Доступа</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((comp) => {
                  const sub = comp.subscriptions;
                  const expiresDate = sub?.expires_at
                    ? new Date(sub.expires_at).toLocaleDateString('ru-RU')
                    : 'Не указана';

                  return (
                    <TableRow key={comp.id}>
                      <TableCell>
                        <div className="font-medium text-white flex items-center space-x-2">
                          <Building2 className="h-4 w-4 text-blue-400 flex-shrink-0" />
                          <span>{comp.name}</span>
                        </div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">
                          ИНН: {comp.inn}
                        </div>
                      </TableCell>

                      <TableCell className="text-slate-300 font-mono text-xs">
                        {comp.phone || '—'}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Badge variant="outline" className="uppercase text-[10px] font-mono border-slate-700">
                            {sub?.plan_type || 'basic'}
                          </Badge>
                          <Badge
                            variant={
                              sub?.status === 'active'
                                ? 'success'
                                : sub?.status === 'trial'
                                ? 'warning'
                                : 'destructive'
                            }
                          >
                            {sub?.status || 'trial'}
                          </Badge>
                        </div>
                      </TableCell>

                      <TableCell className="text-slate-300 text-xs font-mono">
                        <span className="flex items-center">
                          <Calendar className="h-3.5 w-3.5 mr-1 text-slate-500" />
                          {expiresDate}
                        </span>
                      </TableCell>

                      <TableCell className="text-slate-300 text-xs font-mono">
                        <span className="flex items-center">
                          <HardDrive className="h-3.5 w-3.5 mr-1 text-slate-500" />
                          {comp.storage_limit_gb || 10} ГБ
                        </span>
                      </TableCell>

                      <TableCell>
                        {comp.is_active ? (
                          <Badge variant="success" className="flex items-center w-fit">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Активна
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex items-center w-fit">
                            <XCircle className="h-3 w-3 mr-1" />
                            Заблокирована
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenSubModal(comp)}
                            className="border-slate-800 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
                          >
                            <Sliders className="h-3.5 w-3.5 mr-1 text-amber-400" />
                            Тариф
                          </Button>

                          <Button
                            size="sm"
                            variant={comp.is_active ? 'destructive' : 'default'}
                            onClick={() => handleToggleActive(comp)}
                            disabled={isPending}
                            className="text-xs"
                          >
                            {comp.is_active ? (
                              <>
                                <Lock className="h-3.5 w-3.5 mr-1" />
                                Блок
                              </>
                            ) : (
                              <>
                                <Unlock className="h-3.5 w-3.5 mr-1" />
                                Разблок
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Панель/Модалка редактирования подписки компании */}
      {selectedCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg bg-slate-900 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Sliders className="h-5 w-5 mr-2 text-amber-400" />
                Управление подпиской: {selectedCompany.name}
              </CardTitle>
              <CardDescription>
                Изменение тарифного плана, продление периода и управление объемом памяти
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSaveSub}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Тарифный план</label>
                  <select
                    value={planType}
                    onChange={(e) => setPlanType(e.target.value as any)}
                    className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="basic">Basic (Базовый - 3000 сом)</option>
                    <option value="standard">Standard (Стандарт - 7000 сом)</option>
                    <option value="pro">Pro (Профессиональный - 15000 сом)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Продлить подписку на (дней)</label>
                  <select
                    value={daysToAdd}
                    onChange={(e) => setDaysToAdd(e.target.value)}
                    className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="0">Не продлевать дату</option>
                    <option value="30">+ 30 дней (1 месяц)</option>
                    <option value="90">+ 90 дней (3 месяца)</option>
                    <option value="365">+ 365 дней (1 год)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Лимит диска R2 (ГБ)</label>
                  <Input
                    type="number"
                    value={storageLimitGb}
                    onChange={(e) => setStorageLimitGb(e.target.value)}
                    min="1"
                    max="1000"
                    className="bg-slate-950 border-slate-800 text-slate-100"
                  />
                </div>
              </CardContent>

              <div className="p-6 pt-0 flex justify-end space-x-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedCompany(null)}
                  className="border-slate-800 text-slate-400"
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-amber-600 hover:bg-amber-500 text-white"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Сохранение...
                    </>
                  ) : (
                    'Применить изменения'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
