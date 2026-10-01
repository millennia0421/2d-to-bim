/* 실 이름 OCR: Tesseract.js(한국어)로 도면 글자를 읽어 실에 배정하고 실 이름 사전으로 보정 */
const RoomOCR = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const SCALE = 3;          // 작은 글자를 위해 3배 확대 후 인식
  const MIN_SIM = 0.5;      // 자모 유사도 하한
  const DICT = ['거실', '주방', '식당', '침실', '안방', '욕실', '화장실', '현관', '드레스룸', '다용도실', '발코니',
    '펜트리', '알파공간', '실외기실', '서재', '창고', '복도', '세탁실', '부엌', '파우더룸', '테라스', '대피공간'];
  const SYNONYM = { 팬트리: '펜트리' };

  let workerPromise = null;
  let progressCb = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
      document.head.appendChild(s);
    });
  }

  // 워커는 한 번만 만들고 재사용 (한국어 데이터는 브라우저에 캐시됨)
  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        await loadLib();
        return Tesseract.createWorker('kor', 1, {
          logger: m => { if (progressCb && m.status) progressCb(m.status, m.progress || 0); },
        });
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // ===== 한글 자모 유사도 =====
  function jamo(s) {
    const out = [];
    for (const ch of s) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c < 0 || c > 11171) { out.push(ch); continue; }
      out.push('c' + Math.floor(c / 588), 'v' + Math.floor((c % 588) / 28));
      if (c % 28) out.push('j' + (c % 28));
    }
    return out;
  }

  function similarity(a, b) {
    const x = jamo(a), y = jamo(b);
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
  }

  // OCR 문구 하나 → [{ name, exact }] (사전과 정확히 일치하면 exact, 아니면 자모 유사도로 보정)
  function namesFromPhrase(phrase) {
    let text = phrase.replace(/[^가-힣0-9/]/g, '');
    for (const [from, to] of Object.entries(SYNONYM)) text = text.split(from).join(to);
    const m = text.match(/^([가-힣/]+)([0-9])?/);
    if (!m) return [];
    let hangul = m[1].replace(/\//g, '');
    const digit = m[2] || '';
    const found = [];
    for (const word of DICT.slice().sort((a, b) => b.length - a.length)) {
      if (hangul.includes(word)) { found.push({ name: word, exact: true }); hangul = hangul.replace(word, ''); }
    }
    if (!found.length && hangul.length >= 2) {
      let best = null, bestSim = MIN_SIM;
      for (const word of DICT) {
        const sim = similarity(hangul, word);
        if (sim >= bestSim) { best = word; bestSim = sim; }
      }
      if (best) found.push({ name: best, exact: false });
    }
    if (found.length === 1 && digit) found[0].name += digit;
    return found;
  }

  // 같은 줄(세로 위치가 비슷한) 단어를 왼쪽부터 이어 붙여 문구로 만듦: "침 실 1" → "침실1"
  // 반환: [{ text, x, y }] (x, y = 문구 중심, 이미지 좌표)
  function phrases(words) {
    const rows = [];
    for (const w of words.slice().sort((a, b) => a.cy - b.cy)) {
      let row = null;
      for (const r of rows) {
        const dy = Math.abs(r.cy - w.cy);
        if (dy < Math.min(r.h, w.h) * 0.6 && (!row || dy < Math.abs(row.cy - w.cy))) row = r;
      }
      if (row) row.words.push(w); else rows.push({ cy: w.cy, h: w.h, words: [w] });
    }
    const out = [];
    for (const row of rows) {
      let cur = null;
      for (const w of row.words.sort((a, b) => a.x0 - b.x0)) {
        if (cur && w.x0 - cur.x1 < row.h * 1.5) { cur.text += w.text; cur.x1 = Math.max(cur.x1, w.x1); }
        else { cur = { text: w.text, x0: w.x0, x1: w.x1, y: row.cy }; out.push(cur); }
      }
    }
    return out.map(c => ({ text: c.text, x: (c.x0 + c.x1) / 2, y: c.y }));
  }

  function toWords(data, ox, oy) {
    return data.words
      .filter(w => w.confidence > 40 && /[가-힣0-9]/.test(w.text) && !/[.,]/.test(w.text))
      .map(w => ({
        text: w.text,
        x0: ox + w.bbox.x0 / SCALE, x1: ox + w.bbox.x1 / SCALE,
        cx: ox + (w.bbox.x0 + w.bbox.x1) / 2 / SCALE, cy: oy + (w.bbox.y0 + w.bbox.y1) / 2 / SCALE,
        h: Math.max(4, (w.bbox.y1 - w.bbox.y0) / SCALE),
      }));
  }

  // 회색조 캔버스를 SCALE배 확대 (keep(x,y,lum)이 false인 픽셀은 흰색, binary면 남은 픽셀은 검정)
  function makeCanvas(imgData, x0, y0, w, h, keep, binary = false) {
    const { data, width } = imgData;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = ((y + y0) * width + (x + x0)) * 4, k = (y * w + x) * 4;
      let l = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      if (!keep(x + x0, y + y0, l)) l = 255;
      else if (binary) l = 0;
      id.data[k] = id.data[k + 1] = id.data[k + 2] = l;
      id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const big = document.createElement('canvas');
    big.width = w * SCALE + 40; big.height = h * SCALE + 40;
    const bg = big.getContext('2d');
    bg.fillStyle = '#fff';
    bg.fillRect(0, 0, big.width, big.height);
    bg.drawImage(c, 20, 20, w * SCALE, h * SCALE);
    return big;
  }

  const bboxOf = rects => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  // 점에서 실까지 거리(px). 글자 칸은 실 영역에서 빠져 있으므로 가까운 실로 배정
  function distToRoom(room, x, y) {
    let best = Infinity;
    for (const r of room.rects) {
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  // 도면에서 실 이름 후보를 위치와 함께 읽음. 반환: [{ name, exact, x, y }] (이미지 좌표)
  // 실 배정은 assign()에서 하므로, 실이 다시 계산돼도 OCR을 다시 할 필요 없음
  async function run(imgData, p, onProgress) {
    const rooms = p.rooms || [];
    if (!rooms.length) return [];
    progressCb = (status, prog) => onProgress && onProgress(`OCR 준비 중 (${status})`, prog);
    const worker = await getWorker();
    progressCb = null;

    const W = imgData.width;
    const owner = new Int16Array(W * imgData.height).fill(-1);
    rooms.forEach((room, i) => {
      for (const r of room.rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) owner[y * W + x] = i;
    });
    for (const r of p.walls) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) owner[y * W + x] = -2;

    const wordSets = []; // 인식 1회당 단어 목록 하나 (문구는 같은 인식 결과 안에서만 묶음)

    // 1) 도면 전체(건물 범위) 한 번 읽기
    onProgress && onProgress('도면 전체 글자 읽는 중', 0);
    await worker.setParameters({ tessedit_pageseg_mode: '11' }); // 흩어진 글자(sparse text)
    const bb = Bim.bboxPx(p.walls);
    const fullRes = await worker.recognize(makeCanvas(imgData, bb.x, bb.y, bb.w, bb.h, () => true));
    wordSets.push(toWords(fullRes.data, bb.x - 20 / SCALE, bb.y - 20 / SCALE));

    // 2) 실마다 따로 읽기: 다른 실·벽·바닥 무늬를 지우고 바닥보다 확실히 어두운 글자만 남김
    for (let i = 0; i < rooms.length; i++) {
      onProgress && onProgress(`실별 글자 읽는 중 (${i + 1}/${rooms.length})`, (i + 1) / rooms.length);
      const room = rooms[i], rb = bboxOf(room.rects);
      const hist = new Uint32Array(256);
      for (const r of room.rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const j = (y * W + x) * 4;
        hist[Math.round(0.299 * imgData.data[j] + 0.587 * imgData.data[j + 1] + 0.114 * imgData.data[j + 2])]++;
      }
      let floorLum = 0;
      for (let v = 0; v < 256; v++) if (hist[v] > hist[floorLum]) floorLum = v;
      // 바닥 밝기 기준(무늬 있는 바닥용), 고정 기준(190), 흑백(150) + 블록 모드(그림과 붙은 글자용)
      const variants = [{ cut: Math.min(190, floorLum - 60), binary: false, psm: '11' }];
      if (190 - variants[0].cut > 15) variants.push({ cut: 190, binary: false, psm: '11' });
      variants.push({ cut: 150, binary: true, psm: '11' }, { cut: 150, binary: true, psm: '6' });
      for (const { cut, binary, psm } of variants) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const canvas = makeCanvas(imgData, rb.x, rb.y, rb.w, rb.h, (x, y, l) => {
          const o = owner[y * W + x];
          return (o === -1 || o === i) && l <= cut;
        }, binary);
        const res = await worker.recognize(canvas);
        wordSets.push(toWords(res.data, rb.x - 20 / SCALE, rb.y - 20 / SCALE));
      }
    }

    // 3) 문구 → 실 이름 후보 (위치 포함)
    const r1 = v => Math.round(v * 10) / 10;
    return wordSets.flatMap(phrases).flatMap(ph =>
      namesFromPhrase(ph.text).map(f => ({ name: f.name, exact: f.exact, x: r1(ph.x), y: r1(ph.y) })));
  }

  // 후보를 위치로 가장 가까운 실(8px 이내)에 배정해 실별 이름 결정. 반환: { roomId: '이름' }
  // 규칙: 정확 일치가 있으면 그것만 사용(없으면 가장 많이 나온 보정 이름), 위→아래·왼→오른 순, 중복 제거,
  //       숫자 붙은 쪽 우선(침실 < 침실1), 주방+식당 → 주방/식당, 최대 3개를 '+'로 연결
  function assign(rooms, candidates) {
    const byRoom = new Map();
    for (const c of candidates || []) {
      let best = null, bestD = 8;
      for (const room of rooms) { const d = distToRoom(room, c.x, c.y); if (d < bestD) { bestD = d; best = room; } }
      if (best) { if (!byRoom.has(best.id)) byRoom.set(best.id, []); byRoom.get(best.id).push(c); }
    }
    const result = {};
    for (const [id, found] of byRoom) {
      const exact = found.filter(f => f.exact);
      let picked;
      if (exact.length) picked = exact;
      else {
        const count = {};
        for (const f of found) count[f.name] = (count[f.name] || 0) + 1;
        const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
        picked = [found.find(f => f.name === top)];
      }
      picked = picked.slice().sort((a, b) => Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);
      const names = [];
      for (const n of picked.map(f => f.name)) {
        const base = n.replace(/[0-9]$/, '');
        const dup = names.findIndex(x => x.replace(/[0-9]$/, '') === base);
        if (dup < 0) names.push(n);
        else if (n.length > names[dup].length) names[dup] = n;
      }
      const ki = names.indexOf('주방'), si = names.indexOf('식당');
      if (ki >= 0 && si >= 0) { names[Math.min(ki, si)] = '주방/식당'; names.splice(Math.max(ki, si), 1); }
      if (names.length) result[id] = names.slice(0, 3).join('+');
    }
    return result;
  }

  return { run, assign, similarity, namesFromPhrase };
})();
