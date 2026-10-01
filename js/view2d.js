/* 2D 뷰: 원본 이미지 + 벽 오버레이, 선택/삭제/추가, 축척 보정 점 찍기 */
const View2D = (() => {
  let wrap, canvas, ctx, ro, img, project, cb = {};
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  let mode = 'select';      // 'select' | 'calibrate'
  let selectedId = null;
  let drag = null;          // Shift+드래그 벽 추가: { a, b }
  let calib = [];           // 보정 점(이미지 좌표)
  let hover = null;
  let maskCanvas = null;

  function mount(container, callbacks) {
    wrap = container;
    cb = callbacks || {};
    canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    ctx = canvas.getContext('2d');
    ro = new ResizeObserver(() => { fit(); draw(); });
    ro.observe(wrap);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => { hover = null; draw(); });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  }

  function unmount() {
    if (ro) ro.disconnect();
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey);
    if (canvas) canvas.remove();
    canvas = ctx = img = project = maskCanvas = drag = hover = null;
    mode = 'select'; calib = []; selectedId = null;
  }

  function setProject(p, image) {
    project = p;
    img = image;
    fit();
    draw();
  }

  function setMask(mask, w, h) {
    if (!mask) { maskCanvas = null; draw(); return; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const id = g.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const j = i * 4;
      id.data[j] = 37; id.data[j + 1] = 99; id.data[j + 2] = 235; id.data[j + 3] = 200;
    }
    g.putImageData(id, 0, 0);
    maskCanvas = c;
    draw();
  }

  function hasMask() { return !!maskCanvas; }

  function fit() {
    if (!img || !wrap || !canvas) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    scale = Math.min((W - 24) / iw, (H - 24) / ih);
    ox = (W - iw * scale) / 2;
    oy = (H - ih * scale) / 2;
  }

  function toImg(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  }

  // 문·창을 벽보다 먼저 검사(벽 사이 틈에 있으므로)
  function hit(pt) {
    const tol = 4 / scale;
    const inside = r => pt.x >= r.x - tol && pt.x <= r.x + r.w + tol && pt.y >= r.y - tol && pt.y <= r.y + r.h + tol;
    for (const list of [project.openings || [], project.walls]) {
      for (let i = list.length - 1; i >= 0; i--) if (inside(list[i])) return list[i];
    }
    // 실은 가장 마지막(벽·문·창이 아닌 곳을 클릭했을 때)
    for (const room of project.rooms || []) {
      if (room.rects.some(r => pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h)) return room;
    }
    return null;
  }

  function drawRooms() {
    for (const room of project.rooms || []) {
      const sel = room.id === selectedId;
      ctx.globalAlpha = sel ? 0.45 : 0.22;
      ctx.fillStyle = room.color;
      for (const r of room.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
  }

  // 이름표: 실 이름 + 면적 (벽·문·창 위에 그림)
  function drawRoomLabels(lw) {
    const k = Bim.ppm(project);
    for (const room of project.rooms || []) {
      const sel = room.id === selectedId;
      const area = `${Rooms.areaOf(room, k).toFixed(1)}㎡`;
      ctx.font = `bold ${12 * lw}px sans-serif`;
      const tw = Math.max(ctx.measureText(room.name).width, ctx.measureText(area).width) + 10 * lw;
      const th = 30 * lw, x = room.label.x - tw / 2, y = room.label.y - th / 2;
      ctx.fillStyle = sel ? '#1d4ed8' : 'rgba(255,255,255,.92)';
      ctx.strokeStyle = room.color;
      ctx.lineWidth = 1.5 * lw;
      ctx.fillRect(x, y, tw, th);
      ctx.strokeRect(x, y, tw, th);
      ctx.fillStyle = sel ? '#fff' : '#1c2230';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, room.label.x, room.label.y - 7 * lw);
      ctx.font = `${11 * lw}px sans-serif`;
      ctx.fillText(area, room.label.x, room.label.y + 7 * lw);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // 문 원호와 문짝 선(이미지 좌표)
  function doorPath(o) {
    const d = o.door;
    if (!d) return null;
    const pts = [];
    if (o.horiz) {
      const hx = o.x + d.hingeAt, hy = o.y + (d.swing > 0 ? o.h : 0);
      for (let deg = 0; deg <= 90; deg += 6) {
        const th = deg * Math.PI / 180;
        pts.push([hx + d.along * d.leaf * Math.cos(th), hy + d.swing * d.leaf * Math.sin(th)]);
      }
      return { hinge: [hx, hy], pts };
    }
    const hy = o.y + d.hingeAt, hx = o.x + (d.swing > 0 ? o.w : 0);
    for (let deg = 0; deg <= 90; deg += 6) {
      const th = deg * Math.PI / 180;
      pts.push([hx + d.swing * d.leaf * Math.sin(th), hy + d.along * d.leaf * Math.cos(th)]);
    }
    return { hinge: [hx, hy], pts };
  }

  function drawOpenings(lw) {
    for (const o of project.openings || []) {
      const sel = o.id === selectedId;
      const isDoor = o.type === 'door';
      ctx.fillStyle = sel ? 'rgba(37,99,235,.65)' : isDoor ? 'rgba(22,163,74,.55)' : 'rgba(14,165,233,.6)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = sel ? '#1d4ed8' : isDoor ? '#15803d' : '#0369a1';
      ctx.lineWidth = (sel ? 2 : 1.2) * lw;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      const path = isDoor && doorPath(o);
      if (path) {
        ctx.beginPath();
        ctx.moveTo(path.hinge[0], path.hinge[1]);
        ctx.lineTo(path.pts[path.pts.length - 1][0], path.pts[path.pts.length - 1][1]);
        ctx.moveTo(path.pts[0][0], path.pts[0][1]);
        for (const [x, y] of path.pts) ctx.lineTo(x, y);
        ctx.lineWidth = 2 * lw;
        ctx.stroke();
      }
    }
  }

  // 자동 인식된 벽 두께의 중앙값을 새 벽의 기본 두께로 사용
  function defaultThickness() {
    const ts = project.walls.filter(r => r.src === 'auto').map(r => Math.min(r.w, r.h)).sort((a, b) => a - b);    return ts.length ? ts[Math.floor(ts.length / 2)] : Math.round(0.2 * Bim.ppm(project));
  }

  function wallFromDrag(a, b) {
    const t = defaultThickness();
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 6 / scale) return null;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: Math.round(Math.min(a.x, b.x)), y: Math.round(a.y - t / 2), w: Math.round(Math.abs(dx)), h: t };
    }
    return { x: Math.round(a.x - t / 2), y: Math.round(Math.min(a.y, b.y)), w: t, h: Math.round(Math.abs(dy)) };
  }

  function onDown(e) {
    if (e.button !== 0 || !project) return;
    const pt = toImg(e);
    if (mode === 'calibrate') {
      if (calib.length >= 2) calib = [];
      calib.push(calib.length === 1 ? Calibrate.snap(calib[0], pt) : pt);
      if (calib.length === 2 && cb.onCalibPoints) cb.onCalibPoints(calib[0], calib[1]);
      draw();
      return;
    }
    if (e.shiftKey) {
      drag = { a: pt, b: pt };
      return;
    }
    const r = hit(pt);
    selectedId = r ? r.id : null;
    if (cb.onSelect) cb.onSelect(selectedId);
    draw();
  }

  function onMove(e) {
    if (!project) return;
    const pt = toImg(e);
    if (drag) {
      drag.b = pt;
      draw();
    } else if (mode === 'calibrate') {
      hover = pt;
      draw();
    } else {
      canvas.style.cursor = e.shiftKey ? 'crosshair' : hit(pt) ? 'pointer' : 'default';
    }
  }

  function onUp() {
    if (!drag) return;
    const rect = wallFromDrag(drag.a, drag.b);
    drag = null;
    if (rect && cb.onAddWall) cb.onAddWall(rect);
    draw();
  }

  function onKey(e) {
    if (!project || e.target.closest('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      if (cb.onDelete) cb.onDelete(selectedId);
    } else if (e.key === 'Escape') {
      if (mode === 'calibrate' && cb.onCancelCalib) cb.onCancelCalib();
      else if (selectedId) { selectedId = null; if (cb.onSelect) cb.onSelect(null); draw(); }
    }
  }

  function setMode(m) {
    mode = m;
    calib = [];
    hover = null;
    if (canvas) canvas.style.cursor = m === 'calibrate' ? 'crosshair' : 'default';
    draw();
  }

  function setSelected(id) {
    selectedId = id;
    draw();
  }

  function draw() {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img || !project) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, 0, 0);
    const lw = 1 / scale;

    if (project.settings.showMask && maskCanvas) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      const showRooms = project.settings.showRooms !== false;
      if (showRooms) drawRooms();
      for (const r of project.walls) {
        const sel = r.id === selectedId;
        ctx.fillStyle = sel ? 'rgba(37,99,235,.6)' : r.src === 'manual' ? 'rgba(234,88,12,.55)' : 'rgba(220,38,38,.45)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = sel ? '#1d4ed8' : 'rgba(153,27,27,.9)';
        ctx.lineWidth = (sel ? 2 : 1) * lw;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      drawOpenings(lw);
      if (showRooms) drawRoomLabels(lw);
    }

    if (drag) {
      const r = wallFromDrag(drag.a, drag.b);
      if (r) {
        ctx.fillStyle = 'rgba(234,88,12,.45)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([4 * lw, 3 * lw]);
        ctx.strokeStyle = '#c2410c';
        ctx.lineWidth = 1.5 * lw;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
      }
    }

    if (mode === 'calibrate') {
      const pts = calib.slice();
      if (pts.length === 1 && hover) pts.push(Calibrate.snap(pts[0], hover));
      ctx.strokeStyle = '#059669';
      ctx.fillStyle = '#059669';
      ctx.lineWidth = 2 * lw;
      if (pts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        const d = Calibrate.distance(pts[0], pts[1]);
        ctx.font = `bold ${13 * lw}px sans-serif`;
        ctx.fillText(`${Math.round(d)} px`, (pts[0].x + pts[1].x) / 2 + 6 * lw, (pts[0].y + pts[1].y) / 2 - 6 * lw);
      }
      for (const q of pts) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4 * lw, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return { mount, unmount, setProject, setMask, hasMask, setMode, setSelected, draw };
})();
