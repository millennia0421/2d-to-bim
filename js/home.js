/* 대시보드 홈(KPI, 프로젝트 목록, 활동 로그) + 설정 화면 */
const Home = (() => {
  function kpis(projects) {
    const done = projects.filter(p => p.status === 'calibrated' || p.status === 'exported');
    const sum = key => done.reduce((s, p) => s + (p.bim && p.bim.stats ? p.bim.stats[key] || 0 : 0), 0);
    return [
      { label: '전체 프로젝트', value: projects.length, unit: '개', digits: 0 },
      { label: '변환 완료(보정 이상)', value: done.length, unit: '개', digits: 0 },
      { label: '누적 벽 길이', value: sum('wallLength'), unit: 'm', digits: 1 },
      { label: '누적 바닥 면적', value: sum('floorArea'), unit: '㎡', digits: 1 },
    ];
  }

  function render(el) {
    UI.setTitle('대시보드',
      `<button class="btn" data-act="sample" title="로컬 서버로 실행할 때 사용">샘플 도면</button>
       <button class="btn primary" data-act="new">+ 새 변환</button>`);
    document.getElementById('page-actions').onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') App.pickFile();
      if (act === 'sample') App.newProjectFromSample();
    };

    const projects = Store.list();
    const names = Object.fromEntries(projects.map(p => [p.id, p.name]));

    el.innerHTML = `
      <div class="kpis">
        ${kpis(projects).map(k => `
          <div class="card kpi">
            <div class="label">${k.label}</div>
            <div class="value">${UI.fmt(k.value, k.digits)}<small>${k.unit}</small></div>
          </div>`).join('')}
      </div>

      <div class="dropzone" id="dropzone">
        <div>
          <b>평면도 이미지를 여기로 끌어다 놓으세요</b>
          <p>PNG/JPG 한 장 → 벽 자동 인식 → 축척 보정 → 3D BIM → IFC/JSON 내보내기</p>
        </div>
        <button class="btn primary" data-act="new">파일 선택</button>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h2>프로젝트</h2><span class="muted">${projects.length}개</span></div>
          ${projects.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr>
                <th></th><th>이름</th><th>상태</th><th>벽 · 문 · 창 · 실</th><th>바닥 면적</th><th>수정일</th><th></th>
              </tr></thead>
              <tbody>
                ${projects.map(p => `
                <tr data-id="${UI.esc(p.id)}">
                  <td><img class="thumb" src="${p.image.thumb}" alt=""></td>
                  <td><a href="#/project/${encodeURIComponent(p.id)}"><b>${UI.esc(p.name)}</b></a></td>
                  <td><span class="pill ${p.status}">${Store.STATUS_LABEL[p.status]}</span></td>
                  <td class="num">${p.walls.length} · ${(p.openings || []).filter(o => o.type === 'door').length} · ${(p.openings || []).filter(o => o.type === 'window').length} · ${(p.rooms || []).length}</td>
                  <td class="num">${p.bim && p.status !== 'uploaded' && p.status !== 'detected'
                      ? UI.fmt(p.bim.stats.floorArea) + '㎡' : '<span class="muted">보정 전</span>'}</td>
                  <td class="num">${UI.fmtTime(p.updatedAt)}</td>
                  <td><div class="row-actions">
                    <a class="btn sm" href="#/project/${encodeURIComponent(p.id)}">열기</a>
                    <button class="btn sm" data-act="ifc" ${p.walls.length ? '' : 'disabled'}>IFC</button>
                    <button class="btn sm" data-act="json" ${p.walls.length ? '' : 'disabled'}>JSON</button>
                    <button class="btn sm danger" data-act="del">삭제</button>
                  </div></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : `<div class="empty">아직 프로젝트가 없습니다. 위에서 평면도 이미지를 올려 시작하세요.</div>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>최근 활동</h2></div>
          ${Store.activity().length ? `
          <ul class="activity">
            ${Store.activity().map(a => `
              <li><time>${UI.fmtTime(a.t)}</time>
                <span>${a.projectId && names[a.projectId] ? `<b>${UI.esc(names[a.projectId])}</b> · ` : ''}${UI.esc(a.msg)}</span></li>`).join('')}
          </ul>` : `<div class="empty">기록이 없습니다.</div>`}
        </div>
      </div>`;

    el.onclick = e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'new') return App.pickFile();
      const id = btn.closest('tr')?.dataset.id;
      const p = id && Store.get(id);
      if (!p) return;
      if (act === 'del') {
        if (confirm(`'${p.name}' 프로젝트를 삭제할까요? 되돌릴 수 없습니다.`)) {
          Store.remove(id);
          render(el);
        }
      } else if (act === 'ifc' || act === 'json') {
        Export.run(p, act);
        render(el);
      }
    };

    const dz = el.querySelector('#dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('over');
      App.newProjectFromFile(e.dataTransfer.files[0]);
    });
  }

  function renderSettings(el) {
    UI.setTitle('설정');
    const kb = Store.usageBytes() / 1024;
    const d = Store.DEFAULT_SETTINGS;
    el.innerHTML = `
      <div class="props">
        <div class="card">
          <div class="card-head"><h3>저장소</h3></div>
          <div class="card-body">
            <div class="field"><div class="row"><span>저장 위치</span><b>이 브라우저 (localStorage)</b></div></div>
            <div class="field"><div class="row"><span>사용량</span><b>${UI.fmt(kb, 0)} KB / 약 5,000 KB</b></div></div>
            <p class="muted">프로젝트는 이 브라우저에만 저장됩니다. 다른 PC나 브라우저와 공유되지 않습니다.</p>
            <button class="btn danger" id="clear-all">모든 프로젝트 삭제</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>기본 인식 설정</h3></div>
          <div class="card-body">
            <div class="field"><div class="row"><span>밝기 임계값</span><b>${d.threshold}</b></div></div>
            <div class="field"><div class="row"><span>얇은 선 제거 반경</span><b>${d.openRadius}px</b></div></div>
            <div class="field"><div class="row"><span>격자 크기</span><b>${d.cell}px</b></div></div>
            <div class="field"><div class="row"><span>기본 층고</span><b>${d.wallHeight}m</b></div></div>
            <p class="muted">프로젝트마다 작업공간에서 따로 조정할 수 있습니다.</p>
          </div>
        </div>
      </div>`;
    el.querySelector('#clear-all').onclick = () => {
      if (confirm('모든 프로젝트와 활동 기록을 삭제할까요? 되돌릴 수 없습니다.')) {
        Store.clearAll();
        UI.toast('모든 데이터를 삭제했습니다.');
        renderSettings(el);
      }
    };
  }

  return { render, renderSettings };
})();
