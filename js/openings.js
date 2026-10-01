/* 문·창 인식: 같은 선상의 벽 사이 틈을 찾고, 틈 안의 평행선(창) / 1/4 원호(문)로 분류 */
const Openings = (() => {
  const DOOR_HEIGHT = 2.1;   // m
  const WIN_SILL = 0.9;      // 창대 높이(m)
  const WIN_HEAD = 2.1;      // 창 상단 높이(m)
  const MIN_GAP = 0.3, MAX_GAP = 3.2; // 틈 길이 범위(m)

  function lumReader(imgData) {
    const { data, width, height } = imgData;
    return (x, y) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= width || y >= height) return 255;
      const j = (y * width + x) * 4;
      return 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    };
  }

  const isHoriz = r => r.w >= r.h;
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

  // 벽 A의 양 끝에서 길이 방향으로 같은 띠(두께 범위)에 있는 가장 가까운 벽까지의 틈
  function findGaps(walls, ppm) {
    const minL = MIN_GAP * ppm, maxL = MAX_GAP * ppm;
    const gaps = [];
    for (const A of walls) {
      const horiz = isHoriz(A);
      const t = horiz ? A.h : A.w;
      if (t < 3) continue;
      const b0 = horiz ? A.y : A.x, b1 = b0 + t;
      for (const dir of [-1, 1]) {
        const end = horiz ? (dir > 0 ? A.x + A.w : A.x) : (dir > 0 ? A.y + A.h : A.y);
        let bestD = Infinity, best = null;
        for (const B of walls) {
          if (B === A) continue;
          const c0 = horiz ? B.y : B.x, c1 = c0 + (horiz ? B.h : B.w);
          if (overlap(b0, b1, c0, c1) < t * 0.5) continue;
          const s0 = horiz ? B.x : B.y, s1 = s0 + (horiz ? B.w : B.h);
          let d;
          if (dir > 0) { if (s1 <= end + 1) continue; d = Math.max(0, s0 - end); }
          else { if (s0 >= end - 1) continue; d = Math.max(0, end - s1); }
          if (d < bestD) { bestD = d; best = B; }
        }
        if (!best || bestD < minL || bestD > maxL) continue;
        const g0 = dir > 0 ? end : end - bestD;
        gaps.push(horiz
          ? { x: g0, y: b0, w: bestD, h: t, horiz, hosts: [A.id, best.id] }
          : { x: b0, y: g0, w: t, h: bestD, horiz, hosts: [A.id, best.id] });
      }
    }
    // A→B, B→A 중복 제거
    const out = [];
    for (const g of gaps) {
      const dup = out.some(o => {
        if (o.horiz !== g.horiz) return false;
        const along = g.horiz ? overlap(o.x, o.x + o.w, g.x, g.x + g.w) : overlap(o.y, o.y + o.h, g.y, g.y + g.h);
        const across = g.horiz ? overlap(o.y, o.y + o.h, g.y, g.y + g.h) : overlap(o.x, o.x + o.w, g.x, g.x + g.w);
        return along > Math.min(g.horiz ? g.w : g.h, o.horiz ? o.w : o.h) * 0.6 && across > -3;
      });
      if (!dup) out.push(g);
    }
    return out;
  }

  // 틈 안에서 벽과 평행하게 가로지르는 얇은 선의 개수
  function countParallelLines(lum, g) {
    const L = g.horiz ? g.w : g.h, t = g.horiz ? g.h : g.w;
    let lines = 0, inLine = false;
    for (let k = 0; k < t; k++) {
      let dark = 0;
      for (let s = 0; s < L; s++) {
        const v = g.horiz ? lum(g.x + s, g.y + k) : lum(g.x + k, g.y + s);
        if (v < 170) dark++;
      }
      const on = dark > L * 0.7;
      if (on && !inLine) lines++;
      inLine = on;
    }
    return lines;
  }

  // 경첩 (ha, hb)를 중심으로 반지름 R인 1/4 원호가 along 방향으로 그려져 있는 비율
  function arcScore(lum, horiz, ha, hb, along, swing, R) {
    let hits = 0, n = 0;
    for (let deg = 10; deg <= 80; deg += 5) {
      const th = deg * Math.PI / 180;
      n++;
      const at = r => {
        const pa = ha + along * r * Math.cos(th), pb = hb + swing * r * Math.sin(th);
        return horiz ? lum(pa, pb) : lum(pb, pa);
      };
      for (let r = R - 3; r <= R + 3; r += 0.5) {
        const v = at(r);
        if (v > 25 && v < 170 && at(r - 3) > v + 40 && at(r + 3) > v + 40) { hits++; break; }
      }
    }
    return hits / n;
  }

  // 방법 1: 벽면에서 수직으로 뻗은 문짝 선을 찾고, 그 길이를 반지름으로 원호 확인
  // (문틀이 그려져 경첩이 틈 끝이 아닌 경우 대응)
  function findDoorLeaf(lum, g) {
    const L = g.horiz ? g.w : g.h, t = g.horiz ? g.h : g.w;
    const a0 = g.horiz ? g.x : g.y;
    const px = (a, b) => g.horiz ? lum(a, b) : lum(b, a);
    let best = { score: 0 };
    for (const swing of [-1, 1]) {
      const face = (g.horiz ? g.y : g.x) + (swing > 0 ? t : 0);
      for (let a = a0 + 2; a <= a0 + L - 2; a++) {
        // 벽면 부근(±4px)에서 시작하는 연속된 어두운 선의 길이
        let start = null, run = 0;
        for (let k = -4; k <= L * 1.3; k++) {
          const dark = px(a, face + swing * k) < 170;
          if (start === null) { if (dark && k <= 4) start = k; else if (k > 4) break; continue; }
          if (dark) run = k - start; else break;
        }
        if (start === null || run < L * 0.4) continue;
        for (const along of [-1, 1]) {
          const score = arcScore(lum, g.horiz, a, face + swing * start, along, swing, run);
          if (score > best.score) best = { score, hingeAt: a - a0, leaf: run, swing, along };
        }
      }
    }
    return best;
  }

  // 방법 2: 틈 끝(경첩)을 중심으로 반지름≈틈 길이인 1/4 원호가 그려져 있는지 검사
  function findDoorArc(lum, g) {
    const L = g.horiz ? g.w : g.h, t = g.horiz ? g.h : g.w;
    let best = { score: 0 };
    for (const hinge of ['start', 'end']) {
      for (const swing of [-1, 1]) {
        const along = hinge === 'start' ? 1 : -1;
        const a0 = g.horiz ? g.x : g.y;
        const ha = hinge === 'start' ? a0 : a0 + L;              // 길이 방향 경첩 좌표
        const hb = (g.horiz ? g.y : g.x) + (swing > 0 ? t : 0);   // 두께 방향(열리는 쪽 면)
        // 각도마다 가는 선이 지나는 반지름을 모두 수집 → 여러 각도에서 공통인 반지름(원호)을 투표로 찾음
        const perAngle = [];
        for (let deg = 15; deg <= 80; deg += 5) {
          const th = deg * Math.PI / 180;
          const at = r => {
            const pa = ha + along * r * Math.cos(th), pb = hb + swing * r * Math.sin(th);
            return g.horiz ? lum(pa, pb) : lum(pb, pa);
          };
          const hits = [];
          for (let r = L * 0.6; r <= L * 1.12; r += 0.5) {
            const v = at(r);
            if (v >= 170) continue;
            if (v <= 25) break; // 벽(순수 검정)에 막힘
            // 가는 선 = 앞뒤 3px보다 확연히 어두움 (바닥색·설비 박스 같은 면은 제외)
            if (at(r - 3) > v + 40 && at(r + 3) > v + 40) { hits.push(r); r += 2; }
          }
          perAngle.push(hits);
        }
        const tol = Math.max(2, L * 0.04);
        let score = 0;
        for (const R of perAngle.flat()) {
          const votes = perAngle.filter(h => h.some(r => Math.abs(r - R) <= tol)).length;
          score = Math.max(score, votes / perAngle.length);
        }
        if (score > best.score) best = { score, hingeAt: hinge === 'start' ? 0 : L, leaf: L, swing, along };
      }
    }
    return best;
  }

  function detect(imgData, walls, ppm) {
    const lum = lumReader(imgData);
    const result = [];
    for (const g of findGaps(walls, ppm)) {
      const a1 = findDoorLeaf(lum, g), a2 = findDoorArc(lum, g);
      const arc = a1.score >= a2.score ? a1 : a2;
      let type = null;
      if (arc.score >= 0.7) type = 'door';
      else if (countParallelLines(lum, g) >= 2) type = 'window';
      if (!type) continue;
      result.push({
        x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h),
        horiz: g.horiz, type, hosts: g.hosts, src: 'auto',
        // 문: 경첩 위치(틈 시작점 기준 px), 문짝 길이(px), 열리는 쪽(±1, 두께 방향), 원호 방향(±1, 길이 방향)
        door: type === 'door'
          ? { hingeAt: Math.round(arc.hingeAt), leaf: Math.round(arc.leaf), swing: arc.swing, along: arc.along }
          : null,
      });
    }
    return result.map((o, i) => ({ id: 'O' + (i + 1), ...o }));
  }

  return { detect, DOOR_HEIGHT, WIN_SILL, WIN_HEAD };
})();
