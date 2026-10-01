/* 프로젝트 작업공간: 단계 진행(스텝퍼), KPI, 2D/3D 뷰, 속성 패널 */
const Workspace = (() => {
  let root = null, p = null, img = null, imgData = null;
  let selectedId = null, calibPts = null, token = 0, lastDetect = '';

  const $ = sel => root.querySelector(sel);
  const ROOM_NAMES = ['거실', '주방/식당', '침실', '안방', '욕실', '현관', '드레스룸', '다용도실', '발코니', '펜트리', '알파공간', '실외기실'];

  function template() {
    const s = p.settings;
    return `
      <div class="ws-head">
        <input class="ws-name" id="ws-name" value="${UI.esc(p.name)}" title="클릭해서 이름 변경">
        <span class="pill ${p.status}" id="ws-status">${Store.STATUS_LABEL[p.status]}</span>
        <div class="stepper" id="stepper"></div>
      </div>

      <div class="kpis compact" id="ws-kpis"></div>

      <div class="viewers">
        <div class="card viewer">
          <div class="card-head"><h3>2D 평면 · 벽(빨강) 문(초록) 창(파랑)</h3><span class="hint">클릭 선택 · Delete 삭제 · Shift+드래그 벽 추가</span></div>
          <div class="viewer-canvas" id="v2d">
            <div class="viewer-banner" id="calib-banner">
              <span id="calib-text">기준 치수의 양 끝점 두 곳을 클릭하세요 (수평/수직 자동 맞춤)</span>
              <button class="btn sm" data-act="calib-cancel">취소</button>
            </div>
          </div>
        </div>
        <div class="card viewer">
          <div class="card-head"><h3>3D BIM 모델</h3><span class="hint">드래그 회전 · 휠 확대 · 우클릭 드래그 이동</span></div>
          <div class="viewer-canvas" id="v3d"></div>
        </div>
      </div>

      <div class="props">
        <div class="card">
          <div class="card-head"><h3>② 벽·문·창 인식</h3></div>
          <div class="card-body">
            ${slider('threshold', '어두운 선 임계값', s.threshold, 20, 200, 1, '')}
            ${slider('openRadius', '얇은 선 제거 반경', s.openRadius, 0, 8, 1, 'px')}
            ${slider('cell', '격자 크기', s.cell, 2, 10, 1, 'px')}
            <button class="btn primary" data-act="detect">벽·문·창 다시 인식</button>
            <button class="btn" data-act="detect-openings">문·창만 다시 인식</button>
            <button class="btn" data-act="ocr" id="ocr-btn">실 이름 자동 인식 (OCR)</button>
            <span class="muted" id="detect-info"></span>
            <span class="muted" id="ocr-info"></span>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>③ 축척 보정</h3><span class="muted" id="scale-badge"></span></div>
          <div class="card-body">
            <div class="field"><div class="row"><span>현재 축척</span><b id="scale-now"></b></div></div>
            <div class="field">
              <span>방법 1 · 건물 전체 폭 입력</span>
              <div class="inline">
                <input type="number" id="width-len" step="0.1" min="0" placeholder="예: 11.6">
                <span class="muted">m</span>
                <button class="btn" data-act="apply-width">적용</button>
              </div>
            </div>
            <div class="divider"></div>
            <div class="field">
              <span>방법 2 · 도면 위 두 점 + 실제 길이</span>
              <button class="btn" data-act="calib">두 점 찍기 시작</button>
              <div class="inline">
                <input type="number" id="calib-len" step="0.1" min="0" placeholder="두 점 사이 실제 길이" disabled>
                <span class="muted">m</span>
                <button class="btn" data-act="apply-calib" id="apply-calib" disabled>적용</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>④ 모델 설정</h3></div>
          <div class="card-body">
            <div class="field">
              <span>기본 층고 (벽 높이)</span>
              <div class="inline"><input type="number" id="wall-height" step="0.1" min="0.5" max="20" value="${s.wallHeight}"><span class="muted">m</span></div>
            </div>
            <label class="check"><input type="checkbox" id="show-texture" ${s.showTexture ? 'checked' : ''}> 3D 바닥에 평면도 이미지 표시</label>
            <label class="check"><input type="checkbox" id="show-rooms" ${s.showRooms !== false ? 'checked' : ''}> 실(방) 색상·이름표 표시</label>
            <label class="check"><input type="checkbox" id="show-mask" ${s.showMask ? 'checked' : ''}> 2D에 인식 마스크 보기</label>
            <button class="btn" data-act="frame">3D 시점 맞춤</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>선택한 객체</h3></div>
          <div class="card-body" id="sel-body"></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>⑤ 내보내기</h3></div>
          <div class="card-body">
            <button class="btn primary" data-act="ifc">IFC4 다운로드 (.ifc)</button>
            <button class="btn" data-act="json">BIM JSON 다운로드</button>
            <p class="muted">IFC는 Revit, ArchiCAD 등 BIM 도구에서 열 수 있는 국제 표준 포맷입니다.</p>
          </div>
        </div>
      </div>`;
  }

  function slider(key, label, value, min, max, step, unit) {
    return `
      <label class="field">
        <div class="row"><span>${label}</span><b id="val-${key}">${value}${unit}</b></div>
        <input type="range" data-setting="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}">
      </label>`;
  }

  async function open(el, id) {
    const my = ++token;
    root = el;
    p = Store.get(id);
    Store.setLastOpened(id);
    selectedId = null; calibPts = null; lastDetect = '';
    UI.setTitle('작업공간', `<a class="btn" href="#/home">← 대시보드</a>`);
    root.innerHTML = template();

    img = await UI.loadImage(p.image.dataUrl);
    if (my !== token) return; // 로딩 중 다른 화면으로 이동함
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    imgData = g.getImageData(0, 0, c.width, c.height);

    View2D.mount($('#v2d'), {
      onSelect: id => { selectedId = id; refresh(); },
      onAddWall: addWall,
      onDelete: deleteWall,
      onCalibPoints: (a, b) => {
        calibPts = { a, b };
        $('#calib-text').textContent = `측정 거리 ${Math.round(Calibrate.distance(a, b))}px · '축척 보정' 카드에 실제 길이(m)를 입력하세요`;
        $('#calib-len').disabled = false;
        $('#apply-calib').disabled = false;
        $('#calib-len').focus();
      },
      onCancelCalib: cancelCalib,
    });
    View2D.setProject(p, img);
    View3D.mount($('#v3d'));
    bind();

    if (!p.walls.length && p.status === 'uploaded') runDetect();
    else {
      if (!p.floor) updateFloor();
      if (!p.openings && p.walls.length) { detectOpenings(); Store.save(p); } // 이전 버전 프로젝트
      if (!p.rooms && p.walls.length) { updateFloor(); updateRooms(); Store.save(p); }
      if (p.settings.showMask) View2D.setMask(Detect.run(imgData, p.settings).mask, imgData.width, imgData.height);
      refresh({ frame: true });
      if (!p.ocrDone) runOcr(); // OCR을 한 번도 안 한 프로젝트
    }
  }

  function close() {
    token++;
    View2D.unmount();
    View3D.unmount();
    root = p = img = imgData = null;
  }

  function bind() {
    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'detect') runDetect(true);
      else if (act === 'detect-openings') {
        if (p.openings && p.openings.some(o => o.src !== 'auto') &&
            !confirm('수정한 문·창이 있습니다. 다시 인식하면 수정 내용이 사라집니다. 계속할까요?')) return;
        const { doors, windows } = detectOpenings();
        updateRooms();
        selectedId = null;
        View2D.setSelected(null);
        refresh({ save: true });
        UI.toast(`문 ${doors}개, 창 ${windows}개, 실 ${p.rooms.length}개를 인식했습니다.`);
      }
      else if (act === 'calib') startCalib();
      else if (act === 'calib-cancel') cancelCalib();
      else if (act === 'apply-calib') applyCalib();
      else if (act === 'apply-width') applyWidth();
      else if (act === 'frame') View3D.frame(p, img);
      else if (act === 'ifc' || act === 'json') { Export.run(p, act); refresh(); }
      else if (act === 'del-wall' && selectedId) deleteWall(selectedId);
      else if (act === 'set-door' || act === 'set-window') setOpeningType(act === 'set-door' ? 'door' : 'window');
      else if (act === 'room-name') renameRoom(e.target.closest('[data-name]').dataset.name);
      else if (act === 'ocr') runOcr();
    });

    $('#stepper').addEventListener('click', e => {
      const step = e.target.closest('[data-step]')?.dataset.step;
      if (step === 'detect') runDetect(true);
      else if (step === 'calib') { startCalib(); $('#width-len').focus(); }
      else if (step === 'frame') View3D.frame(p, img);
      else if (step === 'export') { Export.run(p, 'ifc'); refresh(); }
    });

    root.querySelectorAll('input[data-setting]').forEach(input => {
      input.addEventListener('input', () => {
        $('#val-' + input.dataset.setting).textContent = input.value + input.dataset.unit;
      });
      input.addEventListener('change', () => {
        p.settings[input.dataset.setting] = Number(input.value);
        runDetect(true);
      });
    });

    $('#ws-name').addEventListener('change', e => {
      const name = e.target.value.trim();
      if (!name) { e.target.value = p.name; return; }
      Store.log(p.id, `이름 변경: ${p.name} → ${name}`);
      p.name = name;
      Store.save(p);
    });

    $('#wall-height').addEventListener('change', e => {
      const v = Number(e.target.value);
      if (!(v >= 0.5 && v <= 20)) { e.target.value = p.settings.wallHeight; return; }
      p.settings.wallHeight = v;
      refresh({ save: true });
    });

    $('#show-texture').addEventListener('change', e => {
      p.settings.showTexture = e.target.checked;
      refresh({ save: true });
    });

    $('#show-mask').addEventListener('change', e => {
      p.settings.showMask = e.target.checked;
      if (e.target.checked && !View2D.hasMask()) {
        View2D.setMask(Detect.run(imgData, p.settings).mask, imgData.width, imgData.height);
      }
      refresh({ save: true });
    });

    $('#show-rooms').addEventListener('change', e => {
      p.settings.showRooms = e.target.checked;
      refresh({ save: true });
    });

    $('#calib-len').addEventListener('keydown', e => { if (e.key === 'Enter') applyCalib(); });
    $('#width-len').addEventListener('keydown', e => { if (e.key === 'Enter') applyWidth(); });
  }

  // ===== 단계 동작 =====
  function runDetect(manual) {
    const edited = p.walls.some(w => w.src === 'manual' || w.edited);
    if (manual && edited && !confirm('수동으로 수정한 벽이 있습니다. 다시 인식하면 수정 내용이 사라집니다. 계속할까요?')) return;
    const res = Detect.run(imgData, p.settings);
    p.walls = res.rects;
    updateFloor();
    const { doors, windows } = detectOpenings();
    updateRooms();
    selectedId = null;
    View2D.setSelected(null);
    View2D.setMask(res.mask, imgData.width, imgData.height);
    const summary = `벽 ${res.rects.length}개, 문 ${doors}개, 창 ${windows}개, 실 ${p.rooms.length}개`;
    lastDetect = `${summary} · ${res.ms}ms`;
    Store.setStatus(p, 'detected');
    Store.log(p.id, `${summary} 자동 인식`);
    refresh({ frame: true, save: true });
    UI.toast(`${summary}를 인식했습니다.`);
    runOcr();
  }

  // 문·창 인식 (벽 사이 틈 분석)
  function detectOpenings() {
    const t0 = performance.now();
    p.openings = Openings.detect(imgData, p.walls, Bim.ppm(p));
    const doors = p.openings.filter(o => o.type === 'door').length;
    const windows = p.openings.length - doors;
    lastDetect = `벽 ${p.walls.length}개, 문 ${doors}개, 창 ${windows}개 · 문·창 ${Math.round(performance.now() - t0)}ms`;
    return { doors, windows };
  }

  function setOpeningType(type) {
    const o = (p.openings || []).find(x => x.id === selectedId);
    if (!o || o.type === type) return;
    o.type = type;
    o.src = 'manual';
    if (type === 'door' && !o.door) {
      const L = o.horiz ? o.w : o.h;
      o.door = { hingeAt: 0, leaf: L, swing: 1, along: 1 };
    }
    Store.log(p.id, `${o.id} 종류 변경 → ${type === 'door' ? '문' : '창'}`);
    refresh({ save: true });
  }

  // 바닥 영역은 원본 이미지가 필요하므로 벽이 바뀔 때 계산해서 프로젝트에 저장
  function updateFloor() {
    p.floor = p.walls.length ? Detect.floorFromImage(imgData, p.settings, p.walls) : null;
  }

  // 실 분할: 벽·문·창이 바뀔 때마다 다시 계산 (사용자가 붙인 이름은 유지, OCR 이름은 글자 위치로 재배정)
  function updateRooms() {
    p.rooms = p.floor ? Rooms.detect(imgData, p, Bim.ppm(p), p.rooms) : [];
    if (p.ocrTexts) applyOcrNames();
  }

  // 저장된 OCR 글자(p.ocrTexts)를 현재 실에 배정. 직접 입력한 이름은 건드리지 않음. 반환: OCR 이름이 붙은 실 수
  function applyOcrNames() {
    const names = RoomOCR.assign(p.rooms, p.ocrTexts);
    let n = 0;
    p.rooms.forEach((room, i) => {
      const userNamed = room.nameSrc === 'user' || (room.named && !room.nameSrc); // 이전 버전 데이터 포함
      if (userNamed) return;
      if (names[room.id]) {
        room.name = names[room.id];
        room.named = true;
        room.nameSrc = 'ocr';
        n++;
      } else if (room.nameSrc === 'ocr') { // 글자가 다른 실로 옮겨감 → 자동 번호로 되돌림
        room.name = `실 ${i + 1}`;
        room.named = false;
        room.nameSrc = null;
      }
    });
    return n;
  }

  function renameRoom(name) {
    const room = (p.rooms || []).find(r => r.id === selectedId);
    name = (name || '').trim();
    if (!room || !name || room.name === name) return;
    Store.log(p.id, `실 이름 변경: ${room.name} → ${name}`);
    room.name = name;
    room.named = true;
    room.nameSrc = 'user';
    refresh({ save: true });
  }

  // 실 이름 OCR (백그라운드). 사용자가 직접 붙인 이름은 덮어쓰지 않음
  let ocrRunning = false;
  async function runOcr() {
    if (ocrRunning || !p || !(p.rooms && p.rooms.length)) return;
    ocrRunning = true;
    const my = token, proj = p;
    const info = $('#ocr-info'), btn = $('#ocr-btn');
    btn.disabled = true;
    const show = text => { if (my === token) info.textContent = text; };
    try {
      const texts = await RoomOCR.run(imgData, proj, (msg, prog) => show(`${msg} ${Math.round(prog * 100)}%`));
      if (my !== token) return; // 다른 화면으로 이동함
      // OCR 도중 실이 다시 계산됐어도 글자 위치로 배정하므로 그대로 적용 가능
      proj.ocrTexts = texts;
      proj.ocrDone = true;
      const n = applyOcrNames();
      Store.log(proj.id, `실 이름 OCR: ${n}/${proj.rooms.length}개 인식`);
      show(`실 이름 ${n}/${proj.rooms.length}개를 도면에서 읽었습니다.`);
      refresh({ save: true });
      UI.toast(`실 이름 ${n}개를 자동으로 붙였습니다.`);
    } catch (e) {
      console.error(e);
      show('OCR 실패: ' + e.message);
      UI.toast('실 이름 OCR에 실패했습니다: ' + e.message, 'error');
    } finally {
      ocrRunning = false;
      if (my === token) btn.disabled = false;
    }
  }

  function startCalib() {
    calibPts = null;
    View2D.setMode('calibrate');
    $('#calib-text').textContent = '기준 치수의 양 끝점 두 곳을 클릭하세요 (수평/수직 자동 맞춤)';
    $('#calib-banner').classList.add('show');
    $('#calib-len').disabled = true;
    $('#apply-calib').disabled = true;
  }

  function cancelCalib() {
    calibPts = null;
    View2D.setMode('select');
    $('#calib-banner').classList.remove('show');
    $('#calib-len').disabled = true;
    $('#apply-calib').disabled = true;
  }

  function applyCalib() {
    if (!calibPts) return;
    const len = Number($('#calib-len').value);
    try {
      setScale(Calibrate.fromPoints(calibPts.a, calibPts.b, len), `두 점 ${len}m`);
      $('#calib-len').value = '';
      cancelCalib();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  function applyWidth() {
    const len = Number($('#width-len').value);
    try {
      setScale(Calibrate.fromBuildingWidth(p.walls, len), `전체 폭 ${len}m`);
      if (calibPts || $('#calib-banner').classList.contains('show')) cancelCalib();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }

  function setScale(ppm, how) {
    p.scale = { pxPerMeter: ppm, method: how };
    // 문·창 틈 길이, 실 최소 면적은 m 기준이므로 실제 축척으로 다시 인식 (직접 고친 문·창은 보존)
    if (p.walls.length) {
      if (!(p.openings || []).some(o => o.src !== 'auto')) detectOpenings();
      updateRooms();
    }
    Store.setStatus(p, 'calibrated');
    Store.log(p.id, `축척 보정 (${how}) → ${ppm.toFixed(1)} px/m`);
    refresh({ frame: true, save: true });
    const st = p.bim.stats;
    UI.toast(`축척 보정 완료 · 외곽 ${UI.fmt(st.width, 2)} × ${UI.fmt(st.depth, 2)} m`);
  }

  function addWall(rect) {
    const maxId = p.walls.reduce((m, w) => Math.max(m, parseInt(w.id.slice(1), 10) || 0), 0);
    const wall = { id: 'W' + (maxId + 1), ...rect, src: 'manual' };
    p.walls.push(wall);
    // 새 벽이 덮는 문·창은 제거
    const hitsWall = o => o.x < wall.x + wall.w && o.x + o.w > wall.x && o.y < wall.y + wall.h && o.y + o.h > wall.y;
    if (p.openings) p.openings = p.openings.filter(o => !hitsWall(o));
    updateFloor();
    updateRooms();
    selectedId = wall.id;
    View2D.setSelected(wall.id);
    Store.log(p.id, `벽 추가: ${wall.id}`);
    refresh({ save: true });
  }

  // 벽 또는 문·창 삭제 (Delete 키 / 삭제 버튼 공용)
  function deleteWall(id) {
    if ((p.rooms || []).some(r => r.id === id)) return; // 실은 벽에서 계산되므로 직접 삭제하지 않음
    const isOpening = (p.openings || []).some(o => o.id === id);
    if (isOpening) {
      p.openings = p.openings.filter(o => o.id !== id);
    } else {
      p.walls = p.walls.filter(w => w.id !== id);
      updateFloor();
    }
    updateRooms();
    selectedId = null;
    View2D.setSelected(null);
    Store.log(p.id, `${isOpening ? '문·창' : '벽'} 삭제: ${id}`);
    refresh({ save: true });
  }

  // 선택한 벽의 길이/두께/높이(m) 수정 → 이미지 좌표(px) 사각형에 반영
  function editWall(field, value) {
    const r = p.walls.find(w => w.id === selectedId);
    if (!r || !(value > 0)) return;
    const k = Bim.ppm(p);
    const horiz = r.w >= r.h;
    if (field === 'height') {
      r.height = value;
    } else if (field === 'thickness') {
      const t = value * k;
      if (horiz) { r.y += (r.h - t) / 2; r.h = t; } else { r.x += (r.w - t) / 2; r.w = t; }
    } else if (field === 'length') {
      if (horiz) r.w = value * k; else r.h = value * k;
    }
    r.edited = true;
    if (field !== 'height') { updateFloor(); updateRooms(); }
    refresh({ save: true });
  }

  // ===== 화면 갱신 =====
  function refresh({ frame = false, save = false } = {}) {
    if (!p) return;
    p.bim = Bim.build(p);
    renderStatus();
    renderKpis();
    renderSelection();
    View2D.draw();
    View3D.build(p, img, selectedId);
    if (frame) View3D.frame(p, img);
    if (save) Store.save(p);
  }

  function renderStatus() {
    const pill = $('#ws-status');
    pill.className = 'pill ' + p.status;
    pill.textContent = Store.STATUS_LABEL[p.status];

    const cal = Bim.isCalibrated(p), has = p.walls.length > 0;
    const steps = [
      { label: '업로드', done: true },
      { key: 'detect', label: '벽·문·창 인식', done: has },
      { key: 'calib', label: '축척 보정', done: cal },
      { key: 'frame', label: '3D 확인', done: has && cal },
      { key: 'export', label: '내보내기', done: p.status === 'exported' },
    ];
    const cur = steps.findIndex(s => !s.done);
    $('#stepper').innerHTML = steps.map((s, i) => `
      ${i ? '<span class="step-sep">›</span>' : ''}
      <div class="step ${s.done ? 'done' : ''} ${i === cur ? 'current' : ''}" ${s.key ? `data-step="${s.key}"` : ''}>
        <span class="num">${s.done ? '✓' : i + 1}</span><span>${s.label}</span>
      </div>`).join('');

    $('#scale-now').textContent = `${UI.fmt(Bim.ppm(p), 1)} px/m`;
    $('#scale-badge').innerHTML = cal
      ? `<span class="pill calibrated">보정됨 · ${UI.esc(p.scale.method || '')}</span>`
      : `<span class="pill detected">임시 축척</span>`;
    $('#detect-info').textContent = lastDetect;
  }

  function renderKpis() {
    const st = p.bim.stats;
    const tmp = Bim.isCalibrated(p) ? '' : ' (임시)';
    const items = [
      ['벽 개수', UI.fmt(st.wallCount, 0), '개'],
      ['문 / 창', `${st.doorCount} / ${st.windowCount}`, '개'],
      ['실(방)', UI.fmt(st.roomCount, 0), '개'],
      ['총 벽 길이' + tmp, UI.fmt(st.wallLength, 1), 'm'],
      ['바닥 면적(외곽 기준)' + tmp, UI.fmt(st.floorArea, 1), '㎡'],
      ['외곽 크기' + tmp, `${UI.fmt(st.width, 2)} × ${UI.fmt(st.depth, 2)}`, 'm'],
    ];
    $('#ws-kpis').innerHTML = items.map(([l, v, u]) => `
      <div class="card kpi"><div class="label">${l}</div><div class="value">${v}<small>${u}</small></div></div>`).join('');
  }

  function renderSelection() {
    const body = $('#sel-body');
    const room = p.bim.rooms.find(x => x.id === selectedId);
    if (room) {
      const tmp = Bim.isCalibrated(p) ? '' : ' (임시 축척)';
      const raw = p.rooms.find(x => x.id === room.id);
      const src = raw.nameSrc === 'ocr' ? '도면 OCR' : raw.named ? '직접 입력' : '자동 번호';
      body.innerHTML = `
        <div class="field"><div class="row"><span>ID · 면적${tmp}</span><b>${room.id} · ${UI.fmt(room.area, 1)}㎡</b></div></div>
        <div class="field"><div class="row"><span>이름 출처</span><b>${src}</b></div></div>
        <div class="field"><span>실 이름</span>
          <div class="inline"><input type="text" id="room-name" value="${UI.esc(room.name)}" maxlength="20">
          <button class="btn" id="room-apply">적용</button></div>
        </div>
        <div class="chips">${ROOM_NAMES.map(n =>
          `<button class="btn sm" data-act="room-name" data-name="${n}">${n}</button>`).join('')}</div>`;
      const input = body.querySelector('#room-name');
      body.querySelector('#room-apply').addEventListener('click', () => renameRoom(input.value));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') renameRoom(input.value); });
      return;
    }
    const op = p.bim.openings.find(x => x.id === selectedId);
    if (op) {
      const isDoor = op.type === 'door';
      body.innerHTML = `
        <div class="field"><div class="row"><span>ID · 종류 · 출처</span>
          <b>${op.id} · ${isDoor ? '문' : '창'} · ${op.src === 'manual' ? '수정됨' : '자동'}</b></div></div>
        <div class="inline">
          <button class="btn ${isDoor ? 'primary' : ''}" data-act="set-door">문</button>
          <button class="btn ${isDoor ? '' : 'primary'}" data-act="set-window">창</button>
        </div>
        <div class="field"><div class="row"><span>폭</span><b>${UI.fmt(op.width, 2)} m</b></div></div>
        <div class="field"><div class="row"><span>${isDoor ? '높이' : '창대 높이 · 창 높이'}</span>
          <b>${isDoor ? UI.fmt(op.height, 2) : `${UI.fmt(op.sill, 2)} · ${UI.fmt(op.height, 2)}`} m</b></div></div>
        <button class="btn danger" data-act="del-wall">이 ${isDoor ? '문' : '창'} 삭제</button>`;
      return;
    }
    const w = p.bim.walls.find(x => x.id === selectedId);
    if (!w) {
      body.innerHTML = `<p class="muted">2D 뷰에서 벽이나 문·창을 클릭하면 속성을 바꿀 수 있습니다.<br>Shift+드래그로 새 벽을 그립니다.</p>`;
      return;
    }
    const raw = p.walls.find(x => x.id === selectedId);
    body.innerHTML = `
      <div class="field"><div class="row"><span>ID · 방향 · 출처</span>
        <b>${w.id} · ${w.orientation === 'H' ? '가로' : '세로'} · ${w.src === 'manual' ? '수동' : '자동'}</b></div></div>
      ${numField('length', '길이', w.length)}
      ${numField('thickness', '두께', w.thickness)}
      ${numField('height', '높이', raw.height || p.settings.wallHeight)}
      <button class="btn danger" data-act="del-wall">이 벽 삭제</button>`;
    body.querySelectorAll('input[data-wall]').forEach(input => {
      input.addEventListener('change', () => editWall(input.dataset.wall, Number(input.value)));
    });
  }

  function numField(key, label, value) {
    return `
      <div class="field"><span>${label}</span>
        <div class="inline"><input type="number" data-wall="${key}" step="0.01" min="0.01" value="${Number(value).toFixed(2)}"><span class="muted">m</span></div>
      </div>`;
  }

  return { open, close };
})();
