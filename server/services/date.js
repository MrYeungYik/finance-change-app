const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Shanghai';

function getZonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** 服务端当前日期，格式 YYYY-MM-DD */
function todayISO(date = new Date()) {
  const { year, month, day } = getZonedParts(date);
  return `${year}-${month}-${day}`;
}

/** 用于 Word 展示与服务端生成文件名，格式 YYYY.MM.DD */
function toDotDate(isoDate) {
  return String(isoDate || '').replaceAll('-', '.');
}

function addDaysISO(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  TIME_ZONE,
  todayISO,
  toDotDate,
  addDaysISO,
};
