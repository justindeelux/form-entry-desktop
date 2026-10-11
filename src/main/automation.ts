import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { FieldValidationError, type Result } from '../shared/contracts';

export function createAutomation(debug = false) {
  let child: UtilityProcess | undefined;
  let sequence = 0;
  const pending = new Map<number, (result: Result<unknown>) => void>();
  function stop() {
    child?.kill();
    child = undefined;
    for (const resolve of pending.values()) resolve({ ok: false, error: 'BROWSER_CLOSED' });
    pending.clear();
  }
  async function request<T>(command: string, args?: unknown, timeoutMs = 60000): Promise<T> {
    if (!child) {
      child = utilityProcess.fork(join(__dirname, '../automation/worker.js'), [], { serviceName: 'Form Entry Automation', stdio: debug ? 'inherit' : 'ignore' });
      const current = child;
      child.on('message', (message: { id: number; result: Result<unknown> }) => {
        pending.get(message.id)?.(message.result);
        pending.delete(message.id);
      });
      child.once('exit', () => { if (child !== current) return; child = undefined; for (const resolve of pending.values()) resolve({ ok: false, error: 'BROWSER_CLOSED' }); pending.clear(); });
    }
    const id = ++sequence;
    const result = await new Promise<Result<unknown>>(resolve => {
      const timeout = setTimeout(() => { stop(); }, timeoutMs);
      pending.set(id, result => { clearTimeout(timeout); resolve(result); });
      child!.postMessage({ id, command, args });
    });
    if (!result.ok) {
      if (result.details) throw new FieldValidationError({ id: result.details.fieldId, title: result.details.fieldTitle }, result.details.reason);
      throw new Error(result.error);
    }
    return result.value as T;
  }
  return { request, stop };
}
