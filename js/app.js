/* 공통 UI 유틸 + 새 프로젝트 생성 + 앱 초기화 */
const UI = (() => {
  function toast(msg, type = 'info') {
    const host = document.getElementById('toast-host');
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 5000 : 2800);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmt(n, digits = 1) {
    if (n == null || !isFinite(n)) return '-';
    return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
      img.src = src;
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function download(fileName, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setTitle(title, actionsHtml = '') {
    document.getElementById('page-title').textContent = title;
    const actions = document.getElementById('page-actions');
    actions.innerHTML = actionsHtml;
    actions.onclick = null;
  }

  return { toast, esc, fmt, fmtTime, loadImage, readFile, download, setTitle };
})();

const App = (() => {
  const MAX_SIDE = 2400;         // 이보다 큰 이미지는 축소 저장
  const MAX_DATAURL = 2_500_000; // 약 1.8MB 초과 시 JPEG로 재압축

  function pickFile() {
    const input = document.getElementById('file-input');
    input.value = '';
    input.click();
  }

  async function newProjectFromFile(file) {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) {
      UI.toast('PNG 또는 JPG 이미지만 올릴 수 있습니다.', 'error');
      return;
    }
    try {
      let dataUrl = await UI.readFile(file);
      let img = await UI.loadImage(dataUrl);
      let w = img.naturalWidth, h = img.naturalHeight;

      if (Math.max(w, h) > MAX_SIDE || dataUrl.length > MAX_DATAURL) {
        const k = Math.min(1, MAX_SIDE / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        dataUrl = c.toDataURL('image/jpeg', 0.9);
      }

      const thumbW = 240, thumbH = Math.round(h * thumbW / w);
      const tc = document.createElement('canvas');
      tc.width = thumbW; tc.height = thumbH;
      const tg = tc.getContext('2d');
      tg.fillStyle = '#fff'; tg.fillRect(0, 0, thumbW, thumbH);
      tg.drawImage(img, 0, 0, thumbW, thumbH);
      const thumb = tc.toDataURL('image/jpeg', 0.75);

      const name = file.name.replace(/\.[^.]+$/, '');
      const p = Store.create({ name, image: { dataUrl, thumb, w, h, fileName: file.name } });
      Router.go('#/project/' + encodeURIComponent(p.id));
    } catch (e) {
      console.error(e);
      UI.toast('이미지를 처리하지 못했습니다: ' + e.message, 'error');
    }
  }

  // 로컬 서버(http)로 실행 중일 때만 동작: raw_data의 샘플 도면으로 시작
  async function newProjectFromSample() {
    try {
      const res = await fetch('raw_data/floorplan2.png');
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      await newProjectFromFile(new File([blob], 'floorplan2.png', { type: 'image/png' }));
    } catch (e) {
      UI.toast('샘플을 불러오지 못했습니다. [새 변환]으로 직접 파일을 선택하세요.', 'error');
    }
  }

  function init() {
    document.getElementById('file-input').addEventListener('change', e => newProjectFromFile(e.target.files[0]));
    Router.start();
  }

  return { pickFile, newProjectFromFile, newProjectFromSample, init };
})();

App.init();
