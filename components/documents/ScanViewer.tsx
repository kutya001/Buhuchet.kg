'use client';

import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, FileText, CheckCircle2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ScanViewerProps {
  fileName?: string | null;
  docNumber?: string | null;
  docDate?: string | null;
  counterpartyName?: string | null;
  totalAmount?: number | null;
}

export function ScanViewer({
  fileName,
  docNumber,
  docDate,
  counterpartyName,
  totalAmount,
}: ScanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 2.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-xl">
      {/* Top Toolbar */}
      <div className="h-12 px-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-mono text-slate-300 truncate">
          <FileText className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <span className="truncate">{fileName || 'Скан_накладной.pdf'}</span>
        </div>

        <div className="flex items-center space-x-1">
          <Button variant="ghost" size="sm" onClick={handleZoomOut} className="h-8 w-8 p-0 text-slate-400 hover:text-white">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono text-slate-400 px-1">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={handleZoomIn} className="h-8 w-8 p-0 text-slate-400 hover:text-white">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRotate} className="h-8 w-8 p-0 text-slate-400 hover:text-white">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 w-8 p-0 text-slate-400 hover:text-white">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Interactive Scan Canvas Area */}
      <div className="flex-1 p-6 overflow-auto flex items-center justify-center bg-slate-950/40 relative min-h-[400px]">
        <div
          className="transition-transform duration-200 shadow-2xl bg-white text-slate-900 p-8 rounded-md w-[450px] min-h-[550px] border border-slate-300 font-sans text-xs select-none"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
          }}
        >
          {/* Header Mock Stamp */}
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-4">
            <div>
              <h4 className="font-bold text-sm uppercase tracking-wide">Товарная Накладная</h4>
              <p className="text-[11px] text-slate-600">№ {docNumber || '102-А'} от {docDate || new Date().toLocaleDateString('ru-RU')}</p>
            </div>
            <div className="border-2 border-emerald-600 text-emerald-700 text-[10px] font-bold uppercase p-1 rounded rotate-[-6deg] text-center">
              <div>Оплачено</div>
              <div>ГНС КР</div>
            </div>
          </div>

          {/* Requisites Mock Block */}
          <div className="space-y-2 mb-6">
            <div className="p-2 bg-slate-100 rounded border border-slate-200">
              <span className="font-bold text-slate-700">Поставщик/Покупатель:</span>
              <p className="text-slate-900 font-semibold">{counterpartyName || 'ОсОО «Азия Трейд»'}</p>
              <p className="text-[10px] text-slate-600 font-mono">ИНН: 20101202310050</p>
            </div>
          </div>

          {/* Table Mock Rows */}
          <table className="w-full border-collapse mb-6 text-[11px]">
            <thead>
              <tr className="border-b border-slate-400 text-slate-700 bg-slate-100">
                <th className="text-left p-1">№</th>
                <th className="text-left p-1">Наименование</th>
                <th className="text-right p-1">Кол-во</th>
                <th className="text-right p-1">Сумма (сом)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="p-1">1</td>
                <td className="p-1">Вода Легенда 1.5л ПЭТ</td>
                <td className="text-right p-1">100 шт</td>
                <td className="text-right p-1">3 500.00</td>
              </tr>
              <tr className="border-b border-slate-200">
                <td className="p-1">2</td>
                <td className="p-1">Сок Натура 1.0л</td>
                <td className="text-right p-1">50 шт</td>
                <td className="text-right p-1">4 250.00</td>
              </tr>
            </tbody>
          </table>

          {/* Total Footer */}
          <div className="flex justify-between items-center border-t-2 border-slate-900 pt-3">
            <span className="font-bold text-slate-800">ВСЕГО К ОПЛАТЕ:</span>
            <span className="font-bold text-sm text-slate-900">
              {totalAmount ? Number(totalAmount).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) : '7 750.00'} сом
            </span>
          </div>

          <div className="mt-8 flex justify-between text-[9px] text-slate-500 pt-4 border-t border-slate-200">
            <div>Отпустил: ______________</div>
            <div>Принял: ______________</div>
          </div>
        </div>
      </div>
    </div>
  );
}
