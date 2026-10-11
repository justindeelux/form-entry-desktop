import { Settings as SettingsIcon, RefreshCw, CalendarClock, Square, Trash2, RotateCcw, ChevronDown, ChevronUp, Download, Send, Save, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Container, Image, Modal, NumberInput, Group, Progress as ProgressBar, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import appIcon from '../../assets/app-icon.png';
import { scheduleRuleSchema, type ScheduleState } from '../shared/contracts';
import type { DesktopApi, LoadedData, Progress, PendingSubmission, ValidationDetails } from '../shared/contracts';
import { SheetDataTable } from './SheetDataTable';
import { MappingEditor } from './MappingEditor';
import { mappingBinding, readSettings, restoreAliases, restoreFormatting, restoreDefaults, restoreMapping, saveSettings, type Settings } from './settings';

declare global { interface Window { desktop: DesktopApi } }
const errors: Record<string, string> = {
  FORM_URL_INVALID: 'Nhập URL Google Form đầy đủ, kết thúc bằng /viewform.',
  SHEETS_URL_INVALID: 'Nhập URL Google Sheets đầy đủ, có tab cần lấy dữ liệu (gid).',
  BROWSER_NOT_FOUND: 'Cần cài Google Chrome để sử dụng tool.',
  BROWSER_CLOSED: 'Chrome đã đóng. Bấm Tải dữ liệu để mở lại.',
  LOGIN_REQUIRED: 'Đăng nhập Google trong cửa sổ Chrome vừa mở. Khi đăng nhập xong, quay lại tool và bấm Tải dữ liệu. Tool sẽ mở lại Chrome với phiên đã đăng nhập.',
  LOGIN_DISABLED: 'Nguồn hoặc Form yêu cầu đăng nhập. Bật ô Yêu cầu đăng nhập Google rồi tải lại.',
  LOGIN_BROWSER_OPEN: 'Chrome đăng nhập chưa đóng được. Thoát Chrome của tool rồi bấm Tải dữ liệu lại.',
  SHEETS_ACCESS_DENIED: 'Không tải được Sheets. Kiểm tra quyền đọc/tải bảng tính; nếu cần tài khoản, bật Yêu cầu đăng nhập Google rồi tải lại.',
  SHEETS_EMPTY: 'Không có dữ liệu từ dòng bắt đầu đã chọn. Dòng 1 là tên cột; kiểm tra số dòng bắt đầu và dữ liệu Sheets.',
  SHEETS_TOO_LARGE: 'Sheets vượt giới hạn: 10 MB, 200 cột hoặc 10.000 dòng dữ liệu.',
  SHEETS_DATA_INVALID: 'Dữ liệu Sheets không đọc được. Kiểm tra bảng tính rồi tải lại.',
  FORM_NOT_READY: 'Không đọc được Form. Kiểm tra quyền truy cập trong Chrome rồi tải lại.',
  UNSUPPORTED_QUESTION: 'Form có loại trường chưa hỗ trợ.',
  FORM_SCHEMA_CHANGED: 'Form đã thay đổi. Tải dữ liệu lại và kiểm tra các kết nối.',
  ROW_VALIDATION_FAILED: 'Dữ liệu không hợp lệ: kiểm tra cột đã nối, ô bắt buộc, ngày và lựa chọn đúng với Form.',
  RESTORED_DRAFT_REVIEW: 'Form khôi phục lựa chọn cũ. Xóa bản nháp trong Chrome rồi tải lại.',
  SUBMISSION_UNKNOWN_REVIEW: 'Có dòng chưa xác định đã gửi hay chưa. Tool khóa gửi để tránh trùng; cần đối chiếu phản hồi với chủ Form.',
  FILL_VERIFICATION_FAILED: 'Giá trị trong Chrome chưa khớp với dữ liệu Sheets. Đã dừng gửi.',
  SUBMIT_NOT_CLICKED: 'Chưa bấm Gửi: không tìm được một nút Gửi có thể click. Kiểm tra Chrome rồi tải lại dữ liệu.',
  REVIEW_STATE_CHANGED: 'Trạng thái dòng đã thay đổi. Tải lại danh sách cần đối chiếu.',
  FORM_PREPARATION_FAILED: 'Không hoàn tất bước chuẩn bị Form; dòng này chưa được bấm Gửi. Kiểm tra Chrome và tải lại dữ liệu.',
  AUTOMATION_FAILED: 'Không hoàn tất thao tác trong Chrome. Kiểm tra tiến trình và tải lại dữ liệu.',
  PROFILE_IN_USE: 'Profile vẫn bị Chrome khóa. Đóng Chrome của tool rồi thử xóa lại.',
  PROFILE_DELETE_FAILED: 'Không xóa được profile. Kiểm tra quyền truy cập rồi thử lại.',
  SCHEDULE_ACTIVE: 'Lịch đang chạy. Bấm Dừng để thay đổi cấu hình hoặc gửi thủ công.',
  MAPPING_INVALID: 'Mapping chưa hợp lệ. Kiểm tra các cột, trường bắt buộc và giá trị mặc định.',
  SCHEDULE_SEND_FAILED: 'Lượt gửi theo lịch đã dừng vì Form từ chối dữ liệu. Kiểm tra Chrome và tiến trình.',
  DATA_NOT_LOADED: 'Tải dữ liệu và kiểm tra mapping trước khi bắt đầu lịch.',
  BUSY: 'Một thao tác đang chạy. Hãy chờ hoàn tất.',
};
export function App() {
  const [initial] = useState(() => readSettings(localStorage));
  const [settings, setSettings] = useState(initial.settings);
  const { sheetsUrl, formUrl, requireLogin, startRow, mapping, defaults, aliases, formatting } = settings;
  const [schedule, setSchedule] = useState<ScheduleState>({ active: false, running: false });
  const [scheduleOpen, setScheduleOpen] = useState(false), [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleMode, setScheduleMode] = useState('interval');
  const [scheduleMinutes, setScheduleMinutes] = useState<number | string>(5);
  const [scheduleHour, setScheduleHour] = useState<number | string>(8), [scheduleMinute, setScheduleMinute] = useState<number | string>(0);
  const [clock, setClock] = useState(Date.now());
  const [saveError, setSaveError] = useState(initial.error);
  const [data, setData] = useState<LoadedData>();
  const [collapsed, setCollapsed] = useState(false);
  const [mappingCollapsed, setMappingCollapsed] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0), [unsentCount, setUnsentCount] = useState<number>();
  const [preferencesOpen, setPreferencesOpen] = useState(false), [retentionHours, setRetentionHours] = useState<number | string>(24);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [sendDelaySeconds, setSendDelaySeconds] = useState<number | string>(0);
  const [fieldDelayMs, setFieldDelayMs] = useState<number | string>(0);
  const [deleteExpired, setDeleteExpired] = useState(false), [minimizeChrome, setMinimizeChrome] = useState(false);
  const [resetTarget, setResetTarget] = useState<'url' | 'mapping' | 'profile'>();
  function updateSettings(next: Settings) {
    try { saveSettings(localStorage, next); setSaveError(undefined); }
    catch { setSaveError('Không lưu được thay đổi. Kiểm tra dung lượng và quyền lưu dữ liệu của ứng dụng.'); }
    setSettings(next);
  }
  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, setBusy] = useState<'load' | 'reload' | 'send' | 'review' | 'profile'>(), [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<ValidationDetails>();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const locked = !!busy || schedule.active || schedule.running || scheduleBusy;
  function updateSchedule(state: ScheduleState) {
    setSchedule(state); setData(state.data); setHistoryRevision(value => value + 1); setUnsentCount(undefined);
    if (state.error) showError(state.error, state.details);
    if (!state.active && !state.running) void readPending();
  }
  useEffect(() => {
    const unsubscribe = window.desktop.onSchedule(updateSchedule);
    void window.desktop.scheduleState().then(result => { if (result.ok && (result.value.active || result.value.running)) updateSchedule(result.value); });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!schedule.active && !schedule.running) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(timer);
  }, [schedule.active, schedule.running, schedule.nextRunAt]);
  async function startSchedule() {
    const rule = scheduleRuleSchema.safeParse(scheduleMode === 'interval' ? { mode: 'interval', minutes: scheduleMinutes } : { mode: 'daily', hour: scheduleHour, minute: scheduleMinute });
    if (!rule.success) { setError('Nhập số phút nguyên từ 1–10080, hoặc giờ 0–23 và phút 0–59.'); return; }
    setScheduleBusy(true); setError(undefined); setProgress(undefined);
    try {
      const result = await window.desktop.startSchedule({ source: { sheetsUrl: sheetsUrl.trim(), formUrl: formUrl.trim(), requireLogin, startRow }, send: { mapping, defaults, aliases, formatting }, rule: rule.data });
      if (result.ok) { updateSchedule(result.value); setScheduleOpen(false); } else showError(result.error, result.details);
    } catch { setError('Không bắt đầu được lịch gửi.'); }
    finally { setScheduleBusy(false); }
  }
  async function stopSchedule() {
    setScheduleBusy(true);
    try { const result = await window.desktop.stopSchedule(); if (result.ok) updateSchedule(result.value); else showError(result.error); }
    catch { setError('Không dừng được lịch. Kiểm tra trạng thái trước khi gửi tiếp.'); }
    finally { setScheduleBusy(false); }
  }
  useEffect(() => window.desktop.onProgress(setProgress), []);
  useEffect(() => { void window.desktop.preferences().then(result => { if (result.ok) { setRetentionHours(result.value.retentionHours); setSendDelaySeconds(result.value.sendDelaySeconds); setFieldDelayMs(result.value.fieldDelayMs); setDeleteExpired(result.value.deleteExpired); setMinimizeChrome(result.value.minimizeChrome); } else showError(result.error); }).catch(() => setError('Không đọc được cài đặt.')); }, []);
  const reset = () => { setData(undefined); setCollapsed(false); setProgress(undefined); setError(undefined); setChoice(undefined); setUnsentCount(undefined); setMappingCollapsed(false); };
  const showError = (code: string, details?: ValidationDetails) => {
    setChoice(details?.choice ? details : undefined); setSelectedOption(null);
    if (details) {
      setError(`${details.row ? `Dòng ${details.row} của Sheets · ` : ''}Trường “${details.fieldTitle}”${details.column ? ` (cột “${details.column}”)` : ''}: ${details.reason}`);
      return;
    }
    const [name, row] = code.split(':');
    setError(`${row ? `Dòng ${row} của Sheets: ` : ''}${errors[name] ?? 'Thao tác chưa hoàn tất. Kiểm tra Chrome và tải lại dữ liệu.'}`);
  };
  async function load(sheetsOnly = false) {
    const wasMappingCollapsed = mappingCollapsed;
    if (sheetsOnly) { setProgress(undefined); setError(undefined); setChoice(undefined); setUnsentCount(undefined); } else reset();
    setBusy(sheetsOnly ? 'reload' : 'load');
    try {
      const result = await window.desktop[sheetsOnly ? 'reloadSheets' : 'load']({ sheetsUrl: sheetsUrl.trim(), formUrl: formUrl.trim(), requireLogin, startRow });
      if (result.ok) {
        const restored = restoreMapping(settings, result.value);
        if ((Object.keys(mapping).length || Object.keys(defaults).length || Object.keys(formatting).length) && settings.binding !== mappingBinding(result.value, settings)) setError('Cột Sheets hoặc Form đã thay đổi. Các kết nối, giá trị mặc định và tùy chọn làm đẹp cũ được xóa; hãy kiểm tra lại.');
        updateSettings({ ...settings, mapping: restored, defaults: restoreDefaults(settings, result.value), aliases: restoreAliases(settings, result.value), formatting: restoreFormatting(settings, result.value), binding: mappingBinding(result.value, settings) });
        setData(result.value); setCollapsed(true); setMappingCollapsed(sheetsOnly ? wasMappingCollapsed : Object.keys(restored).length > 2); setHistoryRevision(value => value + 1);
        await readPending();
        if (result.value.form.fields.some(field => field.type === 'unsupported')) showError('UNSUPPORTED_QUESTION');
      } else { if (sheetsOnly) reset(); showError(result.error, result.details); }
    } catch { if (sheetsOnly) reset(); setError('Không kết nối được ứng dụng.'); }
    finally { setBusy(undefined); }
  }
  async function readPending() {
    const result = await window.desktop.pendingSubmissions();
    if (result.ok) { setPending(result.value); setConfirmed([]); } else showError(result.error);
  }
  async function confirmNotSent(item: PendingSubmission) {
    setBusy('review');
    try {
      const result = await window.desktop.confirmNotSent(item);
      if (!result.ok) { showError(result.error); return; }
      await readPending(); setProgress(undefined); setError(undefined); setHistoryRevision(value => value + 1);
    } catch { setError('Không cập nhật được trạng thái đối chiếu.'); }
    finally { setBusy(undefined); }
  }
  async function send() {
    setBusy('send'); setChoice(undefined); setError(undefined); setProgress(undefined);
    try {
      const result = await window.desktop.send(mapping, defaults, aliases, formatting);
      if (result.ok) {
        setProgress(result.value);
        if (result.value.state === 'unknown') await readPending();
      } else {
        showError(result.error, result.details);
        if (result.error === 'SUBMISSION_UNKNOWN_REVIEW') await readPending();
      }
    } catch { setError('Không kết nối được ứng dụng. Kiểm tra phản hồi trước khi gửi lại.'); }
    finally { setBusy(undefined); setHistoryRevision(value => value + 1); }
  }
  async function savePreferences() {
    if (typeof retentionHours !== 'number' || !Number.isInteger(retentionHours) || retentionHours < 1 || retentionHours > 8760) { setError('Thời gian lưu cần là số giờ nguyên từ 1 đến 8760.'); return; }
    if (typeof sendDelaySeconds !== 'number' || !Number.isInteger(sendDelaySeconds) || sendDelaySeconds < 0 || sendDelaySeconds > 3600) { setError('Thời gian chờ cần là số giây nguyên từ 0 đến 3600.'); return; }
    if (typeof fieldDelayMs !== 'number' || !Number.isInteger(fieldDelayMs) || fieldDelayMs < 0 || fieldDelayMs > 60000) { setError('Thời gian chờ giữa các trường cần là số mili giây nguyên từ 0 đến 60000.'); return; }
    setPreferencesBusy(true);
    try {
      const result = await window.desktop.savePreferences({ retentionHours, sendDelaySeconds, fieldDelayMs, deleteExpired, minimizeChrome });
      if (result.ok) { setPreferencesOpen(false); setProgress(undefined); setHistoryRevision(value => value + 1); } else showError(result.error);
    } catch { setError('Không lưu được cài đặt.'); }
    finally { setPreferencesBusy(false); }
  }
  async function confirmReset() {
    if (resetTarget === 'profile') {
      setPreferencesOpen(false); setBusy('profile');
      try {
        const result = await window.desktop.deleteProfile();
        if (!result.ok) { showError(result.error); return; }
        window.location.reload();
      } catch { setError('Không hoàn tất đặt lại ứng dụng. Kiểm tra Chrome rồi thử lại.'); }
      finally { setBusy(undefined); setResetTarget(undefined); }
      return;
    }
    if (resetTarget === 'url') { updateSettings({ ...settings, sheetsUrl: '', formUrl: '', requireLogin: false, startRow: undefined }); reset(); }
    else { updateSettings({ ...settings, mapping: {}, defaults: {}, aliases: {}, formatting: {} }); setProgress(undefined); setChoice(undefined); setError(undefined); setMappingCollapsed(false); }
    setResetTarget(undefined);
  }
  const ready = data && data.form.fields.every(field => {
    const fallback = defaults[field.id];
    return field.type !== 'unsupported' && (!field.required || mapping[field.id] ||
      (typeof fallback === 'string' ? fallback.trim() : ['date', 'datetime'].includes(field.type) && fallback?.currentDate));
  });
  const remaining = Math.max(0, Math.ceil(((schedule.nextRunAt ?? clock) - clock) / 1000));
  const countdown = `${Math.floor(remaining / 3600)}:${String(Math.floor(remaining / 60) % 60).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  return <Container fluid py="lg" style={{ minHeight: '100vh' }}><Stack gap="md">
    <Group justify="space-between"><Group gap="sm" wrap="nowrap"><Image src={appIcon} w={48} h={48} alt="" aria-hidden="true" draggable={false} /><Title order={1} size="h2">Sheets → Google Form</Title></Group><Button leftSection={<SettingsIcon size={16} aria-hidden="true" />} color="red" variant="filled" disabled={locked} onClick={() => setPreferencesOpen(true)}>Cài đặt</Button></Group>
    <Modal opened={scheduleOpen} onClose={() => { if (!scheduleBusy) setScheduleOpen(false); }} title="Đặt lịch gửi">
      <Stack gap="sm">
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <SegmentedControl aria-label="Kiểu lịch gửi" value={scheduleMode} onChange={setScheduleMode} data={[{ value: 'interval', label: 'Mỗi N phút' }, { value: 'daily', label: 'Hàng ngày' }]} disabled={scheduleBusy} />
        {scheduleMode === 'interval' ? <NumberInput label="Số phút giữa các lượt" value={scheduleMinutes} onChange={setScheduleMinutes} min={1} max={10080} allowDecimal={false} disabled={scheduleBusy} /> : <Group grow>
          <NumberInput label="Giờ" value={scheduleHour} onChange={setScheduleHour} min={0} max={23} allowDecimal={false} disabled={scheduleBusy} />
          <NumberInput label="Phút" value={scheduleMinute} onChange={setScheduleMinute} min={0} max={59} allowDecimal={false} disabled={scheduleBusy} />
        </Group>}
        <Text size="xs" c="dimmed">Lượt đầu chạy sau số phút đã chọn hoặc vào giờ hằng ngày trên máy. Mỗi lượt tải lại Sheets và chỉ nhận dòng có đủ giá trị đã mapping (có thể dùng mặc định), đúng lựa chọn/ngày và trường bắt buộc. Dòng chưa đủ sẽ chờ lượt sau. Giữ tool mở; đóng tool sẽ dừng lịch.</Text>
        <Button leftSection={<CalendarClock size={16} aria-hidden="true" />} onClick={startSchedule} loading={scheduleBusy} disabled={locked}>Bắt đầu</Button>
      </Stack>
    </Modal>
    <Modal opened={preferencesOpen} onClose={() => { if (!preferencesBusy) setPreferencesOpen(false); }} title="Cài đặt">
      <Stack gap="sm"><Checkbox label="Xóa dữ liệu hết thời gian lưu" checked={deleteExpired} onChange={event => setDeleteExpired(event.currentTarget.checked)} disabled={preferencesBusy} />
      <NumberInput label="Thời gian lưu dữ liệu đã gửi (giờ)" value={retentionHours} onChange={setRetentionHours} min={1} max={8760} allowDecimal={false} disabled={preferencesBusy || !deleteExpired} />
      <Text size="sm" c="dimmed">Chỉ tự xóa khi bật checkbox. Mặc định 24 giờ. Dữ liệu hết thời gian lưu sẽ được xóa khỏi lịch sử và có thể gửi lại. Giảm thời gian lưu áp dụng ngay.</Text>
      <NumberInput label="Thời gian chờ giữa mỗi lần gửi (giây)" value={sendDelaySeconds} onChange={setSendDelaySeconds} min={0} max={3600} allowDecimal={false} disabled={preferencesBusy} />
      <Text size="sm" c="dimmed">Chờ sau khi gửi thành công trước khi điền dòng tiếp theo. 0 giây để gửi liên tục.</Text>
      <NumberInput label="Thời gian chờ giữa mỗi trường (mili giây)" value={fieldDelayMs} onChange={setFieldDelayMs} min={0} max={60000} allowDecimal={false} disabled={preferencesBusy} />
      <Checkbox label="Thu gọn Chrome xuống taskbar / Dock" checked={minimizeChrome} onChange={event => setMinimizeChrome(event.currentTarget.checked)} disabled={preferencesBusy} />
      <Text size="xs" c="dimmed">Cửa sổ đăng nhập Google luôn hiển thị.</Text>
      <Button leftSection={<Save size={16} aria-hidden="true" />} onClick={savePreferences} loading={preferencesBusy}>Lưu cài đặt</Button>
      <Button leftSection={<Trash2 size={16} aria-hidden="true" />} color="red" variant="light" disabled={locked || preferencesBusy} onClick={() => { setPreferencesOpen(false); setResetTarget('profile'); }}>Xóa profile</Button></Stack>
    </Modal>
    <Modal opened={!!resetTarget} onClose={() => { if (!locked) setResetTarget(undefined); }} title={resetTarget === 'profile' ? 'Xác nhận xóa profile' : resetTarget === 'url' ? 'Xác nhận Reset URL' : 'Xác nhận Reset mapping'} closeOnClickOutside={!locked} closeOnEscape={!locked} withCloseButton={!locked}>
      <Stack gap="sm"><Text size="sm">{resetTarget === 'profile' ? 'Đóng Chrome của tool và xóa toàn bộ dữ liệu app đã lưu: phiên đăng nhập, cookie, cache, bản nháp, URL, mapping, giá trị mặc định, lựa chọn đã xác nhận, lịch sử gửi và trạng thái chống gửi trùng. Mọi cài đặt trở về mặc định như mới. Thao tác này không thể hoàn tác. Phản hồi trên Google Form không bị xóa; dữ liệu cũ có thể được gửi lại sau khi đặt lại app.' : resetTarget === 'url' ? 'Xóa hai URL và tắt yêu cầu đăng nhập? Mapping được giữ để khôi phục khi nhập lại cùng nguồn/Form. Lịch sử gửi được giữ.' : 'Xóa tất cả đường nối, giá trị mặc định, tùy chọn làm đẹp và lựa chọn đã xác nhận? Lịch sử gửi được giữ.'}</Text>
      <Group justify="flex-end"><Button leftSection={<X size={16} aria-hidden="true" />} variant="default" disabled={locked} onClick={() => setResetTarget(undefined)}>Hủy</Button>
      <Button leftSection={resetTarget === 'profile' ? <Trash2 size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} color="red" loading={busy === 'profile'} disabled={locked} onClick={confirmReset}>{resetTarget === 'profile' ? 'Xác nhận xóa profile' : 'Xác nhận reset'}</Button></Group></Stack>
    </Modal>
    <Card withBorder>
      <Group justify="space-between">
        <Text size="sm" fw={500}>Nguồn dữ liệu</Text>
        <Button leftSection={collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />} variant="subtle" size="xs" disabled={locked} aria-expanded={!collapsed} aria-controls="source-inputs"
          onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Chỉnh sửa URL' : 'Thu gọn'}</Button>
      </Group>
      <Collapse expanded={!collapsed} id="source-inputs"><Stack gap="sm" mt="sm">
      <TextInput label="URL Google Sheets" placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=0" value={sheetsUrl} disabled={locked}
        onChange={event => { updateSettings({ ...settings, sheetsUrl: event.currentTarget.value }); reset(); }} />
      <TextInput label="URL Google Form" placeholder="https://docs.google.com/forms/d/e/…/viewform" value={formUrl} disabled={locked}
        onChange={event => { updateSettings({ ...settings, formUrl: event.currentTarget.value }); reset(); }} />
      <NumberInput label="Dòng bắt đầu đọc trên Sheets" description="Không bắt buộc. Ví dụ 101 để đọc từ dòng 101; dòng 1 vẫn dùng làm tiêu đề cột." placeholder="Từ đầu" value={startRow ?? ''} min={1} max={10001} allowDecimal={false} disabled={locked} onChange={value => { updateSettings({ ...settings, startRow: typeof value === 'number' ? value : undefined }); reset(); }} />
      <Checkbox label="Yêu cầu đăng nhập Google" checked={requireLogin} disabled={locked} onChange={event => { updateSettings({ ...settings, requireLogin: event.currentTarget.checked }); reset(); }} />
      <Group gap="sm">
        <Button leftSection={<Download size={16} aria-hidden="true" />} flex={1} onClick={() => load()} loading={busy === 'load'} disabled={locked || !sheetsUrl.trim() || !formUrl.trim()}>Tải dữ liệu</Button>
        <Button leftSection={<RotateCcw size={16} aria-hidden="true" />} variant="light" disabled={locked} onClick={() => setResetTarget('url')}>Reset URL</Button>
      </Group>
    </Stack></Collapse></Card>
    {saveError && <Alert color="red" role="alert">{saveError}</Alert>}
    {error && <Alert color="red" role="alert">{error}
      {choice?.choice && <Stack gap="xs" mt="xs">
        <Text size="sm">Giá trị Sheets: {choice.choice.source}</Text>
        <Select label="Option đúng trên Form" data={choice.choice.options} searchable value={selectedOption} onChange={setSelectedOption} disabled={locked} />
        <Button leftSection={<Check size={14} aria-hidden="true" />} size="xs" disabled={locked || !selectedOption} onClick={() => {
          if (!selectedOption || !choice.choice) return;
          updateSettings({ ...settings, aliases: { ...aliases, [choice.fieldId]: [
            ...(aliases[choice.fieldId] ?? []).filter(entry => entry.source !== choice.choice!.source),
            { source: choice.choice.source, option: selectedOption },
          ] } });
          setChoice(undefined); setError(undefined); setProgress(undefined);
        }}>Dùng lựa chọn này</Button>
      </Stack>}
    </Alert>}
    {pending.length > 0 && <Alert color="yellow" title="Đối chiếu dòng chưa rõ kết quả">
      <Text size="sm">Chỉ xác nhận sau khi kiểm tra phản hồi với chủ Form và chắc chắn dòng chưa được gửi. Xác nhận cho phép tool gửi lại dòng này; nếu đã gửi sẽ bị trùng.</Text>
      {pending.map(item => {
        const key = `${item.batch}:${item.row}`;
        return <Group key={key} mt="xs">
          <Checkbox label={`Tôi đã đối chiếu: dòng ${item.row} chưa được gửi (lượt ${item.batch.slice(0, 8)})`}
            checked={confirmed.includes(key)} disabled={locked} onChange={event => { const checked = event.currentTarget.checked; setConfirmed(value => checked ? [...value, key] : value.filter(id => id !== key)); }} />
          <Button leftSection={<Check size={14} aria-hidden="true" />} size="xs" disabled={locked || !confirmed.includes(key)} onClick={() => confirmNotSent(item)}>Xác nhận chưa gửi dòng {item.row}</Button>
        </Group>;
      })}
    </Alert>}
    {data && <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm">{data.source.rows.length} dòng Sheets · {data.form.fields.length} trường Form</Text>

      </Group>
      <Card withBorder><Group justify="space-between"><Text size="sm">Mapping</Text>
        <Group gap="xs"><Button leftSection={<RotateCcw size={14} aria-hidden="true" />} size="xs" variant="light" disabled={locked} onClick={() => setResetTarget('mapping')}>Reset mapping</Button>
        <Button leftSection={mappingCollapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />} variant="subtle" size="xs" disabled={locked} aria-expanded={!mappingCollapsed} aria-controls="mapping-panel" onClick={() => setMappingCollapsed(value => !value)}>{mappingCollapsed ? 'Chỉnh sửa mapping' : 'Thu gọn mapping'}</Button></Group>
      </Group><Collapse expanded={!mappingCollapsed} id="mapping-panel"><Stack gap="sm" mt="sm">
      <Text size="xs" c="dimmed">Kéo từ chấm bên cột sang chấm bên trường. Bấm vào tên trường để chọn cột, xóa kết nối hoặc đặt giá trị mặc định; dùng được bằng bàn phím.</Text>
      <MappingEditor data={data} formatting={formatting} onFormattingChange={value => { updateSettings({ ...settings, formatting: value }); setProgress(undefined); setChoice(undefined); setError(undefined); }} mapping={mapping} defaults={defaults} onDefaultsChange={value => { updateSettings({ ...settings, defaults: value }); setProgress(undefined); setChoice(undefined); setError(undefined); }} disabled={locked} onChange={value => { updateSettings({ ...settings, mapping: value }); setProgress(undefined); setChoice(undefined); setError(undefined); }} />
      <Text size="xs" c="dimmed">Dòng đầu là tên cột. Ngày: DD/MM/YYYY hoặc YYYY-MM-DD, có thể kèm giờ. Form chỉ cần ngày thì bỏ giờ; thiếu giờ thì dùng 00:00:00. Nhiều lựa chọn: ngăn cách bằng dấu ; Tool khớp hoa/thường, dấu và lỗi gõ nhỏ; nếu chưa rõ, bạn chọn option một lần.</Text>
      </Stack></Collapse></Card>
      {(schedule.active || schedule.running) && <Stack gap={3} aria-live="polite">
        <Text size="xs" c="dimmed">{schedule.running ? schedule.active ? 'Đang tải Sheets và gửi các dòng mới…' : 'Đang dừng lịch; hoàn tất xử lý dòng hiện tại…' : `Lượt tiếp theo sau ${countdown}`}</Text>
        <ProgressBar key={schedule.nextRunAt} size={4} color="orange" transitionDuration={100} styles={{ section: { transitionTimingFunction: 'linear' } }} aria-label="Đếm ngược lịch gửi" value={schedule.running ? 0 : Math.min(100, Math.max(0, ((schedule.nextRunAt ?? clock) - clock) / ((schedule.nextRunAt ?? clock + 1) - (schedule.startedAt ?? clock)) * 100))} />
      </Stack>}
      <Group gap="sm" wrap="nowrap">
        <Button flex={1} leftSection={<Send size={16} aria-hidden="true" />} color="green" onClick={send} loading={busy === 'send'} disabled={locked || !ready || unsentCount === undefined || unsentCount === 0 || progress?.state === 'unknown'}>Gửi {unsentCount ?? data.source.rows.length} dòng lên Form</Button>
        {schedule.active || schedule.running ? <Button leftSection={<Square size={16} aria-hidden="true" />} color="red" onClick={stopSchedule} loading={scheduleBusy || !schedule.active && schedule.running} disabled={scheduleBusy || !schedule.active}>Dừng</Button> : <Button leftSection={<CalendarClock size={16} aria-hidden="true" />} variant="light" onClick={() => { setError(undefined); setScheduleOpen(true); }} disabled={locked || !ready || pending.length > 0}>Đặt lịch</Button>}
        <Button leftSection={<RefreshCw size={16} aria-hidden="true" />} variant="light" onClick={() => load(true)} loading={busy === 'reload'} disabled={locked}>Tải lại Sheets</Button>
      </Group>
      {progress && <Stack gap={5} role="status">
        <ProgressBar value={progress.total ? progress.submitted / progress.total * 100 : 0} />
        <Text size="sm">Đã gửi {progress.submitted}/{progress.total} dòng.{progress.state === 'stopped' ? ' Đã dừng lịch.' : progress.state === 'submitted' ? ' Hoàn tất.' : progress.state === 'failed' ? progress.reason === 'SUBMIT_NOT_CLICKED' ? ` Chưa bấm Gửi dòng ${progress.row}. Đã dừng; kiểm tra Chrome và tải lại.` : ` Form từ chối dòng ${progress.row}. Đã dừng.` : progress.state === 'unknown' ? ` Chưa xác định kết quả dòng ${progress.row}. Cần đối chiếu trước khi gửi tiếp.` : ''}</Text>
      </Stack>}
      <SheetDataTable columns={data.source.columns} formatting={formatting} mapping={mapping} defaults={defaults} aliases={aliases} revision={historyRevision} disabled={!!busy || scheduleBusy || schedule.running || preferencesBusy} readOnly={schedule.active} onCounts={setUnsentCount}
        onDelete={() => { setHistoryRevision(value => value + 1); setProgress(undefined); }} />
    </Stack>}
  </Stack></Container>;
}
