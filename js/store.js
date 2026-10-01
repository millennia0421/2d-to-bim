/* 프로젝트 저장소: localStorage 기반 CRUD + 활동 로그 */
const Store = (() => {
  const KEY = 'bim2d.projects.v1';
  const STATUS_LABEL = { uploaded: '업로드됨', detected: '인식완료', calibrated: '보정완료', exported: '내보냄' };
  const STATUS_ORDER = ['uploaded', 'detected', 'calibrated', 'exported'];
  const DEFAULT_SETTINGS = {
    threshold: 70,     // 이진화 밝기 임계값 (0~255)
    openRadius: 3,     // 모폴로지 열기 반경(px): 이보다 얇은 선 제거
    cell: 4,           // 격자 셀 크기(px)
    minCells: 6,       // 최소 사각형 면적(셀 수)
    wallHeight: 2.4,   // 기본 층고(m)
    slabThickness: 0.2,
    showTexture: true,
    showMask: false,
  };

  let db = { projects: [], activity: [], lastOpened: null };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) db = Object.assign({ projects: [], activity: [], lastOpened: null }, JSON.parse(raw));
    } catch (e) {
      console.warn('프로젝트를 불러오지 못했습니다', e);
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.warn('저장 실패', e);
      UI.toast('브라우저 저장 공간이 부족해 저장하지 못했습니다.', 'error');
      return false;
    }
  }

  function list() {
    return db.projects.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function get(id) {
    return db.projects.find(p => p.id === id) || null;
  }

  function create({ name, image }) {
    const now = new Date().toISOString();
    const p = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      status: 'uploaded',
      createdAt: now,
      updatedAt: now,
      image,                     // { dataUrl, thumb, w, h, fileName }
      settings: { ...DEFAULT_SETTINGS },
      scale: { pxPerMeter: null }, // null = 아직 보정 전(임시 축척 사용)
      walls: [],                 // 이미지 좌표(px) 사각형: { id, x, y, w, h, src, height? }
      bim: null,                 // 마지막으로 계산한 BIM 모델(m 단위)
    };
    db.projects.push(p);
    log(p.id, `프로젝트 생성 (${image.fileName || name})`);
    persist();
    return p;
  }

  function save(p) {
    p.updatedAt = new Date().toISOString();
    return persist();
  }

  function setStatus(p, status) {
    if (STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(p.status)) p.status = status;
  }

  function remove(id) {
    const p = get(id);
    db.projects = db.projects.filter(x => x.id !== id);
    if (db.lastOpened === id) db.lastOpened = null;
    if (p) log(null, `프로젝트 삭제: ${p.name}`);
    persist();
  }

  function log(projectId, msg) {
    db.activity.unshift({ t: new Date().toISOString(), projectId, msg });
    db.activity = db.activity.slice(0, 200);
  }

  function activity(n = 12) {
    return db.activity.slice(0, n);
  }

  function setLastOpened(id) { db.lastOpened = id; persist(); }
  function lastOpened() { return db.lastOpened; }

  function clearAll() {
    db = { projects: [], activity: [], lastOpened: null };
    persist();
  }

  function usageBytes() {
    try { return (localStorage.getItem(KEY) || '').length * 2; } catch (e) { return 0; }
  }

  load();

  return {
    STATUS_LABEL, STATUS_ORDER, DEFAULT_SETTINGS,
    list, get, create, save, setStatus, remove, log, activity,
    setLastOpened, lastOpened, clearAll, usageBytes,
  };
})();
