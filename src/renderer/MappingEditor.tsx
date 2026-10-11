import { CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { ActionIcon, Group, Tooltip, Card, Checkbox, MultiSelect, Popover, Radio, Select, Text, TextInput, Title } from '@mantine/core';
import { Handle, Position, ReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { Formatting, Defaults, FormField, LoadedData, Mapping } from '../shared/contracts';
import { normalizeDate, normalizeDateTime } from '../shared/mapping';
import '@xyflow/react/dist/style.css';

type CardData = {
  side: 'source' | 'field'; title: string; hint: string;
  format?: Formatting[string]; formatChange?: (value: Formatting[string]) => void;
  field?: FormField; defaultValue?: Defaults[string]; defaultChange?: (value: Defaults[string] | undefined) => void;
  required?: boolean; unsupported?: boolean; selected?: string; disabled: boolean;
  choices?: { value: string; label: string }[]; change?: (value: string | null) => void;
};
type CardNode = Node<CardData>;
function MappingCard({ data }: NodeProps<CardNode>) {
  const [opened, setOpened] = useState(false);
  const value = typeof data.defaultValue === 'string' ? data.defaultValue : '';
  const today = typeof data.defaultValue === 'object';
  const defaultProps = { mt: 'sm', size: 'xs' as const, label: 'Giá trị mặc định',
    'aria-label': `Giá trị mặc định cho ${data.title}`, description: 'Dùng khi chưa nối cột hoặc ô Sheets trống.',
    disabled: data.disabled || data.unsupported };
  return <Card withBorder padding={8} className="mapping-card" title={data.hint}>
    {data.side === 'source' ? <Text size="sm" fw={400} truncate>{data.title}</Text> :
      <Popover opened={opened} onChange={setOpened} position="bottom-start" width={350} withinPortal>
        <Popover.Target><button className="mapping-label nodrag" type="button" aria-label={`Chọn cột cho ${data.title}`}
          aria-expanded={opened} disabled={data.disabled || data.unsupported} onClick={() => setOpened(value => !value)}
          style={{ color: data.unsupported || (data.required && !data.selected && !today && !value.trim()) ? 'var(--mantine-color-red-7)' : undefined }}>{data.title}</button></Popover.Target>
        <Popover.Dropdown className="nodrag nowheel"><Select aria-label={`Cột cho ${data.title}`} placeholder="Chọn cột" searchable clearable
          clearButtonProps={{ 'aria-label': `Xóa cột cho ${data.title}`, 'aria-hidden': false, tabIndex: 0 }} size="xs" data={data.choices} value={data.selected ?? null} disabled={data.disabled || data.unsupported}
          onChange={value => { data.change?.(value); setOpened(false); }} comboboxProps={{ withinPortal: false }} />
          {data.field?.type === 'radio' ? <Radio.Group {...defaultProps} value={value} onChange={value => data.defaultChange?.(value)}>
            {data.field.options.map(option => <Radio key={option} mt={6} size="xs" label={option} value={option} disabled={data.disabled} />)}
            <Radio mt={6} size="xs" label="Không đặt mặc định" value="" disabled={data.disabled} />
          </Radio.Group> : data.field?.type === 'dropdown' ?
            <Select {...defaultProps} data={data.field.options} value={value || null} searchable clearable
              onChange={value => data.defaultChange?.(value ?? undefined)} comboboxProps={{ withinPortal: false }} /> :
            data.field?.type === 'checkbox' ? <MultiSelect {...defaultProps} data={data.field.options} value={value.split(';').map(item => item.trim()).filter(Boolean)}
              searchable clearable onChange={values => data.defaultChange?.(values.join(';'))} comboboxProps={{ withinPortal: false }} /> :
            <TextInput {...defaultProps} type={data.field?.type === 'date' ? 'date' : data.field?.type === 'datetime' ? 'datetime-local' : 'text'} step={data.field?.timePrecision === 'second' ? 1 : 60}
              value={data.field?.type === 'date' ? normalizeDate(value) : data.field?.type === 'datetime' ? normalizeDateTime(value) : value} min={data.field?.type === 'datetime' && data.field.minDate?.length === 10 ? `${data.field.minDate}T00:00:00` : data.field?.minDate}
              max={data.field?.type === 'datetime' && data.field.maxDate?.length === 10 ? `${data.field.maxDate}T23:59:59` : data.field?.maxDate}
              disabled={defaultProps.disabled || today} onChange={event => data.defaultChange?.(event.currentTarget.value)} />}
          {['date', 'datetime'].includes(data.field?.type ?? '') && <Checkbox mt="sm" size="xs" label={data.field?.type === 'datetime' ? 'Thời gian hiện tại' : 'Ngày hiện tại'} checked={today} disabled={data.disabled}
            onChange={event => data.defaultChange?.(event.currentTarget.checked ? { currentDate: true } : undefined)} />}
          {['text', 'paragraph'].includes(data.field?.type ?? '') && <>
            <Group mt="sm" gap={6}><Checkbox size="xs" label="Làm đẹp tên" aria-label={`Làm đẹp tên cho ${data.title}`} checked={data.format?.name ?? false} disabled={data.disabled} onChange={event => data.formatChange?.({ ...data.format, name: event.currentTarget.checked })} />
              <Tooltip label="Viết hoa chữ đầu mỗi từ, các chữ còn lại viết thường và giữ dấu tiếng Việt. Ví dụ: nguyễn đức toàn → Nguyễn Đức Toàn. Chỉ áp dụng khi điền Form; dữ liệu Sheets giữ nguyên." multiline w={280} withinPortal={false} events={{ hover: true, focus: true, touch: true }}>
                <ActionIcon variant="subtle" color="gray" size="xs" aria-label="Giải thích làm đẹp tên"><CircleHelp size={15} aria-hidden="true" /></ActionIcon>
              </Tooltip></Group>
            <Group mt="xs" gap={6}><Checkbox size="xs" label="Làm đẹp số điện thoại" aria-label={`Làm đẹp số điện thoại cho ${data.title}`} checked={data.format?.phone ?? false} disabled={data.disabled} onChange={event => data.formatChange?.({ ...data.format, phone: event.currentTarget.checked })} />
              <Tooltip label="Thêm một số 0 đầu nếu giá trị không trống và chưa bắt đầu bằng 0. Ví dụ: 123456789 → 0123456789. Số đã có 0 đầu giữ nguyên. Chỉ áp dụng khi điền Form; dữ liệu Sheets giữ nguyên." multiline w={280} withinPortal={false} events={{ hover: true, focus: true, touch: true }}>
                <ActionIcon variant="subtle" color="gray" size="xs" aria-label="Giải thích làm đẹp số điện thoại"><CircleHelp size={15} aria-hidden="true" /></ActionIcon>
              </Tooltip></Group>
          </>}
          <Text size="xs" c="dimmed" mt={5}>{data.hint}</Text>
        </Popover.Dropdown>
      </Popover>}
    <Handle type={data.side === 'source' ? 'source' : 'target'} position={data.side === 'source' ? Position.Right : Position.Left}
      isConnectable={!data.disabled && !data.unsupported} aria-label={data.side === 'source' ? `Nối cột ${data.title}` : `Nối trường ${data.title}`} />
  </Card>;
}
const lineColors = ['#e03131', '#1971c2', '#2b8a3e', '#862e9c', '#e67700', '#0891b2', '#7f5539', '#5c940d', '#364fc7', '#a61e4d', '#495057', '#0b7285'];
const nodeTypes = { card: MappingCard };
export function MappingEditor({ data, mapping, defaults, formatting, disabled, onChange, onDefaultsChange, onFormattingChange }: { data: LoadedData; formatting: Formatting; onFormattingChange: (value: Formatting) => void; mapping: Mapping; defaults: Defaults; onDefaultsChange: (defaults: Defaults) => void; disabled: boolean; onChange: (mapping: Mapping) => void }) {
  const choices = data.source.columns.map(column => ({ value: column.id, label: `${column.index + 1}. ${column.label}` }));
  const change = (field: string, column: string | null) => {
    const next = { ...mapping }; if (column) next[field] = column; else delete next[field]; onChange(next);
  };
  const nodes: CardNode[] = [
    ...data.source.columns.map((column, index) => ({ id: column.id, type: 'card', position: { x: 12, y: index * 48 + 10 },
      data: { side: 'source' as const, title: column.label, hint: `Cột ${index + 1}: ${column.label}`, disabled } })),
    ...data.form.fields.map((field, index) => ({ id: field.id, type: 'card', position: { x: 535, y: index * 48 + 10 },
      data: { side: 'field' as const, title: field.title, hint: `${field.title}${field.type === 'unsupported' ? ' · Chưa hỗ trợ' : ''}${field.required ? ' · Bắt buộc' : ''}${field.options.length ? ` · ${field.options.join(' / ')}` : ''}`, required: field.required,
        field, format: formatting[field.id], formatChange: (value: Formatting[string]) => { const next = { ...formatting }; if (value.name || value.phone) next[field.id] = value; else delete next[field.id]; onFormattingChange(next); }, defaultValue: defaults[field.id], defaultChange: (value: Defaults[string] | undefined) => { const next = { ...defaults }; if (value) next[field.id] = value; else delete next[field.id]; onDefaultsChange(next); },
        unsupported: field.type === 'unsupported', selected: mapping[field.id], choices, disabled, change: (value: string | null) => change(field.id, value) } })),
  ];
  const valid = (connection: { source: string; target: string }) => !disabled && data.source.columns.some(column => column.id === connection.source) &&
    data.form.fields.some(field => field.id === connection.target && field.type !== 'unsupported') && !mapping[connection.target];
  return <div className="mapping-scroll">
    <div className="mapping-titles"><Title order={3} size="sm">Google Sheets</Title><Title order={3} size="sm">Google Form</Title></div>
    <div style={{ height: Math.max(data.source.columns.length, data.form.fields.length) * 48 + 20, width: 950 }}>
    <ReactFlow nodes={nodes} edges={Object.entries(mapping).map(([target, source]) => ({ id: target, source, target, animated: false,
      style: { stroke: lineColors[data.form.fields.findIndex(field => field.id === target)] ?? `hsl(${data.form.fields.findIndex(field => field.id === target) * 137.508 % 360} 65% 35%)` } }))}
      nodeTypes={nodeTypes} nodesDraggable={false} panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
      minZoom={1} maxZoom={1} autoPanOnConnect={false} autoPanOnNodeFocus={false} preventScrolling={false} edgesReconnectable={false}
      nodesFocusable={false} edgesFocusable={false}
      isValidConnection={valid} onConnect={connection => { if (valid(connection)) change(connection.target, connection.source); }}
      deleteKeyCode={null} />
  </div></div>;
}
