import { FieldValidationError, type LoadedData, type ScheduleRule, type SendConfiguration } from './contracts';
import { mapRow } from './mapping';

export function nextScheduleRun(rule: ScheduleRule, now = new Date()): number {
  if (rule.mode === 'interval') return now.getTime() + rule.minutes * 60000;
  const next = new Date(now);
  next.setHours(rule.hour, rule.minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function completeScheduledRows(data: LoadedData, config: SendConfiguration, now = new Date()): LoadedData {
  if (data.form.fields.some(field => field.type === 'unsupported') ||
      Object.entries(config.mapping).some(([field, column]) => !data.form.fields.some(item => item.id === field) || !data.source.columns.some(item => item.id === column))) throw new Error('MAPPING_INVALID');
  const rows = data.source.rows.filter(row => {
    try {
      const payload = mapRow(data, row.values, config.mapping, config.defaults, now, config.aliases, config.formatting);
      return Object.keys(config.mapping).every(field => {
        const value = payload[field];
        return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
      });
    } catch (error) { if (error instanceof FieldValidationError) return false; throw error; }
  });
  return { ...data, source: { ...data.source, columns: data.source.columns.map(column => ({ ...column, sample: rows[0]?.values[column.index] ?? '' })), rows } };
}
