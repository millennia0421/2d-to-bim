/* 벽 인식: 이진화 → 모폴로지 열기(얇은 선 제거) → 격자화 → 사각형 병합 */
const Detect = (() => {
  // 어두운 픽셀 = 1
  function binarize(imgData, threshold) {
    const { data, width, height } = imgData;
    const out = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      if (data[j + 3] < 128) continue;
      const lum = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      if (lum < threshold) out[i] = 1;
    }
    return out;
  }

  // 정사각형 커널(2r+1) 침식/팽창. 가로→세로로 분리해 슬라이딩 합으로 계산
  function morph(src, w, h, r, erode) {
    const full = 2 * r + 1;
    const pass = (input, output, len, count, idx) => {
      for (let line = 0; line < count; line++) {
        let sum = 0;
        for (let k = 0; k <= r && k < len; k++) sum += input[idx(line, k)];
        for (let k = 0; k < len; k++) {
          output[idx(line, k)] = erode ? (sum === full ? 1 : 0) : (sum > 0 ? 1 : 0);
          if (k + r + 1 < len) sum += input[idx(line, k + r + 1)];
          if (k - r >= 0) sum -= input[idx(line, k - r)];
        }
      }
    };
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    pass(src, tmp, w, h, (y, x) => y * w + x);
    pass(tmp, out, h, w, (x, y) => y * w + x);
    return out;
  }

  function open(bin, w, h, r) {
    if (r <= 0) return bin;
    return morph(morph(bin, w, h, r, true), w, h, r, false);
  }

  // 셀 내 벽 픽셀이 50% 이상이면 벽 셀
  function toGrid(mask, w, h, cell) {
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const grid = new Uint8Array(gw * gh);
    const need = cell * cell * 0.5;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let n = 0;
        const y1 = Math.min(h, (gy + 1) * cell), x1 = Math.min(w, (gx + 1) * cell);
        for (let y = gy * cell; y < y1; y++) {
          for (let x = gx * cell; x < x1; x++) n += mask[y * w + x];
        }
        if (n >= need) grid[gy * gw + gx] = 1;
      }
    }
    return { grid, gw, gh };
  }

  // Greedy 사각형 병합: 가로로 최대한 늘린 뒤 아래로 확장
  function mergeRects(grid, gw, gh) {
    const used = new Uint8Array(gw * gh);
    const rects = [];
    const free = i => grid[i] && !used[i];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!free(y * gw + x)) continue;
        let w = 1;
        while (x + w < gw && free(y * gw + x + w)) w++;
        let h = 1;
        outer: while (y + h < gh) {
          for (let k = 0; k < w; k++) if (!free((y + h) * gw + x + k)) break outer;
          h++;
        }
        for (let yy = y; yy < y + h; yy++) for (let k = 0; k < w; k++) used[yy * gw + x + k] = 1;
        rects.push({ x, y, w, h });
      }
    }
    return rects;
  }

  function run(imgData, settings) {
    const { width: w, height: h } = imgData;
    const { threshold, openRadius, cell, minCells } = settings;
    const t0 = performance.now();
    const mask = open(binarize(imgData, threshold), w, h, openRadius);
    const { grid, gw, gh } = toGrid(mask, w, h, cell);
    const rects = mergeRects(grid, gw, gh)
      .filter(r => r.w * r.h >= minCells)
      .map((r, i) => ({
        id: 'W' + (i + 1),
        x: r.x * cell,
        y: r.y * cell,
        w: Math.min(w, (r.x + r.w) * cell) - r.x * cell,
        h: Math.min(h, (r.y + r.h) * cell) - r.y * cell,
        src: 'auto',
      }));
    return { mask, rects, ms: Math.round(performance.now() - t0) };
  }

  // 바닥 영역(이미지 기반): 창틀 같은 얇은 선까지 경계로 보고 바깥에서 flood fill →
  // 바깥에 닿지 않은 영역(벽 외곽 범위 안)을 바닥으로 판정
  function floorFromImage(imgData, settings, walls) {
    const { width: w, height: h } = imgData;
    const cell = settings.cell;
    const bb = Bim.bboxPx(walls);
    if (!bb) return { rects: [], cells: 0 };
    const raw = binarize(imgData, 160);
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const barrier = new Uint8Array(gw * gh);
    const wallCell = new Uint8Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (raw[y * w + x]) barrier[((y / cell) | 0) * gw + ((x / cell) | 0)] = 1;
    }
    for (const r of walls) { // 수동으로 추가한 벽도 경계로 반영
      for (let y = Math.floor(r.y / cell); y < Math.ceil((r.y + r.h) / cell); y++)
        for (let x = Math.floor(r.x / cell); x < Math.ceil((r.x + r.w) / cell); x++)
          if (x >= 0 && y >= 0 && x < gw && y < gh) barrier[y * gw + x] = wallCell[y * gw + x] = 1;
    }
    const bx0 = Math.floor(bb.x / cell), by0 = Math.floor(bb.y / cell);
    const bx1 = Math.ceil((bb.x + bb.w) / cell), by1 = Math.ceil((bb.y + bb.h) / cell);
    const outside = new Uint8Array(gw * gh);
    const stack = [];
    const push = i => { if (!outside[i] && !barrier[i]) { outside[i] = 1; stack.push(i); } };
    for (let x = 0; x < gw; x++) { push(x); push((gh - 1) * gw + x); }
    for (let y = 0; y < gh; y++) { push(y * gw); push(y * gw + gw - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % gw, y = (i / gw) | 0;
      if (x > 0) push(i - 1);
      if (x < gw - 1) push(i + 1);
      if (y > 0) push(i - gw);
      if (y < gh - 1) push(i + gw);
    }
    const f = new Uint8Array(gw * gh);
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const i = y * gw + x;
      if (!outside[i]) f[i] = 1;
    }
    // 벽과 닿지 않은 닫힌 영역(도면 밖 라벨 상자 등)은 제외
    let cells = 0;
    const seen = new Uint8Array(gw * gh);
    for (let s = 0; s < f.length; s++) {
      if (!f[s] || seen[s]) continue;
      const comp = [s];
      seen[s] = 1;
      let hasWall = false;
      for (let q = 0; q < comp.length; q++) {
        const i = comp[q], x = i % gw;
        if (wallCell[i]) hasWall = true;
        for (const nb of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, i - gw, i + gw]) {
          if (nb >= 0 && nb < f.length && f[nb] && !seen[nb]) { seen[nb] = 1; comp.push(nb); }
        }
      }
      if (hasWall) cells += comp.length;
      else for (const i of comp) f[i] = 0;
    }
    const rects = mergeRects(f, gw, gh).map(r => ({ x: r.x * cell, y: r.y * cell, w: r.w * cell, h: r.h * cell }));
    return { rects, cells, cell };
  }

  // 바닥 영역(대체용): 벽 셀의 직교 볼록 껍질(행 범위 ∩ 열 범위)
  function floorFromWalls(walls, w, h, cell) {
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const g = new Uint8Array(gw * gh);
    for (const r of walls) {
      const x0 = Math.max(0, Math.floor(r.x / cell)), x1 = Math.min(gw, Math.ceil((r.x + r.w) / cell));
      const y0 = Math.max(0, Math.floor(r.y / cell)), y1 = Math.min(gh, Math.ceil((r.y + r.h) / cell));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * gw + x] = 1;
    }
    const rowMin = new Int32Array(gh).fill(gw), rowMax = new Int32Array(gh).fill(-1);
    const colMin = new Int32Array(gw).fill(gh), colMax = new Int32Array(gw).fill(-1);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (!g[y * gw + x]) continue;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (y < colMin[x]) colMin[x] = y;
      if (y > colMax[x]) colMax[x] = y;
    }
    const f = new Uint8Array(gw * gh);
    let cells = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (x >= rowMin[y] && x <= rowMax[y] && y >= colMin[x] && y <= colMax[x]) { f[y * gw + x] = 1; cells++; }
    }
    const rects = mergeRects(f, gw, gh).map(r => ({ x: r.x * cell, y: r.y * cell, w: r.w * cell, h: r.h * cell }));
    return { rects, cells, cell };
  }

  return { run, floorFromImage, floorFromWalls, mergeRects };
})();
