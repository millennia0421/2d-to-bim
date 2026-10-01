/* 내보내기: BIM JSON, IFC4 (STEP 텍스트 직접 생성) */
const Export = (() => {
  const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

  // IFC GlobalId: 22자 압축 GUID (첫 글자는 0~3)
  function guid() {
    let s = GUID_CHARS[Math.floor(Math.random() * 4)];
    for (let i = 1; i < 22; i++) s += GUID_CHARS[Math.floor(Math.random() * 64)];
    return s;
  }

  // STEP 문자열: 비ASCII(한글)는 \X2\XXXX\X0\ 로 인코딩
  function str(s) {
    if (s == null) return '$';
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === "'") out += "''";
      else if (ch === '\\') out += '\\\\';
      else if (c >= 32 && c < 127) out += ch;
      else if (c <= 0xffff) out += '\\X2\\' + c.toString(16).toUpperCase().padStart(4, '0') + '\\X0\\';
      else out += '\\X4\\' + c.toString(16).toUpperCase().padStart(8, '0') + '\\X0\\';
    }
    return `'${out}'`;
  }

  function num(v) {
    const s = String(Math.round(v * 10000) / 10000 + 0);
    return /[.eE]/.test(s) ? s : s + '.';
  }

  function safeName(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';
  }

  function toJson(p) {
    const bim = Bim.build(p);
    return JSON.stringify({
      format: '2d2bim', version: '0.1',
      project: { id: p.id, name: p.name, source: p.image.fileName, createdAt: p.createdAt, updatedAt: p.updatedAt },
      ...bim,
    }, null, 2);
  }

  function toIfc(p) {
    const bim = Bim.build(p);
    const k = Bim.ppm(p);
    const bb = Bim.bboxPx(p.walls);
    const minX = bb.x / k, maxY = (bb.y + bb.h) / k; // 이미지 y(아래로 +) → IFC Y(위로 +)
    const lines = [];
    let n = 0;
    const add = s => { n++; lines.push(`#${n}=${s};`); return `#${n}`; };

    const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
    const zDir = add('IFCDIRECTION((0.,0.,1.))');
    const xDir = add('IFCDIRECTION((1.,0.,0.))');
    const wcs = add(`IFCAXIS2PLACEMENT3D(${origin},${zDir},${xDir})`);
    const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcs},$)`);
    const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
    const units = [
      add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'),
      add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
      add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'),
      add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'),
    ];
    const unitAssign = add(`IFCUNITASSIGNMENT((${units.join(',')}))`);
    const project = add(`IFCPROJECT('${guid()}',$,${str(p.name)},$,$,$,$,(${ctx}),${unitAssign})`);

    const sitePl = add(`IFCLOCALPLACEMENT($,${wcs})`);
    const site = add(`IFCSITE('${guid()}',$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
    const bldgPl = add(`IFCLOCALPLACEMENT(${sitePl},${wcs})`);
    const bldg = add(`IFCBUILDING('${guid()}',$,${str(p.name)},$,$,${bldgPl},$,$,.ELEMENT.,$,$,$)`);
    const storeyPl = add(`IFCLOCALPLACEMENT(${bldgPl},${wcs})`);
    const storey = add(`IFCBUILDINGSTOREY('${guid()}',$,'1F',$,$,${storeyPl},$,$,.ELEMENT.,0.)`);
    add(`IFCRELAGGREGATES('${guid()}',$,$,$,${project},(${site}))`);
    add(`IFCRELAGGREGATES('${guid()}',$,$,$,${site},(${bldg}))`);
    add(`IFCRELAGGREGATES('${guid()}',$,$,$,${bldg},(${storey}))`);

    // 직육면체 솔리드: (x,y,z) 모서리에서 dx×dy 사각형을 dz만큼 위로 압출
    function boxSolid(x, y, z, dx, dy, dz) {
      const pt = add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
      const pos = add(`IFCAXIS2PLACEMENT3D(${pt},$,$)`);
      const c2 = add(`IFCCARTESIANPOINT((${num(dx / 2)},${num(dy / 2)}))`);
      const a2 = add(`IFCAXIS2PLACEMENT2D(${c2},$)`);
      const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${a2},${num(dx)},${num(dy)})`);
      return add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zDir},${num(dz)})`);
    }
    // tail: Tag 이후 속성들 (엔티티별로 다름)
    function element(entity, name, solids, tail) {
      const shape = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solids.join(',')}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      const pl = add(`IFCLOCALPLACEMENT(${storeyPl},${wcs})`);
      return add(`${entity}('${guid()}',$,${str(name)},$,$,${pl},${pds},$,${tail})`);
    }

    const elements = [];
    const H = p.settings.wallHeight;
    for (const r of p.walls) {
      const h = r.height || H;
      const solid = boxSolid(r.x / k - minX, maxY - (r.y + r.h) / k, 0, r.w / k, r.h / k, h);
      elements.push(element('IFCWALL', r.id, [solid], '.STANDARD.'));
    }

    // 문·창: 틈을 채우는 부분 벽(상인방/창대) + 문·창 본체(얇은 판)
    for (const o of p.openings || []) {
      const x = o.x / k - minX, y = maxY - (o.y + o.h) / k, dx = o.w / k, dy = o.h / k;
      const width = o.horiz ? dx : dy;
      const panel = (z0, z1, th) => o.horiz
        ? boxSolid(x, y + dy / 2 - th / 2, z0, dx, th, z1 - z0)
        : boxSolid(x + dx / 2 - th / 2, y, z0, th, dy, z1 - z0);
      const fill = (z0, z1, suffix) => {
        if (z1 - z0 > 0.001) elements.push(element('IFCWALL', `${o.id}-${suffix}`, [boxSolid(x, y, z0, dx, dy, z1 - z0)], '.STANDARD.'));
      };
      if (o.type === 'door') {
        const head = Math.min(Openings.DOOR_HEIGHT, H);
        fill(head, H, 'lintel');
        elements.push(element('IFCDOOR', o.id, [panel(0, head, 0.05)],
          `${num(head)},${num(width)},.DOOR.,.NOTDEFINED.,$`));
      } else {
        const sill = Math.min(Openings.WIN_SILL, H), head = Math.min(Openings.WIN_HEAD, H);
        fill(0, sill, 'sill');
        fill(head, H, 'head');
        elements.push(element('IFCWINDOW', o.id, [panel(sill, head, 0.05)],
          `${num(head - sill)},${num(width)},.WINDOW.,.SINGLE_PANEL.,$`));
      }
    }
    const t = p.settings.slabThickness;
    const slabSolids = bim.slab.rects.map(f => boxSolid(f.x - minX, maxY - (f.y + f.h), -t, f.w, f.h, t));
    if (slabSolids.length) elements.push(element('IFCSLAB', 'Slab-1F', slabSolids, '.FLOOR.'));
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,(${elements.join(',')}),${storey})`);

    // 실: IfcSpace (Name=실 번호, LongName=실 이름) + 순면적 수량
    const spaces = [];
    for (const room of bim.rooms) {
      const solids = room.rects.map(f => boxSolid(f.x - minX, maxY - (f.y + f.h), 0, f.w, f.h, H));
      const shape = add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solids.join(',')}))`);
      const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
      const pl = add(`IFCLOCALPLACEMENT(${storeyPl},${wcs})`);
      const space = add(`IFCSPACE('${guid()}',$,${str(room.id)},$,$,${pl},${pds},${str(room.name)},.ELEMENT.,.INTERNAL.,$)`);
      const area = add(`IFCQUANTITYAREA('NetFloorArea',$,$,${num(room.area)},$)`);
      const qto = add(`IFCELEMENTQUANTITY('${guid()}',$,'Qto_SpaceBaseQuantities',$,$,(${area}))`);
      add(`IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,(${space}),${qto})`);
      spaces.push(space);
    }
    if (spaces.length) add(`IFCRELAGGREGATES('${guid()}',$,$,$,${storey},(${spaces.join(',')}))`);

    const stamp = new Date().toISOString().slice(0, 19);
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
      `FILE_NAME(${str(safeName(p.name) + '.ifc')},'${stamp}',(''),(''),'2D2BIM 0.1','2D2BIM','');`,
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      'DATA;',
      ...lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }

  // kind: 'ifc' | 'json'
  function run(p, kind) {
    if (!p.walls.length) {
      UI.toast('내보낼 벽이 없습니다. 먼저 벽을 인식하세요.', 'error');
      return false;
    }
    const base = safeName(p.name);
    if (kind === 'ifc') UI.download(base + '.ifc', toIfc(p), 'application/x-step');
    else UI.download(base + '.bim.json', toJson(p), 'application/json');

    p.bim = Bim.build(p);
    if (Bim.isCalibrated(p)) {
      Store.setStatus(p, 'exported');
      UI.toast(`${kind.toUpperCase()} 파일을 내려받았습니다.`);
    } else {
      UI.toast('축척 보정 전이라 임시 축척으로 내보냈습니다. 보정 후 다시 내보내세요.', 'error');
    }
    Store.log(p.id, `${kind.toUpperCase()} 내보내기${Bim.isCalibrated(p) ? '' : ' (임시 축척)'}`);
    Store.save(p);
    return true;
  }

  return { run, toIfc, toJson };
})();
