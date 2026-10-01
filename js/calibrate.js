/* 축척 보정: 두 점 거리 또는 건물 전체 폭으로 px/m 계산 */
const Calibrate = (() => {
  // 수평/수직에 가까우면(약 6° 이내) 축에 맞춤
  function snap(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dy) < Math.abs(dx) * 0.1) return { x: b.x, y: a.y };
    if (Math.abs(dx) < Math.abs(dy) * 0.1) return { x: a.x, y: b.y };
    return b;
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function fromPoints(a, b, meters) {
    if (!(meters > 0)) throw new Error('실제 길이(m)를 0보다 크게 입력하세요.');
    const d = distance(a, b);
    if (d < 10) throw new Error('두 점 사이가 너무 가깝습니다.');
    return d / meters;
  }

  function fromBuildingWidth(walls, meters) {
    if (!(meters > 0)) throw new Error('전체 폭(m)을 0보다 크게 입력하세요.');
    const bb = Bim.bboxPx(walls);
    if (!bb) throw new Error('먼저 벽을 인식하세요.');
    return bb.w / meters;
  }

  return { snap, distance, fromPoints, fromBuildingWidth };
})();
