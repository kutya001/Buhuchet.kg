'use client';

import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, X, Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MockDropzoneProps {
  fileName?: string | null;
  fileSize?: string | null;
  onFileUploaded: (fileName: string, fileSize: string) => void;
  onFileRemoved: () => void;
  disabled?: boolean;
}

export function MockDropzone({
  fileName,
  fileSize,
  onFileUploaded,
  onFileRemoved,
  disabled = false,
}: MockDropzoneProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const simulateUpload = (file: File) => {
    setUploading(true);
    setProgress(0);

    const formattedSize =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.round(file.size / 1024)} KB`;

    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 20;
      setProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setUploading(false);
        onFileUploaded(file.name, formattedSize);
      }
    }, 200);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      simulateUpload(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !uploading) setIsHovered(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovered(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovered(false);
    if (!disabled && !uploading && e.dataTransfer.files && e.dataTransfer.files[0]) {
      simulateUpload(e.dataTransfer.files[0]);
    }
  };

  if (fileName) {
    return (
      <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm text-white truncate max-w-xs">{fileName}</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                Mock File
              </span>
            </div>
            <p className="text-xs text-slate-500">{fileSize || '1.8 MB'} • Статус: Прикреплен</p>
          </div>
        </div>

        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onFileRemoved}
            className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
      className={`relative p-6 rounded-xl border-2 border-dashed transition-all duration-200 text-center cursor-pointer ${
        isHovered
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleFileSelect}
        disabled={disabled || uploading}
        className="hidden"
      />

      {uploading ? (
        <div className="space-y-3 py-2">
          <Loader2 className="mx-auto h-8 w-8 text-blue-400 animate-spin" />
          <div className="text-sm font-medium text-slate-200">
            Имитация загрузки и обработки скана... {progress}%
          </div>
          <div className="w-full max-w-xs mx-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2 py-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 text-slate-400">
            <Upload className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">
              Перетащите фото накладной или нажмите для выбора
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Поддерживаются JPG, PNG, WebP и PDF сканы (до 10 МБ)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
