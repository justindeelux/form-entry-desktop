import { z } from 'zod';
import { parseTemporal } from './temporal';

export function parseFormUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('FORM_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port ||
      url.username || url.password || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(url.pathname)) {
    throw new Error('FORM_URL_INVALID');
  }
  url.hash = '';
  // Start with a clean response rather than prefilled or session-bearing parameters.
  url.search = '';
  return url.href;
}

export function parseSheetsUrl(value: string): { url: string; exportUrl: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('SHEETS_URL_INVALID'); }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/edit)?\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !match) throw new Error('SHEETS_URL_INVALID');
  const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid') ?? '0';
  if (!/^\d+$/.test(gid)) throw new Error('SHEETS_URL_INVALID');
  return { url: `https://docs.google.com/spreadsheets/d/${match[1]}/edit?gid=${gid}`, exportUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}` };
}

export const fieldSchema = z.object({
  id: z.string(), title: z.string(), required: z.boolean(),
  type: z.enum(['text', 'paragraph', 'radio', 'dropdown', 'checkbox', 'date', 'datetime', 'unsupported']),
  options: z.array(z.string()), index: z.number().int().nonnegative(),
  timeLayout: z.enum(['combined', 'time', 'parts']).optional(), timePrecision: z.enum(['minute', 'second']).optional(),
  minDate: z.string().optional(), maxDate: z.string().optional(),
});
export type FormField = z.infer<typeof fieldSchema>;
export const inspectionSchema = z.object({
  fields: z.array(fieldSchema).max(200), fingerprint: z.string(),
});
export type Inspection = z.infer<typeof inspectionSchema>;
export const payloadSchema = z.record(z.string(), z.union([z.string().max(10000), z.array(z.string().max(1000)).max(100)]));
export type Payload = z.infer<typeof payloadSchema>;
export const fillRequestSchema = z.object({ fingerprint: z.string(), payload: payloadSchema, fieldDelayMs: z.number().int().min(0).max(60000).default(0) }).strict();
export type Outcome = 'submitted' | 'failed' | 'unknown';
export const sourceSchema = z.object({
  columns: z.array(z.object({ id: z.string(), label: z.string(), index: z.number().int().nonnegative(), sample: z.string() })).max(200),
  rows: z.array(z.object({ number: z.number().int().positive(), values: z.array(z.string().max(10000)).max(200) })).max(10000),
});
export type Source = z.infer<typeof sourceSchema>;
export const loadedSchema = z.object({ source: sourceSchema, form: inspectionSchema });
export type LoadedData = z.infer<typeof loadedSchema>;
export const loadSchema = z.object({ sheetsUrl: z.string().max(2000), formUrl: z.string().max(2000), requireLogin: z.boolean().default(false), startRow: z.number().int().min(1).max(10001).optional() }).strict();
export const mappingSchema = z.record(z.string(), z.string());
export const defaultsSchema = z.record(z.string(), z.union([z.string().max(10000), z.object({ currentDate: z.literal(true) }).strict()]));
export type Defaults = z.infer<typeof defaultsSchema>;
export const aliasesSchema = z.record(z.string().max(200), z.array(z.object({ source: z.string().min(1).max(10000), option: z.string().min(1).max(1000) }).strict()).max(500));
export type Aliases = z.infer<typeof aliasesSchema>;
export const formattingSchema = z.record(z.string().max(200), z.object({ name: z.boolean().optional(), phone: z.boolean().optional() }).strict());
export type Formatting = z.infer<typeof formattingSchema>;
export const sendSchema = z.object({ mapping: mappingSchema, defaults: defaultsSchema.default({}), aliases: aliasesSchema.default({}), formatting: formattingSchema.default({}) }).strict();
export type Mapping = z.infer<typeof mappingSchema>;
export type Progress = { submitted: number; total: number; state: 'running' | 'submitted' | 'failed' | 'unknown' | 'stopped'; row?: number; reason?: 'SUBMIT_NOT_CLICKED' };
export type ValidationDetails = { fieldId: string; fieldTitle: string; reason: string; row?: number; column?: string; choice?: { source: string; options: string[] } };
export class FieldValidationError extends Error {
  row?: number;
  column?: string;
  choice?: { source: string; options: string[] };
  constructor(public field: Pick<FormField, 'id' | 'title'>, public reason: string) { super('ROW_VALIDATION_FAILED'); }
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; details?: ValidationDetails };
export const reviewSchema = z.object({ batch: z.string().regex(/^[a-f0-9]{64}$/), row: z.number().int().positive() }).strict();
export type PendingSubmission = z.infer<typeof reviewSchema>;
export const preferencesSchema = z.object({ retentionHours: z.number().int().min(1).max(8760), sendDelaySeconds: z.number().int().min(0).max(3600).default(0), fieldDelayMs: z.number().int().min(0).max(60000).default(0), deleteExpired: z.boolean().default(false), minimizeChrome: z.boolean().default(false) }).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const historyCursorSchema = z.object({ order: z.number().int().positive(), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HistoryCursor = z.infer<typeof historyCursorSchema>;
export const historyQuerySchema = sendSchema.extend({ status: z.enum(['unsent', 'sent']), cursor: historyCursorSchema.optional(), search: z.string().max(200).default(''), column: z.number().int().min(0).max(199).optional() }).strict();
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type HistoryRow = { id: string; order: number; number: number; columns: string[]; values: string[]; sentAt?: number; state: 'unsent' | 'sent' | 'unknown' };
export type HistoryPage = { rows: HistoryRow[]; nextCursor?: HistoryCursor; unsentCount: number; sentCount: number; retentionHours: number; deleteExpired: boolean };
export const historyDeleteSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const formViewSchema = sendSchema.extend({ id: historyDeleteSchema.shape.id, status: z.enum(['unsent', 'sent']) }).strict();
export const formSnapshotSchema = z.object({ formUrl: z.string().max(2000), form: inspectionSchema, payload: payloadSchema });
export type FormSnapshot = z.infer<typeof formSnapshotSchema>;
export type SendConfiguration = z.infer<typeof sendSchema>;
export const scheduleRuleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('interval'), minutes: z.number().int().min(1).max(10080) }).strict(),
  z.object({ mode: z.literal('daily'), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict(),
]);
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;
export const scheduleStartSchema = z.object({ source: loadSchema, send: sendSchema, rule: scheduleRuleSchema }).strict();
export type ScheduleRequest = z.infer<typeof scheduleStartSchema>;
export type ScheduleState = { active: boolean; running: boolean; startedAt?: number; nextRunAt?: number; error?: string; details?: ValidationDetails; data?: LoadedData };
export type UpdateState = { status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'installing'; version?: string; percent?: number; releaseNotes?: string };
export interface DesktopApi {
  checkForUpdates(): Promise<Result<void>>;
  installUpdate(): Promise<Result<void>>;
  updateState(): Promise<Result<UpdateState>>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  startSchedule(request: ScheduleRequest): Promise<Result<ScheduleState>>;
  stopSchedule(): Promise<Result<ScheduleState>>;
  scheduleState(): Promise<Result<ScheduleState>>;
  onSchedule(callback: (state: ScheduleState) => void): () => void;
  viewForm(query: z.infer<typeof formViewSchema>): Promise<Result<FormSnapshot | null>>;
  deleteProfile(): Promise<Result<void>>;
  reloadSheets(request: z.infer<typeof loadSchema>): Promise<Result<LoadedData>>;
  load(request: z.infer<typeof loadSchema>): Promise<Result<LoadedData>>;
  send(mapping: Mapping, defaults?: Defaults, aliases?: Aliases, formatting?: Formatting): Promise<Result<Progress>>;
  history(query: HistoryQuery): Promise<Result<HistoryPage>>;
  deleteHistory(id: string): Promise<Result<void>>;
  preferences(): Promise<Result<Preferences>>;
  savePreferences(preferences: Preferences): Promise<Result<Preferences>>;
  pendingSubmissions(): Promise<Result<PendingSubmission[]>>;
  confirmNotSent(request: PendingSubmission): Promise<Result<void>>;
  onProgress(callback: (progress: Progress) => void): () => void;
}

export function validatePayload(fields: FormField[], payload: Payload): void {
  if (fields.some(field => field.type === 'unsupported')) throw new Error('UNSUPPORTED_QUESTION');
  if (Object.keys(payload).some(id => !fields.some(field => field.id === id))) throw new Error('FORM_SCHEMA_CHANGED');
  for (const field of fields) {
    const value = payload[field.id];
    if (field.required && (value === undefined || (typeof value === 'string' ? !value.trim() : value.length === 0))) {
      throw new FieldValidationError(field, value === undefined ? 'Trường bắt buộc chưa có cột hoặc giá trị mặc định.' : 'Giá trị bắt buộc đang trống; kiểm tra ô Sheets và giá trị mặc định.');
    }
    if (value === undefined) continue;
    if (field.type === 'checkbox') {
      if (!Array.isArray(value)) throw new FieldValidationError(field, 'Cần danh sách lựa chọn, ngăn cách bằng dấu ;.');
      if (new Set(value).size !== value.length) throw new FieldValidationError(field, 'Có lựa chọn bị lặp lại.');
      if (value.some(option => !field.options.includes(option))) throw new FieldValidationError(field, 'Lựa chọn không khớp các option trên Form.');
    } else if (typeof value !== 'string') {
      throw new FieldValidationError(field, 'Kiểu dữ liệu không phù hợp với trường này.');
    } else if (['radio', 'dropdown'].includes(field.type) && value !== '' && !field.options.includes(value)) {
      throw new FieldValidationError(field, 'Lựa chọn không khớp các option trên Form.');
    }
    if (['date', 'datetime'].includes(field.type) && value !== '') {
      const parsed = typeof value === 'string' ? parseTemporal(value) : undefined;
      if (!parsed) throw new FieldValidationError(field, 'Ngày/giờ không hợp lệ. Dùng DD/MM/YYYY hoặc YYYY-MM-DD, có thể kèm HH:mm hoặc HH:mm:ss.');
      const canonical = field.type === 'date' ? parsed.date : `${parsed.date}T${parsed.time}`;
      if (value !== canonical) throw new FieldValidationError(field, 'Ngày/giờ chưa được chuẩn hóa đúng định dạng Form.');
      if (field.type === 'datetime' && field.timePrecision === 'minute' && !parsed.time.endsWith(':00')) {
        throw new FieldValidationError(field, 'Form chỉ nhận giờ/phút; giây phải là 00.');
      }
      if (field.minDate && (field.minDate.length === 10 ? parsed.date : canonical) < field.minDate) throw new FieldValidationError(field, `Ngày/giờ phải từ ${field.minDate} trở đi.`);
      if (field.maxDate && (field.maxDate.length === 10 ? parsed.date : canonical) > field.maxDate) throw new FieldValidationError(field, `Ngày/giờ phải không sau ${field.maxDate}.`);
    }
  }
}
