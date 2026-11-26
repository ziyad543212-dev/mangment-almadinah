import { useCallback, useEffect, useId, useRef, useState } from 'react';
import api from '../services/api';

export interface OcrFieldInfo {
  value: string | number | null;
  confidence: number | null;
  source: string | null;
  validated: boolean;
  alternatives: Array<{ source?: string; value?: string | number | null }>;
}

export interface OcrContract {
  status: 'ok' | 'needs_review' | 'failed' | string;
  fields: Record<string, OcrFieldInfo>;
  warnings: Array<{ code: string; field: string | null; message: string }>;
  conflicts: Array<{
    field: string;
    resolution: string;
    mrz?: { source: string; value: unknown };
    visual?: { source: string; value: unknown };
    alternatives?: Array<{ source?: string; value?: unknown }>;
  }>;
  requiresHumanReview: boolean;
}

export interface OcrScanPayload {
  data: Record<string, string | null>;
  reviewFields: string[];
  contract: OcrContract | null;
  providerWarning: string | null;
}

interface PassportOcrPanelProps {
  onExtracted: (payload: OcrScanPayload) => void;
  disabled?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  first_name_ar: 'الاسم الأول (عربي)',
  father_name_ar: 'اسم الأب (عربي)',
  last_name_ar: 'النسبة (عربي)',
  first_name_en: 'First Name',
  father_name_en: "Father's Name",
  last_name_en: 'Surname',
  full_name_en: 'Full Name (EN)',
  passport_number: 'رقم الجواز',
  date_of_birth: 'تاريخ الميلاد',
  passport_expiry_date: 'انتهاء الجواز',
  nationality: 'الجنسية',
  gender: 'الجنس',
  place_of_birth: 'محل الميلاد',
  place_of_issue: 'مكان الإصدار',
  issuing_authority: 'جهة الإصدار',
  document_type: 'نوع الوثيقة',
};

const SOURCE_LABELS: Record<string, string> = {
  mrz: 'MRZ',
  paddleocr: 'PaddleOCR',
  tesseract: 'Tesseract',
  gemini: 'Gemini (سحابي)',
  derived: 'مشتق',
  unavailable: 'غير متوفر',
};

function fieldStatus(field: OcrFieldInfo): 'ok' | 'review' | 'conflict' {
  if (field.alternatives.length > 0) return 'conflict';
  if (field.validated) return 'ok';
  if (field.value === null || field.value === '') return 'review';
  if (field.confidence !== null && field.confidence < 0.6) return 'review';
  return field.validated ? 'ok' : 'review';
}

