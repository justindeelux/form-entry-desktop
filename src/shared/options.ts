import { FieldValidationError, type Aliases, type FormField } from './contracts';

const basic = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').toLocaleLowerCase('vi');
const loose = (value: string) => basic(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[._-]/g, ' ').replace(/\s+/gu, ' ').trim();

// Adjacent transpositions count as one typo; cap input before quadratic comparison.
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i), before = previous;
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], before[j - 2] + 1);
    }
    before = previous; previous = current;
  }
  return previous[b.length];
}

export function resolveOption(field: FormField, source: string, aliases: Aliases[string] = []): string {
  const options = [...new Set(field.options)];
  if (options.includes(source)) return source;
  const confirmed = [...new Set(aliases.filter(entry => entry.source === source && options.includes(entry.option)).map(entry => entry.option))];
  const fail = (reason: string): never => {
    const error = new FieldValidationError(field, reason);
    error.choice = { source, options };
    throw error;
  };
  if (confirmed.length === 1) return confirmed[0];
  if (confirmed.length > 1) return fail('Có nhiều quy tắc cho cùng giá trị; chọn lại option.');
  for (const normalize of [basic, loose]) {
    const matches = options.filter(option => normalize(option) === normalize(source));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return fail('Nhiều option giống nhau sau chuẩn hóa; hãy chọn option đúng.');
  }
  const input = loose(source);
  if (input.length >= 8 && input.length <= 256 && !/\p{N}/u.test(input)) {
    const ranked = options.map(option => {
      const target = loose(option);
      if (target.length < 8 || target.length > 256 || /\p{N}/u.test(target)) return { option, edits: Infinity, score: 0, length: target.length };
      const edits = distance(input, target);
      return { option, edits, score: 1 - edits / Math.max(input.length, target.length), length: target.length };
    }).sort((a, b) => b.score - a.score);
    const top = ranked[0];
    if (top && top.edits <= (input.length >= 16 && top.length >= 16 ? 2 : 1) && top.score >= .90 && top.score - (ranked[1]?.score ?? 0) >= .15) return top.option;
  }
  return fail('Không khớp chắc chắn với option Form; hãy chọn lựa chọn đúng một lần.');
}
