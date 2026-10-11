// Local disposable fixture used only by the explicit --smoke-test startup path.
export const fixtureUrl = 'https://docs.google.com/forms/d/e/local-fixture/viewform';
export const fixtureHtml = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"></head><body>
<form>
<div role="listitem"><div role="heading">Họ tên *</div><input type="text" required></div>
<div role="listitem"><div role="heading">Ghi chú</div><textarea></textarea></div>
<div role="listitem"><div role="heading">Trạng thái *</div><div role="radiogroup">
<div role="radio" tabindex="0" aria-label="Có" data-value="Có" aria-checked="false" onclick="chooseRadio(this)">Có</div>
<div role="radio" tabindex="0" aria-label="Không" data-value="Không" aria-checked="false" onclick="chooseRadio(this)">Không</div></div></div>
<div role="listitem"><div role="heading">Sở thích</div>
<label><input type="checkbox" role="checkbox" aria-label="Đọc sách" data-value="Đọc sách" checked>Đọc sách</label>
<label><input type="checkbox" role="checkbox" aria-label="Du lịch" data-value="Du lịch">Du lịch</label></div>
<div role="listitem"><div role="heading">Thành phố *</div><div role="listbox" aria-label="Thành phố" tabindex="0">
<div role="option" aria-selected="false" data-value="Hà Nội" onclick="choose(this)">Hà Nội</div>
<div role="option" aria-selected="false" data-value="Hồ Chí Minh" onclick="choose(this)">Hồ Chí Minh</div></div></div>
<div role="listitem"><div role="heading">Ngày phỏng vấn *</div><input type="date" required min="2024-01-01" max="2030-12-31" value="2025-01-01"></div>
<button type="button" onclick="document.body.innerHTML='<p>Your response has been recorded.</p>'">Gửi</button>
</form>
<script>function chooseRadio(option) { setTimeout(() => document.querySelectorAll('[role=radio]').forEach(item => item.setAttribute('aria-checked', String(item === option))), 150); }
function choose(option) { document.querySelectorAll('[role=option]').forEach(item => item.setAttribute('aria-selected', String(item === option))); }</script>
</body></html>`;
