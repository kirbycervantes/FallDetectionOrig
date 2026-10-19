// Downloads a table as a .csv file (opens in Excel / Google Sheets).

type Cell = string | number | boolean | null | undefined;

function cell(v: Cell): string {
  let s = v === null || v === undefined ? '' : String(v);
  // a cell that starts with = + - @ would be run as a formula by Excel
  if (/^[=+\-@]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  // the BOM makes Excel read names and symbols correctly
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** yyyy-mm-dd in local time (sorts correctly in Excel) */
export function csvDate(d: Date | null): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** hh:mm:ss, 24-hour, local time */
export function csvTime(d: Date | null): string {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
