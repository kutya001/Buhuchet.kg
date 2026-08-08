'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Mail,
  Phone,
  MapPin,
  User,
  UserCheck,
  UserPlus,
  Search,
  CheckCircle2,
  Briefcase,
} from 'lucide-react';
import {
  createCompanyOnboardingAction,
  searchActiveCompaniesAction,
  createEmployeeJoinRequestAction,
} from './actions';
import { INDUSTRIES, type Company } from '@/types/database.types';

export default function OnboardingPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Шаг онбординга: 1 = выбор типа учетной записи, 2 = форма владельца или сотрудника
  const [onboardingType, setOnboardingType] = useState<'owner' | 'employee' | null>(null);

  // Поля формы Владельца
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [industry, setIndustry] = useState('Услуги / Консалтинг');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [directorName, setDirectorName] = useState('');

  // Поля формы Сотрудника
  const [empFullName, setEmpFullName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empPosition, setEmpPosition] = useState('Менеджер');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Partial<Company>>>([]);
  const [selectedCompany, setSelectedCompany] = useState<Partial<Company> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [submittedEmployee, setSubmittedEmployee] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Поиск компаний в реальном времени при вводе сотрудником
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await searchActiveCompaniesAction(searchQuery);
      if (res.success && res.data) {
        setSearchResults(res.data);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Обработка формы Владельца
  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (inn.length !== 14 || !/^\d+$/.test(inn)) {
      setErrorMsg('ИНН Кыргызстана должен состоять строго из 14 цифр');
      return;
    }

    startTransition(async () => {
      const res = await createCompanyOnboardingAction({
        name,
        inn,
        industry,
        email,
        phone,
        legal_address: legalAddress,
        director_name: directorName,
      });

      if (res.success) {
        router.push('/dashboard');
      } else {
        setErrorMsg(res.error || 'Ошибка создания организации');
      }
    });
  };

  // Обработка формы Сотрудника
  const handleEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedCompany?.id) {
      setErrorMsg('Пожалуйста, выберите целевую компанию из списка поиска по ИНН или названию');
      return;
    }

    if (!empFullName || empFullName.trim().length < 2) {
      setErrorMsg('Укажите ваше полное ФИО');
      return;
    }

    startTransition(async () => {
      const res = await createEmployeeJoinRequestAction({
        companyId: selectedCompany.id!,
        position: empPosition,
        fullName: empFullName,
        phone: empPhone,
      });

      if (res.success) {
        setSubmittedEmployee(true);
      } else {
        setErrorMsg(res.error || 'Ошибка отправки заявки сотрудника');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-2xl bg-slate-900/60 border-slate-800 backdrop-blur-xl shadow-2xl relative z-10">
        {/* ШАГ 1: ВЫБОР РОЛИ (ВЛАДЕЛЕЦ vs СОТРУДНИК) */}
        {!onboardingType && (
          <div className="p-6 md:p-8 space-y-6">
            <div className="text-center space-y-2 pb-4 border-b border-slate-800/60">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 mx-auto border border-blue-500/30">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl font-bold text-white tracking-tight">
                Добро пожаловать в Buhuchet.kg!
              </CardTitle>
              <CardDescription className="text-slate-400 text-sm">
                Выберите категорию вашего учетного профиля в платформе
              </CardDescription>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Опция 1: Владелец */}
              <button
                type="button"
                onClick={() => setOnboardingType('owner')}
                className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900/90 text-left transition-all group flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-blue-600/20 text-blue-400 w-fit border border-blue-500/30 group-hover:scale-105 transition-transform">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                    Я Владелец / Руководитель
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Регистрация новой компании (ОсОО, ИП, ЗАО), управление первичными документами и приглашение сотрудников.
                  </p>
                </div>

                <div className="flex items-center text-xs font-bold text-blue-400 pt-2">
                  <span>Зарегистрировать компанию</span>
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* Опция 2: Сотрудник */}
              <button
                type="button"
                onClick={() => setOnboardingType('employee')}
                className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-900/90 text-left transition-all group flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-purple-600/20 text-purple-400 w-fit border border-purple-500/30 group-hover:scale-105 transition-transform">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-purple-400 transition-colors">
                    Я Сотрудник компании
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Подача заявки на привязку к существующей компании в КР по ИНН для работы с первичными документами.
                  </p>
                </div>

                <div className="flex items-center text-xs font-bold text-purple-400 pt-2">
                  <span>Подать заявку в штат</span>
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ШАГ 2.1: ФОРМА СОТРУДНИКА (ПОДАЧА ЗАЯВКИ В ШТАТ) */}
        {onboardingType === 'employee' && (
          <div>
            <CardHeader className="text-center space-y-2 pb-6 border-b border-slate-800/60 relative">
              <button
                type="button"
                onClick={() => setOnboardingType(null)}
                className="absolute left-6 top-6 text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                ← Назад к выбору
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 mx-auto border border-purple-500/30">
                <UserPlus className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl font-bold text-white tracking-tight">
                Присоединение к Организации
              </CardTitle>
              <CardDescription className="text-slate-400 text-sm">
                Найдите вашу компанию в реестре и подайте заявку Владельцу
              </CardDescription>
            </CardHeader>

            {submittedEmployee ? (
              <CardContent className="p-8 text-center space-y-4">
                <div className="p-4 rounded-full bg-emerald-500/20 text-emerald-400 w-fit mx-auto border border-emerald-500/30">
                  <CheckCircle2 className="w-12 h-12" />
                </div>
                <h3 className="text-xl font-bold text-white">Заявка успешно отправлена!</h3>
                <p className="text-sm text-slate-300 max-w-md mx-auto">
                  Вы подали заявку на вступление в организацию{' '}
                  <strong className="text-purple-400 font-bold">{selectedCompany?.name}</strong> (ИНН: {selectedCompany?.inn}).
                </p>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-xs max-w-md mx-auto leading-relaxed">
                  Ожидайте утверждения вашей заявки Руководителем компании в модуле «Сотрудники». После подтверждения вы сможете войти в панель.
                </div>
                <div className="pt-4">
                  <Button onClick={() => router.push('/dashboard')} className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-6">
                    Перейти к панели ожидания
                  </Button>
                </div>
              </CardContent>
            ) : (
              <form onSubmit={handleEmployeeSubmit}>
                <CardContent className="space-y-4 pt-6">
                  {errorMsg && (
                    <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{errorMsg}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="empFullName">Ваше Полное ФИО *</Label>
                    <Input
                      id="empFullName"
                      value={empFullName}
                      onChange={(e) => setEmpFullName(e.target.value)}
                      placeholder="Асанов Асан Асанович"
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100 font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="empPhone">Контактный Телефон *</Label>
                      <Input
                        id="empPhone"
                        value={empPhone}
                        onChange={(e) => setEmpPhone(e.target.value)}
                        placeholder="+996 (555) 00-00-00"
                        required
                        className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="empPosition">Желаемая Должность *</Label>
                      <Input
                        id="empPosition"
                        value={empPosition}
                        onChange={(e) => setEmpPosition(e.target.value)}
                        placeholder="Бухгалтер / Менеджер"
                        required
                        className="bg-slate-950 border-slate-800 text-slate-100"
                      />
                    </div>
                  </div>

                  {/* Блок поиска компании */}
                  <div className="space-y-2 pt-2 border-t border-slate-800/60">
                    <Label htmlFor="searchCompany" className="text-purple-400 font-bold flex items-center gap-1.5">
                      <Search className="w-4 h-4" />
                      <span>Поиск Организации по ИНН или Названию *</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="searchCompany"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          if (selectedCompany) setSelectedCompany(null);
                        }}
                        placeholder="Введите 14 цифр ИНН или наименование компании..."
                        className="bg-slate-950 border-slate-800 text-slate-100 pr-8 font-mono"
                      />
                      {isSearching && <Loader2 className="w-4 h-4 animate-spin text-purple-400 absolute right-3 top-3" />}
                    </div>

                    {/* Выбранная компания */}
                    {selectedCompany && (
                      <div className="p-3 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-300 text-xs flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm text-white">{selectedCompany.name}</p>
                          <p className="font-mono text-[11px]">ИНН: {selectedCompany.inn} | Директор: {selectedCompany.director_name || '—'}</p>
                        </div>
                        <Badge className="bg-purple-500 text-slate-950 font-bold">Выбрано</Badge>
                      </div>
                    )}

                    {/* Результаты поиска */}
                    {!selectedCompany && searchResults.length > 0 && (
                      <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-900">
                        {searchResults.map((comp) => (
                          <div
                            key={comp.id}
                            onClick={() => setSelectedCompany(comp)}
                            className="p-3 hover:bg-slate-900 cursor-pointer transition-colors text-xs space-y-1 flex items-center justify-between"
                          >
                            <div>
                              <p className="font-bold text-slate-100">{comp.name}</p>
                              <p className="font-mono text-[11px] text-slate-400">ИНН: {comp.inn}</p>
                            </div>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-purple-400">
                              Выбрать
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>

                <CardFooter className="pt-4 pb-6 border-t border-slate-800/60 flex justify-end">
                  <Button
                    type="submit"
                    disabled={isPending || !selectedCompany}
                    className="w-full md:w-auto bg-purple-600 hover:bg-purple-500 text-white font-medium shadow-lg shadow-purple-600/20 px-8"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Отправка заявки...
                      </>
                    ) : (
                      <>
                        Отправить заявку Владельцу
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </form>
            )}
          </div>
        )}

        {/* ШАГ 2.2: ФОРМА ВЛАДЕЛЬЦА (СОЗДАНИЕ ОРГАНИЗАЦИИ) */}
        {onboardingType === 'owner' && (
          <div>
            <CardHeader className="text-center space-y-2 pb-6 border-b border-slate-800/60 relative">
              <button
                type="button"
                onClick={() => setOnboardingType(null)}
                className="absolute left-6 top-6 text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                ← Назад к выбору
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 mx-auto border border-blue-500/30">
                <Building2 className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl font-bold text-white tracking-tight">
                Регистрация Юридического Лица
              </CardTitle>
              <CardDescription className="text-slate-400 text-sm">
                Заполните реквизиты вашей организации для отправки заявки на модерацию
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleOwnerSubmit}>
              <CardContent className="space-y-4 pt-6">
                {errorMsg && (
                  <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{errorMsg}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="name">Официальное Наименование Организации *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ОсОО «Азия Трейд Логистик»"
                    required
                    className="bg-slate-950 border-slate-800 text-slate-100 font-semibold"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="inn">ИНН КР (14 цифр) *</Label>
                    <Input
                      id="inn"
                      value={inn}
                      onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 14))}
                      placeholder="20101202310050"
                      maxLength={14}
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="industry">Отрасль Организации *</Label>
                    <select
                      id="industry"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full h-10 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {INDUSTRIES.map((ind) => (
                        <option key={ind} value={ind}>
                          {ind}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Официальный E-mail *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="info@company.kg"
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Контактный Телефон *</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+996 (555) 12-34-56"
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="director">ФИО Руководителя *</Label>
                    <Input
                      id="director"
                      value={directorName}
                      onChange={(e) => setDirectorName(e.target.value)}
                      placeholder="Асанов Асан Асанович"
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Юридический Адрес *</Label>
                    <Input
                      id="address"
                      value={legalAddress}
                      onChange={(e) => setLegalAddress(e.target.value)}
                      placeholder="г. Бишкек, ул. Киевская 110"
                      required
                      className="bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="pt-4 pb-6 border-t border-slate-800/60 flex justify-end">
                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20 px-8"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Отправка на модерацию...
                    </>
                  ) : (
                    <>
                      Отправить заявку на модерацию
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
