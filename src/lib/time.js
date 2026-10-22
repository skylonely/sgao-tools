export function parseTimestamp(value, unit = 'auto') {
  const text = String(value).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) throw new Error('请输入有效的数字时间戳。');
  const number = Number(text);
  const actualUnit = unit === 'auto' ? (Math.abs(number) < 100_000_000_000 ? 'seconds' : 'milliseconds') : unit;
  const milliseconds = actualUnit === 'seconds' ? Math.round(number * 1000) : number;
  if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 8_640_000_000_000_000) throw new Error('时间戳超出日期范围，或毫秒值不是整数。');
  if (actualUnit === 'seconds' && text.split('.')[1]?.length > 3) throw new Error('秒级时间戳最多支持 3 位小数（毫秒精度）。');
  return { milliseconds, unit: actualUnit };
}

export function formatDateTime(milliseconds, zone = 'beijing', separator = ' ') {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new Error('日期超出有效范围。');
  if (zone === 'beijing') date.setTime(date.getTime() + 8 * 3_600_000);
  if (!Number.isFinite(date.getTime())) throw new Error('所选时区的日期超出有效范围。');
  const local = zone === 'local';
  const read = field => date[`${local ? 'get' : 'getUTC'}${field}`]();
  const pad = (value, count = 2) => String(value).padStart(count, '0');
  return `${pad(read('FullYear'), 4)}-${pad(read('Month') + 1)}-${pad(read('Date'))}${separator}${pad(read('Hours'))}:${pad(read('Minutes'))}:${pad(read('Seconds'))}`;
}

export function dateToTimestamp(value, zone = 'beijing') {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match || Number(match[1]) < 1000) throw new Error('请选择完整日期和时间（年份 1000–9999）。');
  const [, y, m, d, h, min, sec = '00'] = match;
  const parts = [y, m, d, h, min, sec].map(Number);
  const milliseconds = zone === 'local'
    ? new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime()
    : Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - (zone === 'beijing' ? 8 * 3_600_000 : 0);
  const expected = `${y}-${m}-${d}T${h}:${min}:${sec}`;
  if (formatDateTime(milliseconds, zone, 'T') !== expected) throw new Error('日期或时间无效，请检查天数或本机夏令时。');
  return milliseconds;
}
