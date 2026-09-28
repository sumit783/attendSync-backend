const fs = require('fs');
const path = require('path');

const modalContent = `import React, { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle,
  Loader2, Download, Trash2, ChevronDown, ChevronUp
} from 'lucide-react';
import Modal from '../ui/Modal';
import api from '../../services/api';

interface BulkAttendanceRow {
  employeeName: string;
  inDate: string;
  inTime: string;
  outDate: string;
  outTime: string;
  finalRemark?: string;
  _rowIndex?: number;
}

interface UploadResult {
  employeeName: string;
  status: 'success' | 'error';
  finalRemark?: string;
  totalHours?: number;
  message?: string;
}

interface BulkAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCompanyId: string | null | undefined;
  setBannerSuccess: (msg: string | null) => void;
}

// Parse Excel serial date to YYYY-MM-DD
function excelSerialToDate(serial: number | string): string {
  if (typeof serial === 'string') {
    // Try to parse date-like strings e.g. "1-Sep-26", "01/09/2026"
    const d = new Date(serial);
    if (!isNaN(d.getTime())) {
      return \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
    }
    // Handle "D-Mon-YY" like "1-Sep-26"
    const monMap: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const match = serial.match(/(\\d{1,2})[-/](\\w{3})[-/](\\d{2,4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const mon = monMap[match[2]] || '01';
      const yr = match[3].length === 2 ? \`20\${match[3]}\` : match[3];
      return \`\${yr}-\${mon}-\${day}\`;
    }
    return serial;
  }
  if (typeof serial === 'number') {
    // Excel serial date
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + serial * 86400000);
    return \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
  }
  return '';
}

// Parse Excel time (fraction of day or HH:MM string) to HH:MM
function excelTimeToHHMM(val: number | string | null | undefined): string {
  if (!val && val !== 0) return '';
  if (typeof val === 'number') {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return \`\${String(h).padStart(2, '0')}:\${String(m).padStart(2, '0')}\`;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s || s === 'A' || s.toLowerCase() === 'absent') return '';
    // Match H:MM or HH:MM
    const m = s.match(/^(\\d{1,2}):(\\d{2})/);
    if (m) return \`\${m[1].padStart(2, '0')}:\${m[2]}\`;
    return '';
  }
  return '';
}

function parseExcelSheet(data: ArrayBuffer): BulkAttendanceRow[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  if (!json || json.length < 2) return [];

  // Find header row (first row with "Employee Name" or "Employee")
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, json.length); i++) {
    const row = json[i].map((c: any) => String(c).toLowerCase().trim());
    if (row.some((c: string) => c.includes('employee'))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers: string[] = json[headerRowIdx].map((h: any) => String(h).toLowerCase().trim());

  // Column finder
  const col = (keywords: string[]) => {
    for (const kw of keywords) {
      const idx = headers.findIndex(h => h.includes(kw));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colName = col(['employee name', 'employee', 'name']);
  const colDate = col(['date']);
  const colLogin = col(['log in', 'login', 'in time', 'check in']);
  const colLogout = col(['log out', 'logout', 'out time', 'check out']);
  const colLoginDate = col(['login date', 'in date']);
  const colLogoutDate = col(['logout date', 'out date']);

  const rows: BulkAttendanceRow[] = [];

  for (let i = headerRowIdx + 1; i < json.length; i++) {
    const row = json[i];
    const name = String(row[colName] ?? '').trim();
    if (!name) continue;

    const dateRaw = colDate !== -1 ? row[colDate] : '';
    const dateStr = excelSerialToDate(dateRaw);
    if (!dateStr) continue;

    const loginDateRaw = colLoginDate !== -1 ? row[colLoginDate] : dateRaw;
    const logoutDateRaw = colLogoutDate !== -1 ? row[colLogoutDate] : dateRaw;

    const inTimeRaw = colLogin !== -1 ? row[colLogin] : '';
    const outTimeRaw = colLogout !== -1 ? row[colLogout] : '';

    rows.push({
      employeeName: name,
      inDate: excelSerialToDate(loginDateRaw) || dateStr,
      outDate: excelSerialToDate(logoutDateRaw) || dateStr,
      inTime: excelTimeToHHMM(inTimeRaw),
      outTime: excelTimeToHHMM(outTimeRaw),
      _rowIndex: i
    });
  }
  return rows;
}

const statusBadge = (status: string) => {
  if (status === 'success') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
      <CheckCircle2 size={11} /> Success
    </span>
  );
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
      <XCircle size={11} /> Error
    </span>
  );
  return null;
};

export const BulkAttendanceModal: React.FC<BulkAttendanceModalProps> = ({
  isOpen,
  onClose,
  selectedCompanyId,
  setBannerSuccess
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<BulkAttendanceRow[]>([]);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [showPreview, setShowPreview] = useState(true);

  const resetState = () => {
    setParsedRows([]);
    setUploadResults(null);
    setParseError(null);
    setFileName('');
    setShowPreview(true);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = (file: File) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setParseError('Please upload an Excel (.xlsx, .xls) or CSV file.');
      return;
    }
    setFileName(file.name);
    setParseError(null);
    setUploadResults(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result as ArrayBuffer;
        const rows = parseExcelSheet(data);
        if (rows.length === 0) {
          setParseError('No valid rows found. Make sure the sheet has "Employee Name", "Date", "Log In", and "Log Out" columns.');
        } else {
          setParsedRows(rows);
        }
      } catch (err: any) {
        setParseError('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [selectedCompanyId]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const headers = selectedCompanyId ? { 'x-organization-id': selectedCompanyId } : undefined;
      const res = await api.post(
        '/api/organization/bulk-attendance',
        { records: parsedRows },
        false,
        headers ? { headers } : undefined
      );
      return res;
    },
    onSuccess: (data: any) => {
      setUploadResults(data.results || []);
      queryClient.invalidateQueries({ queryKey: ['my-employees'] });
      queryClient.invalidateQueries({ queryKey: ['group-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee-details'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-stats'] });
      setBannerSuccess(\`Bulk upload: \${data.successCount} records saved successfully.\`);
      setTimeout(() => setBannerSuccess(null), 5000);
    },
    onError: (err: any) => {
      setParseError(err?.message || 'Upload failed. Please try again.');
    }
  });

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Employee Name', 'Date', 'Log In', 'Log Out', 'LOGIN DATE', 'Logout Date'],
      ['John Doe', '2026-09-01', '09:30', '18:30', '2026-09-01', '2026-09-01'],
      ['Jane Smith', '2026-09-01', '10:00', '17:00', '2026-09-01', '2026-09-01'],
      ['Mark Absent', '2026-09-01', '', '', '2026-09-01', '2026-09-01'],
    ]);
    ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, 'attendance_template.xlsx');
  };

  const successCount = uploadResults?.filter(r => r.status === 'success').length ?? 0;
  const errorCount = uploadResults?.filter(r => r.status === 'error').length ?? 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Attendance Upload"
      size="xl"
      footer={
        <div className="flex justify-between items-center w-full gap-3">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
          >
            <Download size={14} /> Download Template
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted hover:bg-muted/70 rounded-xl transition-colors"
            >
              Close
            </button>
            {parsedRows.length > 0 && !uploadResults && (
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="px-5 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {mutation.isPending ? 'Uploading...' : \`Upload \${parsedRows.length} Records\`}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">

        {/* Instructions */}
        {!parsedRows.length && !uploadResults && (
          <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2">
            <AlertCircle size={14} className="text-blue-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-blue-700">Expected columns:</strong> Employee Name, Date, Log In, Log Out, LOGIN DATE, Logout Date.
              Employees are matched by name (case-insensitive). Rows with empty Log In/Log Out are marked <strong>Absent</strong>.
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!parsedRows.length && !uploadResults && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={\`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all \${
              isDragging
                ? 'border-primary bg-primary/5 scale-[1.01]'
                : 'border-border hover:border-primary/60 hover:bg-muted/30'
            }\`}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
              <FileSpreadsheet size={28} className="text-primary" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground text-sm">Drag & drop your Excel file here</p>
              <p className="text-xs text-muted-foreground mt-1">or click to browse — .xlsx, .xls, .csv supported</p>
            </div>
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <XCircle size={16} className="shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Parsed preview */}
        {parsedRows.length > 0 && !uploadResults && (
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div
              className="flex justify-between items-center px-4 py-2.5 bg-muted/30 border-b border-border/50 cursor-pointer select-none"
              onClick={() => setShowPreview(p => !p)}
            >
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={15} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">{fileName}</span>
                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-semibold">{parsedRows.length} rows</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); resetState(); }}
                  className="p-1 hover:text-red-500 text-muted-foreground transition-colors"
                  title="Remove file"
                >
                  <Trash2 size={14} />
                </button>
                {showPreview ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
              </div>
            </div>
            {showPreview && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {['Employee Name', 'Date', 'Log In', 'Log Out', 'Out Date'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => (
                      <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium text-foreground">{row.employeeName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.inDate}</td>
                        <td className="px-3 py-1.5">{row.inTime || <span className="text-red-400 italic">Absent</span>}</td>
                        <td className="px-3 py-1.5">{row.outTime || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.outDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Upload results */}
        {uploadResults && (
          <div className="flex flex-col gap-3">
            {/* Summary */}
            <div className="flex gap-3">
              <div className="flex-1 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                <div className="text-2xl font-bold text-emerald-700">{successCount}</div>
                <div className="text-xs text-emerald-600 font-medium mt-0.5">Uploaded</div>
              </div>
              <div className="flex-1 p-3 bg-red-50 border border-red-200 rounded-xl text-center">
                <div className="text-2xl font-bold text-red-700">{errorCount}</div>
                <div className="text-xs text-red-600 font-medium mt-0.5">Failed</div>
              </div>
            </div>

            {/* Result table */}
            <div className="border border-border/50 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {['Employee', 'Status', 'Remark / Message'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResults.map((r, i) => (
                      <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium text-foreground">{r.employeeName}</td>
                        <td className="px-3 py-1.5">{statusBadge(r.status)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {r.status === 'success'
                            ? <span className="text-emerald-700 font-medium">{r.finalRemark}{r.totalHours ? \` · \${r.totalHours}h\` : ''}</span>
                            : <span className="text-red-600">{r.message}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              onClick={resetState}
              className="text-xs text-primary font-semibold hover:underline self-start"
            >
              Upload another file
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
`;

const destPath = path.join('C:\\Users\\Admin\\Documents\\GitHub\\attendSync-organization\\src\\components\\employee\\BulkAttendanceModal.tsx');

try {
  fs.writeFileSync(destPath, modalContent, 'utf8');
  console.log('Written BulkAttendanceModal.tsx successfully');
} catch (err) {
  console.error('Error writing:', err.message);
}
