/* 이미지 좌표(px) 벽 사각형 → BIM 모델(m 단위) 변환 */
const Bim = (() => {
  const r3 = v => Math.round(v * 1000) / 1000;

  // 보정 전에는 "이미지 폭 = 12m"로 가정한 임시 축척을 사용
  function ppm(p) {
    return p.scale && p.scale.pxPerMeter ? p.scale.pxPerMeter : p.image.w / 12;
  }

  function isCalibrated(p) {
    return !!(p.scale && p.scale.pxPerMeter);
  }

  function bboxPx(walls) {
    if (!walls.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of walls) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function build(p) {
    const k = ppm(p), s = p.settings;
    const walls = p.walls.map(r => {
      const horiz = r.w >= r.h;
      return {
        id: r.id, level: 'L1',
        x: r3(r.x / k), y: r3(r.y / k),
        length: r3((horiz ? r.w : r.h) / k),
        thickness: r3((horiz ? r.h : r.w) / k),
        orientation: horiz ? 'H' : 'V',
        height: r3(r.height || s.wallHeight),
        src: r.src || 'auto',
      };
    });
    const H = s.wallHeight;
    const openings = (p.openings || []).map(o => {
      const isDoor = o.type === 'door';
      const sill = isDoor ? 0 : Math.min(Openings.WIN_SILL, H);
      const head = Math.min(isDoor ? Openings.DOOR_HEIGHT : Openings.WIN_HEAD, H);
      return {
        id: o.id, type: o.type, level: 'L1',
        x: r3(o.x / k), y: r3(o.y / k),
        width: r3((o.horiz ? o.w : o.h) / k),
        thickness: r3((o.horiz ? o.h : o.w) / k),
        orientation: o.horiz ? 'H' : 'V',
        sill: r3(sill), height: r3(head - sill),
        hostWalls: o.hosts || [],
        src: o.src || 'auto',
      };
    });
    const rooms = (p.rooms || []).map(r => ({
      id: r.id, name: r.name, level: 'L1',
      area: r3(Rooms.areaOf(r, k)),
      label: { x: r3(r.label.x / k), y: r3(r.label.y / k) },
      rects: r.rects.map(f => ({ x: r3(f.x / k), y: r3(f.y / k), w: r3(f.w / k), h: r3(f.h / k) })),
    }));
    // 인식 시 이미지로 계산해 둔 바닥(p.floor)을 우선 사용
    const floor = p.floor && p.walls.length ? p.floor : Detect.floorFromWalls(p.walls, p.image.w, p.image.h, s.cell);
    const bb = bboxPx(p.walls);
    return {
      unit: 'm',
      scale: { pxPerMeter: r3(k), calibrated: isCalibrated(p) },
      levels: [{ id: 'L1', name: '1F', elevation: 0, height: s.wallHeight }],
      walls,
      openings,
      rooms,
      slab: {
        thickness: s.slabThickness,
        rects: floor.rects.map(f => ({ x: r3(f.x / k), y: r3(f.y / k), w: r3(f.w / k), h: r3(f.h / k) })),
      },
      stats: {
        wallCount: walls.length,
        doorCount: openings.filter(o => o.type === 'door').length,
        windowCount: openings.filter(o => o.type === 'window').length,
        roomCount: rooms.length,
        wallLength: r3(walls.reduce((sum, w) => sum + w.length, 0)),
        floorArea: r3(floor.cells * (floor.cell || s.cell) ** 2 / (k * k)),
        width: bb ? r3(bb.w / k) : 0,
        depth: bb ? r3(bb.h / k) : 0,
      },
    };
  }

  return { ppm, isCalibrated, bboxPx, build };
})();
