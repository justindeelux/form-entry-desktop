import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
import { utilityProcess } from 'electron';
import { createAutomation } from '../src/main/automation';

afterEach(() => vi.useRealTimers());
it('allows configured field waits past one minute while keeping a bounded timeout', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: ({ id }: { id: number }) => setTimeout(() => child.emit('message', { id, result: { ok: true, value: 'ready' } }), 65000),
  });
  vi.mocked(utilityProcess.fork).mockReturnValue(child as never);
  const automation = createAutomation();
  const prepared = automation.request('prepare', {}, 70000);
  await vi.advanceTimersByTimeAsync(65000);
  expect(await prepared).toBe('ready');
  expect(child.kill).not.toHaveBeenCalled();
  const expired = automation.request('prepare', {}, 100).catch(error => error.message);
  await vi.advanceTimersByTimeAsync(100);
  expect(await expired).toBe('BROWSER_CLOSED');
  expect(child.kill).toHaveBeenCalledOnce();
});
