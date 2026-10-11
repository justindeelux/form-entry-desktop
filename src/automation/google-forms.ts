import { setTimeout as wait } from 'node:timers/promises';
import { normalizeDateTime } from '../shared/temporal';
import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import { FieldValidationError, parseFormUrl, validatePayload, type FormField, type Inspection, type Payload, type Outcome } from '../shared/contracts';

const timeParts = {
  hour: 'input[name$="_hour"], input[aria-label="Hour" i], input[aria-label="Giờ" i]',
  minute: 'input[name$="_minute"], input[aria-label="Minute" i], input[aria-label="Phút" i]',
  second: 'input[name$="_second"], input[aria-label="Second" i], input[aria-label="Giây" i]',
};

export async function inspectForm(page: Page): Promise<Inspection> {
  if (new URL(page.url()).hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
  parseFormUrl(page.url());
  if (await page.getByRole('button', { name: /^(Next|Tiếp)$/ }).count()) throw new Error('UNSUPPORTED_QUESTION');
  const fields = await page.locator('[role="listitem"]').evaluateAll((containers, parts) => containers.flatMap((container, index) => {
    const heading = container.querySelector('[role="heading"]');
    if (!heading) return [];
    const title = (heading.textContent ?? '').trim();
    let type: FormField['type'] = 'unsupported';
    if (container.querySelector('[role="checkbox"]')) type = 'checkbox';
    else if (container.querySelector('[role="radiogroup"]')) type = 'radio';
    else if (container.querySelector('[role="listbox"]')) type = 'dropdown';
    else if (container.querySelector('input[type="datetime-local"]')) type = 'datetime';
    else if (container.querySelector('input[type="date"]')) {
      if (container.querySelector('input[type="time"]') || (container.querySelector(parts.hour) && container.querySelector(parts.minute))) type = 'datetime';
      else type = container.querySelectorAll('input:not([type="hidden"])').length === 1 ? 'date' : 'unsupported';
    }
    else if (container.querySelector('textarea')) type = 'paragraph';
    else if (container.querySelector('input[type="text"], input:not([type])')) type = 'text';
    const role = type === 'radio' ? 'radio' : type === 'checkbox' ? 'checkbox' : 'option';
    const options = Array.from(container.querySelectorAll(`[role="${role}"]`))
      .map(element => element.getAttribute('data-value') ?? element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '')
      .filter(option => option !== '' && option !== 'Choose' && option !== 'Chọn');
    const date = ['date', 'datetime'].includes(type) ? container.querySelector('input[type="date"], input[type="datetime-local"]') : null;
    const combined = container.querySelector('input[type="datetime-local"]');
    const time = combined ?? container.querySelector('input[type="time"]');
    const seconds = time ? time.getAttribute('step') === 'any' || Number(time.getAttribute('step') ?? 60) < 60 : !!container.querySelector(parts.second);
    return [{ id: `q-${index}`, index, title, type, required: title.includes('*') || !!container.querySelector('[aria-required="true"], [required]'), options,
      ...(type === 'datetime' ? { timeLayout: combined ? 'combined' as const : time ? 'time' as const : 'parts' as const, timePrecision: seconds ? 'second' as const : 'minute' as const } : {}),
      ...(date?.getAttribute('min') ? { minDate: date.getAttribute('min')! } : {}),
      ...(date?.getAttribute('max') ? { maxDate: date.getAttribute('max')! } : {}),
    }];
  }), timeParts);
  if (!fields.length) throw new Error('FORM_NOT_READY');
  // Controls outside a discovered question (e.g. collected email) need explicit adapter support.
  const outside = await page.locator('input:not([type="hidden"]), textarea, [role="radio"], [role="checkbox"], [role="listbox"]').evaluateAll(controls =>
    controls.some(control => !control.closest('[role="listitem"]')?.querySelector('[role="heading"]')));
  if (outside) throw new Error('UNSUPPORTED_QUESTION');
  return { fields, fingerprint: createHash('sha256').update(JSON.stringify(fields)).digest('hex') };
}

// Google role controls update aria-checked asynchronously after a click.
export async function setChoiceChecked(control: Locator, checked: boolean) {
  if (await control.isChecked() !== checked) await control.click({ timeout: 10000 });
  const element = await control.elementHandle();
  try {
    await control.page().waitForFunction(({ element, checked }) => element instanceof HTMLInputElement
      ? element.checked === checked : element?.getAttribute('aria-checked') === String(checked),
    { element, checked }, { timeout: 10000 });
    if (await control.isChecked() !== checked) throw new Error('FILL_VERIFICATION_FAILED');
  } finally { await element?.dispose(); }
}

export async function fillForm(page: Page, fingerprint: string, payload: Payload, fieldDelayMs = 0) {
  const inspection = await inspectForm(page);
  if (inspection.fingerprint !== fingerprint) throw new Error('FORM_SCHEMA_CHANGED');
  validatePayload(inspection.fields, payload);
  let first = true;
  for (const field of inspection.fields) {
    if (!first && fieldDelayMs) await wait(fieldDelayMs);
    first = false;
    const container = page.locator('[role="listitem"]').nth(field.index);
    const value = payload[field.id] ?? (field.type === 'checkbox' ? [] : '');
    try {
      if (field.type === 'text' || field.type === 'paragraph' || field.type === 'date') {
        const textbox = field.type === 'date' ? container.locator('input[type="date"]') : container.getByRole('textbox');
        if (await textbox.count() !== 1) throw new Error('UNSUPPORTED_QUESTION');
        await textbox.fill(value as string);
        if (await textbox.inputValue() !== value) throw new Error('FILL_VERIFICATION_FAILED');
        if (field.type === 'date' && !await textbox.evaluate(element => (element as HTMLInputElement).checkValidity())) throw new Error('ROW_VALIDATION_FAILED');
      } else if (field.type === 'datetime') {
        const temporal = value as string;
        const [date, time] = temporal ? temporal.split('T') : ['', ''];
        const verify = async (selector: string, expected: string, kind: 'date' | 'time' | 'combined' | 'part') => {
          const input = container.locator(selector);
          if (await input.count() !== 1) throw new Error('UNSUPPORTED_QUESTION');
          await input.fill(kind === 'time' || kind === 'combined' ? expected.replace(/:00$/, '') : expected);
          const actual = await input.inputValue();
          const equal = expected === '' ? actual === '' : kind === 'combined' ? normalizeDateTime(actual) === temporal :
            kind === 'time' ? normalizeDateTime(`2000-01-01T${actual}`) === `2000-01-01T${time}` :
            kind === 'part' ? actual !== '' && Number(actual) === Number(expected) : actual === expected;
          if (!equal) throw new Error('FILL_VERIFICATION_FAILED');
          if (!await input.evaluate(element => (element as HTMLInputElement).checkValidity())) throw new Error('ROW_VALIDATION_FAILED');
        };
        if (field.timeLayout === 'combined') await verify('input[type="datetime-local"]', temporal, 'combined');
        else {
          await verify('input[type="date"]', date, 'date');
          if (field.timeLayout === 'time') await verify('input[type="time"]', time, 'time');
          else if (field.timeLayout === 'parts') {
            const [hour, minute, second] = time ? time.split(':') : ['', '', ''];
            await verify(timeParts.hour, hour ? String(Number(hour)) : '', 'part');
            await verify(timeParts.minute, minute ? String(Number(minute)) : '', 'part');
            if (field.timePrecision === 'second') await verify(timeParts.second, second ? String(Number(second)) : '', 'part');
          } else throw new Error('UNSUPPORTED_QUESTION');
        }
      } else if (field.type === 'checkbox') {
        const checkboxes = container.getByRole('checkbox');
        for (let index = 0; index < await checkboxes.count(); index++) {
          const checkbox = checkboxes.nth(index);
          const name = await checkbox.getAttribute('data-value') ?? await checkbox.getAttribute('aria-label') ?? (await checkbox.innerText()).trim();
          const checked = (value as string[]).includes(name);
          await setChoiceChecked(checkbox, checked);
          if (await checkbox.isChecked() !== checked) throw new Error('FILL_VERIFICATION_FAILED');
        }
      } else if (field.type === 'radio') {
        if (!value) {
          if (await container.locator('[role="radio"][aria-checked="true"]').count()) throw new Error('RESTORED_DRAFT_REVIEW');
          continue;
        }
        const radio = container.getByRole('radio', { name: value as string, exact: true });
        await setChoiceChecked(radio, true);
        if (!await radio.isChecked()) throw new Error('FILL_VERIFICATION_FAILED');
      } else if (field.type === 'dropdown') {
        const listbox = container.getByRole('listbox');
        if (!value) {
          const selected = container.locator('[role="option"][aria-selected="true"]');
          if (await selected.evaluateAll((elements, options) => elements.some(element => options.includes(element.getAttribute('data-value') ?? element.textContent?.trim() ?? '')), field.options)) throw new Error('RESTORED_DRAFT_REVIEW');
          continue;
        }
        await selectDropdown(page, field, value as string);
      }
    } catch (error) {
      if (error instanceof FieldValidationError) throw error;
      const reasons: Record<string, string> = {
        RESTORED_DRAFT_REVIEW: 'Form khôi phục lựa chọn cũ; xóa bản nháp trong Chrome rồi tải lại.',
        FILL_VERIFICATION_FAILED: 'Giá trị trên Form chưa khớp với dữ liệu đã chuẩn bị.',
        ROW_VALIDATION_FAILED: 'Form không chấp nhận giá trị đã điền.',
        UNSUPPORTED_QUESTION: 'Cấu trúc trường này chưa được hỗ trợ; tải lại và kiểm tra Form.',
      };
      throw new FieldValidationError(field, `${error instanceof Error && reasons[error.message] ? reasons[error.message] : 'Không hoàn tất thao tác điền hoặc chờ trạng thái lựa chọn cập nhật.'} Đã dừng trước khi gửi dòng này.`);
    }
  }
}

export async function selectDropdown(page: Page, field: FormField, value: string) {
  const container = page.locator('[role="listitem"]').nth(field.index);
  let step = 'mở menu';
  try {
    await container.getByRole('listbox').click({ timeout: 10000 });
    step = 'chờ option hiển thị';
    await page.waitForFunction(({ index, value }) => {
      const container = document.querySelectorAll('[role="listitem"]')[index];
      return [...container.querySelectorAll('[role="option"]')].some(element =>
        (element.getAttribute('data-value') ?? element.textContent?.trim()) === value &&
        element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden');
    }, { index: field.index, value }, { timeout: 10000 });
    const options = container.locator('[role="option"]:visible');
    const matches = await options.evaluateAll((elements, value) => elements.flatMap((element, index) =>
      (element.getAttribute('data-value') ?? element.textContent?.trim()) === value ? [index] : []), value);
    if (matches.length !== 1) throw new Error('AMBIGUOUS_OPTION');
    step = 'chọn option';
    await options.nth(matches[0]).click({ timeout: 10000 });
    step = 'kiểm tra lựa chọn và menu đóng';
    await page.waitForFunction(({ index, value }) => {
      const container = document.querySelectorAll('[role="listitem"]')[index];
      const selected = [...container.querySelectorAll('[role="option"][aria-selected="true"]')];
      return selected.length > 0 && selected.every(element =>
        (element.getAttribute('data-value') ?? element.textContent?.trim()) === value) &&
        container.querySelector('[role="listbox"]')?.getAttribute('aria-expanded') !== 'true';
    }, { index: field.index, value }, { timeout: 10000 });
  } catch {
    throw new FieldValidationError(field, `Không hoàn tất bước ${step} của select. Đã dừng trước khi gửi dòng này; kiểm tra Chrome và tải lại dữ liệu.`);
  }
}

export async function prepareSubmit(page: Page) {
  const buttons = page.getByRole('button');
  const matches = await buttons.evaluateAll(elements => elements.flatMap((element, index) => {
    const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
    return ['submit', 'gửi'].includes(label) ? [index] : [];
  }));
  if (matches.length !== 1) throw new Error('SUBMIT_NOT_CLICKED');
  const button = buttons.nth(matches[0]);
  try { await button.click({ trial: true, timeout: 10000 }); }
  catch { throw new Error('SUBMIT_NOT_CLICKED'); }
  return button;
}

export async function submitForm(page: Page): Promise<Outcome | 'not_sent'> {
  let button;
  try { button = await prepareSubmit(page); }
  catch { return 'not_sent'; }
  try {
    // Once the real click starts, a timeout can no longer prove it was not sent.
    await button.click({ timeout: 10000 });
    const result = await page.waitForFunction(() => {
      const visible = (element: Element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
      const text = (element: Element) => (element.textContent ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
      if ([...document.querySelectorAll('div, span, p')].some(element => visible(element) &&
        ['Your response has been recorded.', 'Câu trả lời của bạn đã được ghi lại.'].includes(text(element)))) return 'submitted';
      if ([...document.querySelectorAll('[role="alert"]')].some(element => visible(element) && /required|invalid|bắt buộc|không hợp lệ/i.test(text(element)))) return 'failed';
      return false;
    }, undefined, { timeout: 15000 });
    return await result.jsonValue() as Outcome;
  } catch { return 'unknown'; }
}
