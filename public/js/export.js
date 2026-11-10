/** Small client-side CSV export: nothing is sent anywhere, the file is built in the browser. */

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Guard against spreadsheet formulas in text coming from the portal.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows, columns) {
  const head = columns.map((column) => cell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => cell(column.value(row))).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadCsv(filename, rows, columns) {
  // The BOM makes Excel open Bengali text correctly.
  const blob = new Blob([`﻿${toCsv(rows, columns)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
