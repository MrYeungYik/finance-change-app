export function dateToDot(value) {
  return String(value || '').replaceAll('-', '.');
}

/** 日期展示统一使用 YYYY.MM.DD 格式 */
export function formatDateDot(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

/** 日期时间展示使用 YYYY.MM.DD HH:mm 格式 */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replaceAll('/', '.');
}

export function padNumber(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function joinChoices(values, fallback = '不涉及') {
  return Array.isArray(values) && values.length ? values.join('、') : fallback;
}
