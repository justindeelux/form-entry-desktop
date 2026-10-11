import { FieldValidationError, type ScheduleRule, type ScheduleState } from '../shared/contracts';
import { nextScheduleRun } from '../shared/schedule';

export function createScheduler(run: (signal: AbortSignal) => Promise<void>, notify: (state: ScheduleState) => void) {
  let state: ScheduleState = { active: false, running: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let rule: ScheduleRule;
  function queue() {
    const startedAt = Date.now(), nextRunAt = nextScheduleRun(rule, new Date(startedAt));
    state = { active: true, running: false, startedAt, nextRunAt }; notify(state);
    timer = setTimeout(async () => {
      timer = undefined;
      state = { ...state, running: true, nextRunAt: undefined }; notify(state);
      try { await run(controller!.signal); }
      catch (error) {
        state = { active: false, running: false, error: error instanceof Error ? error.message : 'OPERATION_FAILED',
          ...(error instanceof FieldValidationError ? { details: { fieldId: error.field.id, fieldTitle: error.field.title, reason: error.reason, row: error.row, column: error.column, choice: error.choice } } : {}) };
      }
      if (state.active) queue();
      else { state = { ...state, running: false, nextRunAt: undefined }; notify(state); }
    }, nextRunAt - startedAt);
  }
  return {
    state: () => state,
    start(config: ScheduleRule) {
      if (state.active || state.running) throw new Error('SCHEDULE_ACTIVE');
      rule = config; controller = new AbortController(); queue(); return state;
    },
    stop() {
      if (timer) clearTimeout(timer); timer = undefined;
      controller?.abort(); state = { active: false, running: state.running }; notify(state); return state;
    },
  };
}
