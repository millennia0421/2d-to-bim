/* 실(방) 인식: 바닥 영역을 벽·문·창·설비(진한 면)로 막고 연결 영역(connected component)으로 분할 */
const Rooms = (() => {
  const MIN_AREA = 0.6; // ㎡ 미만 영역은 실로 보지 않음
  const PALETTE = ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444', '#84cc16', '#0ea5e9', '#f97316'];

  function color(i) { return PALETTE[i % PALETTE.length]; }

  function detect(imgData, p, ppm, prevRooms) {
    const { width: w, height: h, data } = imgData;
    const cell = (p.floor && p.floor.cell) || p.settings.cell;
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const N = gw * gh;

    // 1) 바닥(건물 내부) 셀
    const inside = new Uint8Array(N);
    for (const r of (p.floor && p.floor.rects) || []) {
      for (let y = r.y / cell; y < (r.y + r.h) / cell; y++)
        for (let x = r.x / cell; x < (r.x + r.w) / cell; x++) inside[y * gw + x] = 1;
    }

    // 2) 경계 셀: 벽, 문·창, 평균 밝기가 어두운 셀(설비 샤프트 등 채워진 면)
    const barrier = new Uint8Array(N);
    const mark = r => {
      const x0 = Math.max(0, Math.floor(r.x / cell)), x1 = Math.min(gw, Math.ceil((r.x + r.w) / cell));
      const y0 = Math.max(0, Math.floor(r.y / cell)), y1 = Math.min(gh, Math.ceil((r.y + r.h) / cell));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) barrier[y * gw + x] = 1;
    };
    p.walls.forEach(mark);
    (p.openings || []).forEach(mark);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      if (!inside[i] || barrier[i]) continue;
      let sum = 0, n = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
          const j = (y * w + x) * 4;
          sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]; n++;
        }
      if (sum / n < 150) barrier[i] = 1;
    }

    // 3) 연결 영역 라벨링 (4방향)
    const label = new Int32Array(N).fill(-1);
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (!inside[i] || barrier[i] || label[i] >= 0) continue;
      const id = comps.length, cells = [];
      label[i] = id;
      const stack = [i];
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const x = c % gw;
        for (const nb of [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, c - gw, c + gw]) {
          if (nb < 0 || nb >= N || label[nb] >= 0 || !inside[nb] || barrier[nb]) continue;
          label[nb] = id;
          stack.push(nb);
        }
      }
      comps.push(cells);
    }

    // 4) 라벨 위치: 경계에서 가장 먼 셀 (다중 시작점 BFS 거리)
    const dist = new Int32Array(N).fill(-1);
    const queue = [];
    for (let i = 0; i < N; i++) if (label[i] < 0) { dist[i] = 0; queue.push(i); }
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q], x = c % gw;
      for (const nb of [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, c - gw, c + gw]) {
        if (nb < 0 || nb >= N || dist[nb] >= 0) continue;
        dist[nb] = dist[c] + 1;
        queue.push(nb);
      }
    }

    const minCells = MIN_AREA * ppm * ppm / (cell * cell);
    const rooms = [];
    for (const cells of comps) {
      if (cells.length < minCells) continue;
      let best = cells[0];
      for (const c of cells) if (dist[c] > dist[best]) best = c;
      // 영역을 사각형 목록으로 압축
      const g = new Uint8Array(N);
      for (const c of cells) g[c] = 1;
      const rects = Detect.mergeRects(g, gw, gh).map(r => ({ x: r.x * cell, y: r.y * cell, w: r.w * cell, h: r.h * cell }));
      rooms.push({
        cells: cells.length, cell, rects,
        label: { x: (best % gw + 0.5) * cell, y: (Math.floor(best / gw) + 0.5) * cell },
      });
    }

    // 큰 실부터 번호. 이전에 사용자가 붙인 이름은 라벨 위치가 포함된 새 실로 이어받음
    rooms.sort((a, b) => b.cells - a.cells);
    const contains = (room, pt) => room.rects.some(r => pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h);
    const used = new Set();
    return rooms.map((r, i) => {
      const prev = (prevRooms || []).find(o => o.named && !used.has(o.id) && contains(r, o.label));
      if (prev) used.add(prev.id);
      return {
        id: 'R' + (i + 1),
        name: prev ? prev.name : `실 ${i + 1}`,
        named: !!prev,
        nameSrc: prev ? prev.nameSrc || 'user' : null, // 'ocr' | 'user' | null(자동 번호)
        color: color(i),
        ...r,
      };
    });
  }

  function areaOf(room, ppm) {
    return room.cells * room.cell * room.cell / (ppm * ppm);
  }

  return { detect, areaOf };
})();
