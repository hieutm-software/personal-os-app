const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

const BYTE_UNITS = Object.freeze(['Bytes', 'KB', 'MB', 'GB', 'TB']);
const LOG_1024 = Math.log(1024);

export function formatDate(ts: number): string {
  try {
    const val = Number(ts);
    if (!Number.isFinite(val) || val <= 0) return 'N/A';
    return SHORT_DATE_FORMATTER.format(val);
  } catch {
    return 'N/A';
  }
}

export function formatBytes(bytes: number): string {
  try {
    const val = Number(bytes);
    if (!Number.isFinite(val) || val <= 0) return '0 Bytes';
    const unitIndex = Math.floor(Math.log(val) / LOG_1024);
    if (unitIndex < 0 || unitIndex >= BYTE_UNITS.length) return '0 Bytes';
    if (unitIndex === 0) return `${Math.round(val)} Bytes`;
    const scaled = val / 1024 ** unitIndex;
    return `${Number.parseFloat(scaled.toFixed(2))} ${BYTE_UNITS[unitIndex]}`;
  } catch {
    return '0 Bytes';
  }
}

export function parseLocalDate(dateStr: string): Date {
  try {
    if (!dateStr || typeof dateStr !== 'string') return new Date();
    if (dateStr.includes('T')) return new Date(dateStr);
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = Number.parseInt(parts[0], 10);
      const m = Number.parseInt(parts[1], 10);
      const d = Number.parseInt(parts[2], 10);
      if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)) {
        return new Date(y, m - 1, d);
      }
    }
    return new Date(dateStr);
  } catch {
    return new Date();
  }
}
