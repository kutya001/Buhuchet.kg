'use client';

import React, { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, FileText, Download, Loader2, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPresignedDownloadUrlAction } from '@/app/dashboard/files/actions';

interface ScanViewerProps {
  fileName?: string | null;
  fileKey?: string | null;
  docNumber?: string | null;
  docDate?: string | null;
  counterpartyName?: string | null;
  totalAmount?: number | null;
}

export function ScanViewer({
  fileName,
  fileKey,
  docNumber,
  docDate,
  counterpartyName,
  totalAmount,
}: ScanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const [realDownloadUrl, setRealDownloadUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  useEffect(() => {
    async function loadR2Url() {
      if (fileKey) {
        setLoadingUrl(true);
        const res = await getPresignedDownloadUrlAction(fileKey);
        if (res.success && res.data?.downloadUrl) {
          setRealDownloadUrl(res.data.downloadUrl);
        }
        setLoadingUrl(false);
      }
    }
    loadR2Url();
  }, [fileKey]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 2.5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden backdrop-blur-xl">
      {/* Top Toolbar */}
      <div className="h-12 px-4 bg-muted/80 border-b border-border flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-mono text-foreground truncate">
          <FileText className="h-4 w-4 text-blue-400 flex-shrink-0" />
          <span className="truncate">{fileName || 'Скан_документа.pdf'}</span>
          {fileKey && (
            <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Cloudflare R2
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1">
          {realDownloadUrl && (
            <a href={realDownloadUrl} target="_blank" rel="noopener noreferrer" download>
              <Button variant="ghost" size="sm" className="h-8 text-xs text-blue-400 hover:text-blue-500 hover:bg-muted">
                <Download className="h-3.5 w-3.5 mr-1" />
                Скачать из R2
              </Button>
            </a>
          )}

          <Button variant="ghost" size="sm" onClick={handleZoomOut} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground px-1">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={handleZoomIn} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRotate} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Interactive Scan Canvas Area */}
      <div className="flex-1 p-6 overflow-auto flex items-center justify-center bg-background/50 relative min-h-[400px]">
        {loadingUrl ? (
          <div className="flex items-center space-x-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            <span>Генерация безопасной ссылки R2...</span>
          </div>
        ) : realDownloadUrl ? (
          <div
            className="transition-transform duration-200 shadow-2xl rounded-md max-w-full overflow-hidden"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
            }}
          >
            {/* Картинка или вставка файла */}
            <img
              src={realDownloadUrl}
              alt={fileName || 'Скан R2'}
              className="max-h-[600px] object-contain rounded border border-slate-800"
              onError={(e) => {
                // Если скан — PDF, покажем превью плашку
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          /* Демо-макет при отсутствии реального файла */
          <div
            className="transition-transform duration-200 shadow-2xl bg-white text-slate-900 p-8 rounded-md w-[450px] min-h-[550px] border border-slate-300 font-sans text-xs select-none"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
            }}
          >
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

            <div className="space-y-2 mb-6">
              <div className="p-2 bg-slate-100 rounded border border-slate-200">
                <span className="font-bold text-slate-700">Поставщик/Покупатель:</span>
                <p className="text-slate-900 font-semibold">{counterpartyName || 'ОсОО «Азия Трейд»'}</p>
                <p className="text-[10px] text-slate-600 font-mono">ИНН: 20101202310050</p>
              </div>
            </div>

            <div className="mt-16 text-center text-slate-400 text-xs border-2 border-dashed border-slate-300 p-6 rounded">
              <ImageIcon className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              Прикрепите сканы файла через форму для предпросмотра из Cloudflare R2
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