export default function PassportOcrPanel({ onExtracted, disabled }: PassportOcrPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [mode, setMode] = useState<'local' | 'cloud'>('local');
  const [cloudAvailable, setCloudAvailable] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>('جارٍ التحقق من جاهزية الخدمة السحابية...');
  const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [contract, setContract] = useState<OcrContract | null>(null);
  const [warningDetails, setWarningDetails] = useState<string[]>([]);
  const [engineWarning, setEngineWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const modeInputName = useId();
  const scanInFlight = useRef(false);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    let active = true;
    api.get('/api/ocr/health').then((response) => {
      if (active) {
        setCloudAvailable(response.data.modes?.cloud?.status === 'configured');
        setCloudMessage(response.data.modes?.cloud?.message || null);
        setEngineWarning(response.data.engine_warning || null);
      }
    }).catch(() => {
      if (active) setCloudMessage('تعذر التحقق من جاهزية الخدمة السحابية. أعد فتح النافذة للمحاولة مجددًا.');
    });
    return () => { active = false; };
  }, []);

  const runScan = useCallback(async (file: File, page = 1) => {
    if (!file || disabled || scanInFlight.current) return;
    if (mode === 'cloud' && !cloudAvailable) {
      setMessage({ type: 'error', text: cloudMessage || 'الخدمة السحابية غير جاهزة. راجع إعدادات الخادم.' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'حجم الملف يتجاوز 15 ميغابايت.' });
      return;
    }

    scanInFlight.current = true;
    setScanning(true);
    setMessage(null);
    setContract(null);
    setWarningDetails([]);
    setSelectedFile(file);
    setPdfPage(page);
    setPreviewUrl(file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? null : URL.createObjectURL(file));

    const formData = new FormData();
    formData.append('image', file);
    formData.append('page', String(page));
    formData.append('mode', mode);

    try {
      const response = await api.post('/api/ocr/passport', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const ocrData = (response.data.data || {}) as Record<string, string | null>;
      const reviewFields: string[] = Array.isArray(response.data.review_fields)
        ? response.data.review_fields
        : [];
      const nextContract = (response.data.ocr_contract || null) as OcrContract | null;
      setContract(nextContract);

      const notices = [...new Set((nextContract?.warnings || []).map((warning) => warning.message))];
      setWarningDetails(notices);
      const needsReview = notices.length > 0 || reviewFields.length > 0 || nextContract?.requiresHumanReview;
      const hasMissingFields = (nextContract?.warnings || []).some((warning) => warning.code === 'missing_field');
      const failed = response.data.success === false || nextContract?.status === 'failed';
      setMessage({
        type: failed ? 'error' : response.data.warning || needsReview ? 'warning' : 'success',
        text: [response.data.warning, failed
          ? 'لم يتمكن النظام من قراءة الاسم أو رقم الجواز. جرّب صورة أوضح لصفحة البيانات كاملة.'
          : hasMissingFields ? 'تمت قراءة جزء من البيانات. راجع الحقول المظللة وأكمل الحقول الناقصة.'
            : needsReview ? 'تمت قراءة البيانات. راجع الحقول المظللة قبل الحفظ.'
            : 'تمت قراءة بيانات الجواز. راجع الحقول قبل الحفظ.'].filter(Boolean).join(' '),
      });
      if (failed) return;

      onExtracted({
        data: ocrData,
        reviewFields,
        contract: nextContract,
        providerWarning: response.data.warning || null,
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { warning?: string; error?: string; ocr_contract?: OcrContract } } };
      const warningMsg = err.response?.data?.warning || err.response?.data?.error ||
        'تعذرت قراءة الجواز، يرجى إدخال البيانات يدوياً.';
      const failedContract = err.response?.data?.ocr_contract || null;
      setContract(failedContract);
      setWarningDetails([...new Set((failedContract?.warnings || []).map((warning) => warning.message))]);
      setMessage({ type: 'error', text: warningMsg });
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }, [disabled, onExtracted, mode, cloudAvailable, cloudMessage]);

  const changeMode = (next: 'local' | 'cloud') => {
    setMode(next);
    setMessage(null);
    setContract(null);
    setWarningDetails([]);
  };
  const scanDisabled = scanning || disabled || mode === 'cloud' && !cloudAvailable;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void runScan(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void runScan(file);
  };

  const contractFields = contract
    ? Object.entries(contract.fields).filter(([, info]) => info.value !== null && info.value !== '')
    : [];

  return (
    <div
      className="ocr-panel"
      onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      style={{
        padding: '1rem',
        backgroundColor: dragActive ? '#eef3ff' : '#f0f4ff',
        border: `1px dashed ${dragActive ? '#4a6cf7' : '#9db4f0'}`,
        borderRadius: '8px',
        marginBottom: '1.5rem',
      }}
    >
      <label className="form-label" style={{ fontWeight: '700', marginBottom: '0.5rem', display: 'block' }}>
        📷 مسح جواز السفر تلقائياً (OCR)
      </label>

      <fieldset disabled={scanning || disabled} style={{ border: 0, padding: 0, margin: '0 0 0.75rem' }}>
        <legend style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>طريقة قراءة الجواز</legend>
        <div className="ocr-modes" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          <label style={{ cursor: scanning ? 'default' : 'pointer' }}>
            <input type="radio" name={modeInputName} value="local" checked={mode === 'local'} onChange={() => changeMode('local')} />{' '}
            محلي
          </label>
          <label style={{ cursor: scanning ? 'default' : 'pointer' }}>
            <input type="radio" name={modeInputName} value="cloud" checked={mode === 'cloud'} onChange={() => changeMode('cloud')} />{' '}
            سحابي (Gemini)
          </label>
        </div>
      </fieldset>
      <p style={{ fontSize: '0.8rem', color: '#555', margin: '0 0 0.6rem' }}>
        {mode === 'local'
          ? 'تُقرأ الصورة باستخدام المحرك المحلي، دون إرسالها إلى خدمة OCR سحابية.'
          : 'عند رفع الملف تُرسل صورة صفحة الجواز كاملة إلى Google لقراءة الأسماء والبيانات. يتطلب الإنترنت وقد تُحتسب رسوم استخدام.'}
      </p>
      {mode === 'cloud' && cloudMessage && (
        <p role="status" style={{ color: '#9a6b00', fontSize: '0.85rem' }}>{cloudMessage}</p>
      )}

      {mode === 'local' && engineWarning && !selectedFile && !scanning && (
        <p role="status" style={{ color: '#9a6b00', margin: '0 0 0.6rem' }}>{engineWarning}</p>
      )}

      <div className="ocr-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanDisabled}
        >
          رفع صورة أو PDF
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => cameraInputRef.current?.click()}
          disabled={scanDisabled}
        >
          التقاط صورة بالكاميرا
        </button>
        {selectedFile && !scanning && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void runScan(selectedFile, pdfPage)}
            disabled={scanDisabled}
          >
            إعادة قراءة الملف
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <p style={{ color: '#666', fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
        اسحب صورة الجواز أو ملف PDF وأفلته هنا. يصحّح القارئ اتجاه الصورة ويجرّب تحسين الإضاءة عند الحاجة.
      </p>

      {selectedFile && /\.pdf$/i.test(selectedFile.name) && (
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{selectedFile.name}</span>
          <label>صفحة الجواز: <input type="number" min={1} value={pdfPage} disabled={scanning}
            style={{ width: '4rem' }} onChange={(event) => setPdfPage(Math.max(1, Math.trunc(Number(event.target.value) || 1)))} /></label>
          <button type="button" className="btn btn-secondary btn-sm" disabled={scanDisabled}
            onClick={() => void runScan(selectedFile, pdfPage)}>قراءة الصفحة</button>
        </div>
      )}

      {previewUrl && (
        <div style={{ marginTop: '0.75rem' }}>
          <img
            src={previewUrl}
            alt="معاينة جواز السفر"
            style={{
              maxWidth: '220px',
              maxHeight: '140px',
              objectFit: 'contain',
              border: '1px solid #d0d7ff',
              borderRadius: '6px',
              background: '#fff',
            }}
          />
        </div>
      )}

      {scanning && (
        <p style={{ color: '#4a6cf7', marginTop: '0.5rem', fontWeight: '600' }} role="status">
          {mode === 'cloud' ? '☁ جارٍ قراءة الجواز عبر Gemini...' : '⏳ جارٍ قراءة الجواز محلياً ومقارنة النتائج... قد تستغرق الصور الصعبة أكثر من دقيقة.'}
        </p>
      )}

      {message && (
        <p
          role="alert"
          style={{
            marginTop: '0.5rem',
            fontWeight: '600',
            color: message.type === 'error' ? '#dc3545' : message.type === 'warning' ? '#9a6b00' : '#1e7e34',
          }}
        >
          {message.text}
        </p>
      )}

      {warningDetails.length > 0 && (
        <details style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <summary>تفاصيل القراءة والحقول التي تحتاج مراجعة</summary>
          <ul style={{ paddingInlineStart: '1.2rem' }}>
            {warningDetails.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}

      {contract && contract.conflicts.length > 0 && (
        <div
          style={{
            marginTop: '0.6rem',
            padding: '0.6rem 0.8rem',
            backgroundColor: '#fff3f3',
            border: '1px solid #f1c0c0',
            borderRadius: '6px',
            fontSize: '0.85rem',
          }}
        >
          <strong style={{ color: '#b02a37' }}>تعارضات تحتاج مراجعة:</strong>
          <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.2rem' }}>
            {contract.conflicts.map((conflict, index) => {
              const selected = contract.fields[conflict.field]?.value ??
                (conflict.resolution === 'mrz' ? conflict.mrz?.value : conflict.visual?.value);
              const alternatives = [...new Set((conflict.alternatives || [conflict.mrz, conflict.visual])
                .map((candidate) => candidate?.value)
                .filter((value) => value !== undefined && value !== null && value !== '' && String(value) !== String(selected))
                .map(String))];
              return (
                <li key={index}>
                  {FIELD_LABELS[conflict.field] || conflict.field}: المعتمد {String(selected ?? '')}
                  {alternatives.length > 0 && <> — البديل: {alternatives.join('، ')}</>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {contractFields.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ fontSize: '0.85rem', fontWeight: '700', color: '#444', margin: '0 0 0.4rem' }}>
            ثقة الاستخراج:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {contractFields.map(([key, info]) => {
              const status = fieldStatus(info);
              const color = status === 'ok' ? '#1e7e34' : status === 'conflict' ? '#b02a37' : '#9a6b00';
              const bg = status === 'ok' ? '#e8f5e9' : status === 'conflict' ? '#fdecea' : '#fff8e1';
              const pct = info.confidence !== null ? ` ${Math.round(info.confidence * 100)}%` : '';
              return (
                <span
                  key={key}
                  title={`${SOURCE_LABELS[info.source || ''] || info.source || ''}${info.alternatives.length ? ' — يوجد تعارض' : ''}`}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    backgroundColor: bg,
                    color,
                    border: `1px solid ${color}55`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {status === 'ok' ? '✓' : status === 'conflict' ? '⚠' : '!'} {FIELD_LABELS[key] || key}
                  {pct}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
