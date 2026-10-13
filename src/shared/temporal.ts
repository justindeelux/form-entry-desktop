import { z } from 'zod';

// Parse calendar parts directly so machine locale/timezone cannot change the source date.
export function parseTemporal(value: string): { date: string; time: string } | undefined {
  value = value.trim().replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})$/, '$2 $1');
  const match = value.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i);
  if (!match) return;
  const parts = /^\d{4}-/.test(match[1]) ? match[1].split('-') : match[1].split(/[-/]/).reverse();
  const date = parts.map((part, index) => part.padStart(index ? 2 : 4, '0')).join('-');
  if (date.startsWith('0000') || !z.iso.date().safeParse(date).success) return;
  let hour = Number(match[2] ?? 0);
  const minute = Number(match[3] ?? 0), second = Number(match[4] ?? 0);
  if (match[5]) {
    if (hour < 1 || hour > 12) return;
    hour = hour % 12 + (match[5].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return;
  return { date, time: [hour, minute, second].map(part => String(part).padStart(2, '0')).join(':') };
}
export function normalizeDate(value: string): string { return parseTemporal(value)?.date ?? value; }
export function normalizeDateTime(value: string): string {
  const parsed = parseTemporal(value);
  return parsed ? `${parsed.date}T${parsed.time}` : value;
}
