import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Users, Package, ArrowRight, Database } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function LookupsOverviewPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let counterpartiesCount = 0;
  let nomenclatureCount = 0;

  if (user) {
    const { count: cCount } = await supabase
      .from('counterparties')
      .select('*', { count: 'exact', head: true });

    const { count: nCount } = await supabase
      .from('nomenclature')
      .select('*', { count: 'exact', head: true });

    counterpartiesCount = cCount || 0;
    nomenclatureCount = nCount || 0;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Справочники Системы</h2>
        <p className="text-sm text-slate-400 mt-1">
          Управление базой контрагентов, товаров и услуг вашей компании для автозаполнения документов
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Карточка Контрагентов */}
        <Card className="bg-slate-900/40 border-slate-800 hover:border-blue-500/40 transition-all flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-400">
                <Users className="h-6 w-6" />
              </div>
              <span className="font-mono text-2xl font-bold text-white">{counterpartiesCount}</span>
            </div>
            <CardTitle className="text-xl pt-2">Справочник Контрагентов</CardTitle>
            <CardDescription>
              База клиентов, поставщиков и партнеров. Хранение ИНН (14 цифр), контактных телефонов и признаков учета НДС (12%).
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/dashboard/counterparties" className="w-full">
              <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                Перейти в Контрагенты
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardFooter>
        </Card>

        {/* Карточка Номенклатуры */}
        <Card className="bg-slate-900/40 border-slate-800 hover:border-purple-500/40 transition-all flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/10 border border-purple-500/30 text-purple-400">
                <Package className="h-6 w-6" />
              </div>
              <span className="font-mono text-2xl font-bold text-white">{nomenclatureCount}</span>
            </div>
            <CardTitle className="text-xl pt-2">Справочник Номенклатуры</CardTitle>
            <CardDescription>
              Каталог товаров и услуг. Привязка кодов из 1С, базовых цен продажи в сомах и единиц измерения (шт, кг, литр, услуга).
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/dashboard/nomenclature" className="w-full">
              <Button className="w-full bg-purple-600 hover:bg-purple-500 text-white">
                Перейти в Номенклатуру
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
