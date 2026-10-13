import { Eye, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Table, Tabs, Text, TextInput, Select, Modal, ActionIcon, Tooltip } from '@mantine/core';
import type { FormSnapshot, HistoryRow, Formatting, Aliases, Defaults, HistoryCursor, HistoryPage, Mapping, SheetColumns, Source } from '../shared/contracts';

export function SheetDataTable({ columns, mapping, defaults, aliases, formatting, sheetColumns, revision, disabled, readOnly = false, onCounts, onDelete }: {
  sheetColumns: SheetColumns; columns: Source['columns']; formatting: Formatting; mapping: Mapping; defaults: Defaults; aliases: Aliases; revision: number; disabled: boolean; readOnly?: boolean;
  onCounts: (count: number) => void; onDelete: () => void;
}) {
  const [resetRow, setResetRow] = useState<HistoryRow>();
  const [view, setView] = useState<{ row: HistoryRow; status: 'unsent' | 'sent' }>();
  const [details, setDetails] = useState<FormSnapshot | null>();
  const [viewError, setViewError] = useState<string>();
  const [viewLoading, setViewLoading] = useState(false);
  const [status, setStatus] = useState<'unsent' | 'sent'>('unsent');
  const [cursor, setCursor] = useState<HistoryCursor>();
  const [previous, setPrevious] = useState<(HistoryCursor | undefined)[]>([]);
  const [page, setPage] = useState<HistoryPage>();
  const [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState(''), [column, setColumn] = useState<string | null>(null);
  useEffect(() => { setCursor(undefined); setPrevious([]); }, [revision, mapping, defaults, aliases, formatting, sheetColumns]);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    setLoading(true);
    void window.desktop.history({ mapping, defaults, aliases, formatting, sheetColumns, status, cursor, search, column: column === null ? undefined : Number(column) }).then(result => {
      if (!active) return;
      if (result.ok) { setPage(result.value); onCounts(result.value.unsentCount); setError(undefined); }
      else setError('Không tải được bảng dữ liệu. Tải lại Sheets/Form để kiểm tra.');
    }).catch(() => { if (active) setError('Không kết nối được ứng dụng.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mapping, defaults, aliases, formatting, sheetColumns, revision, status, cursor, disabled, tick, search, column]);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 60000); return () => clearInterval(timer); }, []);
  async function remove(id: string) {
    setLoading(true);
    try {
      const result = await window.desktop.deleteHistory(id, sheetColumns);
      if (result.ok) { setResetRow(undefined); onDelete(); } else setError('Không cập nhật được trạng thái trên Sheets. Kiểm tra quyền chỉnh sửa và tải lại bảng dữ liệu.');
    } catch { setError('Không cập nhật được dòng trên Sheets.'); }
    finally { setLoading(false); }
  }
  async function showForm(row: HistoryRow) {
    setView({ row, status }); setDetails(undefined); setViewError(undefined); setViewLoading(true);
    try {
      const result = await window.desktop.viewForm({ id: row.id, status, mapping, defaults, aliases, formatting, sheetColumns });
      if (result.ok) setDetails(result.value);
      else setViewError(result.details ? `${result.details.fieldTitle}: ${result.details.reason}` : 'Không xem được nội dung Form. Dòng có thể đã thay đổi; hãy tải lại dữ liệu và kiểm tra mapping.');
    } catch { setViewError('Không kết nối được ứng dụng.'); }
    finally { setViewLoading(false); }
  }
  const headers = [...new Map((page?.rows ?? []).flatMap(row => row.columns.map((label, index) => [`${index}:${label}`, { label, index }] as const))).values()];
  return <Card withBorder><Tabs value={status} onChange={value => { setStatus(value as 'unsent' | 'sent'); setCursor(undefined); setPrevious([]); }}>
    <Tabs.List>
      <Tabs.Tab value="unsent" disabled={disabled}>Chưa gửi ({page?.unsentCount ?? 0})</Tabs.Tab>
      <Tabs.Tab value="sent" disabled={disabled}>Đã gửi ({page?.sentCount ?? 0})</Tabs.Tab>
    </Tabs.List>
    <Group mt="sm" align="flex-end"><TextInput flex={1} label="Tìm kiếm dữ liệu" placeholder="Nhập giá trị cần tìm" value={search} maxLength={200} disabled={disabled} onChange={event => { setSearch(event.currentTarget.value); setCursor(undefined); setPrevious([]); }} />
      <Select label="Lọc theo cột" placeholder="Tất cả cột" clearable searchable value={column} disabled={disabled} data={columns.map(item => ({ value: String(item.index), label: `${item.index + 1}. ${item.label || '(trống)'}` }))} onChange={value => { setColumn(value); setCursor(undefined); setPrevious([]); }} />
    </Group><Text size="xs" c="dimmed" mt={4}>Bộ lọc chỉ áp dụng cho bảng, không thay đổi các dòng được gửi.</Text>
    <Text size="xs" c="dimmed" mt="sm">Trạng thái và thời gian lấy từ các cột Sheets đã chọn trong mapping.</Text>
    {error && <Alert color="red" mt="sm">{error}</Alert>}
    <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto', marginTop: 12 }} aria-busy={loading}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead><Table.Tr>
          {status === 'sent' && <Table.Th>Thao tác</Table.Th>}
          <Table.Th>Dòng Sheets</Table.Th><Table.Th>Trạng thái</Table.Th>
          {status === 'sent' && <Table.Th>Đã gửi lúc</Table.Th>}
          {headers.map(header => <Table.Th key={`${header.index}:${header.label}`} style={{ whiteSpace: 'nowrap' }}>{header.label}</Table.Th>)}
          {status === 'unsent' && <Table.Th>Thao tác</Table.Th>}
        </Table.Tr></Table.Thead>
        <Table.Tbody>{page?.rows.map(row => <Table.Tr key={row.id}>
          {status === 'sent' && <Table.Td><Group gap="xs" wrap="nowrap">
            <Tooltip label="Xem form" events={{ hover: true, focus: true, touch: true }}><ActionIcon variant="light" disabled={disabled || loading || viewLoading} aria-label={`Xem form dòng ${row.number}`} onClick={() => showForm(row)}><Eye size={16} aria-hidden="true" /></ActionIcon></Tooltip>
            <Tooltip label="Đánh dấu chưa gửi" events={{ hover: true, focus: true, touch: true }}><ActionIcon variant="light" color="red" disabled={disabled || readOnly || loading} aria-label={`Đánh dấu dòng ${row.number} chưa gửi`} onClick={() => setResetRow(row)}><Trash2 size={16} aria-hidden="true" /></ActionIcon></Tooltip>
          </Group></Table.Td>}
          <Table.Td>{row.number}</Table.Td><Table.Td><Badge color={row.state === 'sent' ? 'green' : row.state === 'unknown' ? 'yellow' : 'gray'}>{row.state === 'sent' ? 'Đã gửi' : row.state === 'unknown' ? 'Chờ đối chiếu' : 'Chưa gửi'}</Badge></Table.Td>
          {status === 'sent' && <Table.Td style={{ whiteSpace: 'nowrap' }}>{row.sentAt ? new Date(row.sentAt).toLocaleString('vi-VN') : ''}</Table.Td>}
          {headers.map(header => <Table.Td key={`${header.index}:${header.label}`} style={{ minWidth: 110, whiteSpace: 'pre-wrap' }}>{row.columns[header.index] === header.label ? row.values[header.index] : '—'}</Table.Td>)}
          {status === 'unsent' && <Table.Td><Button leftSection={<Eye size={14} aria-hidden="true" />} size="xs" variant="light" disabled={disabled || loading || viewLoading} aria-label={`Xem trước form dòng ${row.number}`} onClick={() => showForm(row)}>Xem trước form</Button></Table.Td>}
        </Table.Tr>)}</Table.Tbody>
      </Table>
    </div>
    {!page?.rows.length && !loading && <Text size="sm" c="dimmed" mt="sm">Không có dữ liệu {status === 'sent' ? 'đã gửi.' : 'chưa gửi.'}</Text>}
    <Group justify="space-between" mt="sm">
      <Text size="xs" c="dimmed">Dòng cuối Sheets ở đầu · tối đa 20 dòng mỗi lượt.</Text>
      <Group gap="xs"><Button leftSection={<ChevronLeft size={14} aria-hidden="true" />} size="xs" variant="light" disabled={disabled || loading || !previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(value => value.slice(0, -1)); }}>Mới hơn</Button>
      <Button rightSection={<ChevronRight size={14} aria-hidden="true" />} size="xs" variant="light" disabled={disabled || loading || !page?.nextCursor} onClick={() => { setPrevious(value => [...value, cursor]); setCursor(page?.nextCursor); }}>Cũ hơn</Button></Group>
    </Group>
  </Tabs>
    <Modal opened={!!resetRow} onClose={() => { if (!loading) setResetRow(undefined); }} title={`Đánh dấu dòng ${resetRow?.number ?? ''} chưa gửi`}>
      <Text size="sm">Đổi Kết quả thành Chưa gửi, xóa Gửi lúc và đặt Đã nhập lại về 0 trên Sheets. Dòng sẽ được gửi như lần đầu ở lượt tiếp theo.</Text>
      <Group justify="flex-end" mt="md"><Button variant="default" disabled={loading} onClick={() => setResetRow(undefined)}>Hủy</Button>
        <Button color="red" loading={loading} disabled={disabled || readOnly} onClick={() => { if (resetRow) void remove(resetRow.id); }}>Đánh dấu chưa gửi</Button></Group>
    </Modal>
    <Modal opened={!!view} onClose={() => setView(undefined)} title={`Xem trước form · Dòng Sheets ${view?.row.number ?? ''}`} size="lg">
      {view?.status === 'unsent' && <Text size="sm" c="dimmed" mb="sm">Nội dung theo mapping hiện tại, chưa gửi lên Form. Giá trị ngày/giờ hiện tại được tính lại lúc gửi.</Text>}
      {view?.status === 'sent' && <Text size="sm" c="dimmed" mb="sm">Nội dung dựng từ Sheets và mapping hiện tại. Thời gian gửi gần nhất: {view.row.sentAt ? new Date(view.row.sentAt).toLocaleString('vi-VN') : ''}.</Text>}
      {viewLoading && <Text>Đang tải nội dung Form…</Text>}
      {viewError && <Alert color="red">{viewError}</Alert>}
      {details === null && <Alert color="yellow">Lịch sử cũ chưa lưu nội dung Form đã gửi. Chỉ các lần gửi mới có thông tin này.</Alert>}
      {details && <><Text size="xs" c="dimmed" mb="sm" style={{ overflowWrap: 'anywhere' }}>{details.formUrl}</Text><Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>Trường Form</Table.Th><Table.Th>Giá trị</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{details.form.fields.map(field => { const value = details.payload[field.id]; return <Table.Tr key={field.id}><Table.Td>{field.title}</Table.Td><Table.Td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === undefined ? 'Không điền' : Array.isArray(value) ? value.join('; ') || '(trống)' : value || '(trống)'}</Table.Td></Table.Tr>; })}</Table.Tbody>
      </Table></>}
    </Modal>
  </Card>;
}
