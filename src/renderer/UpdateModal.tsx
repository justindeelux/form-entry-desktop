import { useMemo, useState } from 'react';
import { Alert, Button, Group, Loader, Modal, Progress, ScrollArea, Stack, Text } from '@mantine/core';
import type { UpdateState } from '../shared/contracts';

export function UpdateModal({ opened, onClose, state, locked }: { opened: boolean; onClose: () => void; state: UpdateState; locked: boolean }) {
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const notes = useMemo(() => {
    // GitHub feed notes contain HTML; read inert text without rendering remote markup.
    const template = document.createElement('template');
    template.innerHTML = state.releaseNotes ?? '';
    template.content.querySelectorAll('script, style, iframe, object').forEach(node => node.remove());
    template.content.querySelectorAll('p, li, br, h1, h2, h3, h4, pre').forEach(node => node.append('\n'));
    return template.content.textContent?.trim();
  }, [state.releaseNotes]);
  const messages = {
    idle: 'Kiểm tra để tìm phiên bản mới.', unsupported: 'Cập nhật tự động chỉ dùng được với bản Windows đã cài.',
    checking: 'Đang kiểm tra cập nhật…', available: `Có phiên bản mới ${state.version}.`,
    downloading: `Đang tải phiên bản ${state.version ?? 'mới'}: ${Math.floor(state.percent ?? 0)}%`,
    downloaded: `Phiên bản ${state.version ?? 'mới'} đã tải xong. Chờ thao tác hoặc lịch kết thúc rồi khởi động lại để cập nhật.`,
    'not-available': 'Bạn đang dùng phiên bản mới nhất.', error: 'Không hoàn tất được cập nhật. Kiểm tra kết nối rồi thử lại.',
    installing: 'Đang đóng app an toàn để cập nhật. Hoàn tất cài đặt để mở lại app.',
  };
  const working = pending || ['checking', 'downloading', 'installing'].includes(state.status);
  async function request(install: boolean) {
    setPending(true); setError(undefined);
    try {
      const result = await (install ? window.desktop.installUpdate() : window.desktop.checkForUpdates());
      if (!result.ok) setError(result.error === 'BUSY' ? 'Một thao tác hoặc lịch đang chạy. Hãy chờ hoàn tất.' : 'Không hoàn tất được cập nhật. Hãy thử lại.');
    } catch { setError('Không kết nối được với trình cập nhật. Hãy thử lại.'); }
    finally { setPending(false); }
  }
  return <Modal opened={opened} onClose={onClose} title="Cập nhật ứng dụng" size="lg" closeOnClickOutside={state.status !== 'installing'} closeOnEscape={state.status !== 'installing'} withCloseButton={state.status !== 'installing'}>
    <Stack>
      <Alert color={state.status === 'error' ? 'red' : 'blue'}>
        <Text size="sm" role="status" aria-live="polite">{messages[state.status]}</Text>
        {state.status === 'downloading' && <Progress mt="xs" value={state.percent ?? 0} aria-label="Tiến độ tải cập nhật" />}
        {['checking', 'installing'].includes(state.status) && <Loader mt="xs" size="sm" aria-label={messages[state.status]} />}
      </Alert>
      {state.version && <Stack gap="xs"><Text fw={600}>Changelog {state.version}</Text><ScrollArea.Autosize mah={300}><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notes || 'Phiên bản này chưa có changelog.'}</Text></ScrollArea.Autosize></Stack>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {['available', 'downloaded'].includes(state.status) && <Text size="xs" c="dimmed">App sẽ đóng để cài đặt sau khi tải xong. Cấu hình, lịch sử gửi và phiên Chrome được giữ.</Text>}
      <Group justify="flex-end">
        <Button variant="default" loading={pending || state.status === 'checking'} disabled={working || ['unsupported', 'downloaded'].includes(state.status)} onClick={() => void request(false)}>Kiểm tra cập nhật</Button>
        {['available', 'downloaded', 'downloading', 'installing'].includes(state.status) && <Button loading={pending || ['downloading', 'installing'].includes(state.status)} disabled={locked || working} onClick={() => void request(true)}>{state.status === 'downloaded' ? 'Khởi động lại để cập nhật' : 'Cập nhật ngay'}</Button>}
      </Group>
    </Stack>
  </Modal>;
}
