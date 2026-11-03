// Handwritten outputs for UX comparison; admission results come from the Python experiment.
async function start() {
  const cases = await (await fetch('./caption-context-cases.json?v=2')).json();
  const select = document.querySelector('#scenario');
  let context = false;
  for (const item of cases) { const option = document.createElement('option'); option.textContent = item.title; select.append(option); }
  function render() {
    const item = cases[select.selectedIndex];
    document.querySelector('#scene').textContent = item.scene;
    document.querySelector('#result').textContent = context ? item.after : item.before;
    document.querySelector('#explanation').textContent = context ? item.explanation : '주변 사진의 지역 단서 없이 이번 사진에 보이는 내용만 적는 예시입니다.';
    for (const button of document.querySelectorAll('[data-context]')) button.setAttribute('aria-pressed', String((button.dataset.context === 'true') === context));
  }
  select.addEventListener('change', render);
  for (const button of document.querySelectorAll('[data-context]')) button.addEventListener('click', () => { context = button.dataset.context === 'true'; render(); });
  render();
}
start().catch(() => { document.querySelector('#explanation').textContent = '예시를 불러오지 못했습니다. 목업 서버 주소에서 다시 열어주세요.'; });
