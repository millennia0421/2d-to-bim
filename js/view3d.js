/* 3D 뷰: Three.js로 벽 압출 + 바닥 슬래브 + 평면도 텍스처 */
const View3D = (() => {
  let wrap, renderer, scene, camera, controls, group, grid, ro;
  let texture = null, texSrc = null;

  function message(text) {
    wrap.innerHTML = `<div class="viewer-msg">${UI.esc(text)}</div>`;
  }

  function mount(container) {
    wrap = container;
    if (!window.THREE || !THREE.OrbitControls) {
      message('3D 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
      return;
    }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      renderer = null;
      message('이 브라우저에서는 WebGL(3D)을 사용할 수 없습니다.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    wrap.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#eef0f3';
    scene.background = new THREE.Color(bg);

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    camera.position.set(8, 12, 14);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.addEventListener('change', render);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a92a3, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(6, 14, 9);
    scene.add(sun);

    grid = new THREE.GridHelper(40, 40, 0x9aa3b2, 0xc6ccd6);
    scene.add(grid);
    group = new THREE.Group();
    scene.add(group);

    ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
  }

  function resize() {
    if (!renderer) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }

  function render() {
    if (renderer) renderer.render(scene, camera);
  }

  function clearGroup() {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map && o.material.map !== texture) o.material.map.dispose(); // 실 이름표 텍스처
        o.material.dispose();
      }
    });
    group.clear();
  }

  // 이미지 좌표 기준 원점을 건물 중심으로 옮겨서 배치
  function center(p, img) {
    const k = Bim.ppm(p);
    const bb = Bim.bboxPx(p.walls) || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    return { k, cx: (bb.x + bb.w / 2) / k, cz: (bb.y + bb.h / 2) / k, bw: bb.w / k, bd: bb.h / k };
  }

  function build(p, img, selectedId) {
    if (!renderer) return;
    clearGroup();
    const { k, cx, cz } = center(p, img);
    const s = p.settings, t = s.slabThickness;

    // 바닥 슬래브
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xd8d3ca, roughness: 0.95 });
    for (const f of (p.bim ? p.bim.slab.rects : [])) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(f.w, t, f.h), slabMat);
      m.position.set(f.x + f.w / 2 - cx, -t / 2, f.y + f.h / 2 - cz);
      group.add(m);
    }

    // 평면도 텍스처(참고용 바닥 이미지)
    if (s.showTexture) {
      if (texSrc !== img.src) {
        if (texture) texture.dispose();
        texture = new THREE.Texture(img);
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        texSrc = img.src;
      }
      const iw = img.naturalWidth / k, ih = img.naturalHeight / k;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(iw, ih),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(iw / 2 - cx, 0.004, ih / 2 - cz);
      group.add(plane);
    }

    // 벽
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.85 });
    const manualMat = new THREE.MeshStandardMaterial({ color: 0xf6c9a8, roughness: 0.85 });
    const selMat = new THREE.MeshStandardMaterial({ color: 0x5b8cff, roughness: 0.6 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x4b5263 });
    for (const r of p.walls) {
      const h = r.height || s.wallHeight;
      const geo = new THREE.BoxGeometry(r.w / k, h, r.h / k);
      const mat = r.id === selectedId ? selMat : r.src === 'manual' ? manualMat : wallMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((r.x + r.w / 2) / k - cx, h / 2, (r.y + r.h / 2) / k - cz);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      edges.position.copy(mesh.position);
      group.add(mesh, edges);
    }

    buildOpenings(p, k, cx, cz, selectedId, { wallMat, selMat, edgeMat });
    if (p.settings.showRooms !== false) buildRooms(p, k, cx, cz, selectedId);

    grid.position.y = -t - 0.002;
    render();
  }

  // 실: 바닥 색 + 이름표(스프라이트, 항상 보이도록 깊이 테스트 끔)
  function buildRooms(p, k, cx, cz, selectedId) {
    for (const room of p.rooms || []) {
      const sel = room.id === selectedId;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(room.color), transparent: true, opacity: sel ? 0.6 : 0.3, depthWrite: false,
      });
      for (const r of room.rects) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w / k, r.h / k), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set((r.x + r.w / 2) / k - cx, 0.008, (r.y + r.h / 2) / k - cz);
        group.add(m);
      }

      const c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = sel ? '#1d4ed8' : 'rgba(255,255,255,.93)';
      g.fillRect(0, 0, 256, 96);
      g.strokeStyle = room.color;
      g.lineWidth = 8;
      g.strokeRect(4, 4, 248, 88);
      g.fillStyle = sel ? '#fff' : '#1c2230';
      g.textAlign = 'center';
      g.font = 'bold 36px sans-serif';
      g.fillText(room.name, 128, 46);
      g.font = '28px sans-serif';
      g.fillText(`${Rooms.areaOf(room, k).toFixed(1)}㎡`, 128, 80);
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      sprite.scale.set(1.2, 0.45, 1);
      sprite.position.set(room.label.x / k - cx, 0.4, room.label.y / k - cz);
      sprite.renderOrder = 10;
      group.add(sprite);
    }
  }

  // 문: 문 위 벽(상인방) + 열린 문짝 / 창: 창대 아래 벽 + 창 위 벽 + 유리
  function buildOpenings(p, k, cx, cz, selectedId, { wallMat, selMat, edgeMat }) {
    const H = p.settings.wallHeight;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xb98552, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x8cc8ef, roughness: 0.1, transparent: true, opacity: 0.45 });

    for (const o of p.openings || []) {
      const sel = o.id === selectedId;
      const L = (o.horiz ? o.w : o.h) / k, T = (o.horiz ? o.h : o.w) / k;
      const mx = (o.x + o.w / 2) / k - cx, mz = (o.y + o.h / 2) / k - cz;
      // 틈 중심에 길이 L, 두께 thick, 높이 y0~y1인 상자
      const slab = (y0, y1, mat, thick = T, edges = true) => {
        if (y1 - y0 <= 0.001) return;
        const geo = new THREE.BoxGeometry(o.horiz ? L : thick, y1 - y0, o.horiz ? thick : L);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(mx, (y0 + y1) / 2, mz);
        group.add(mesh);
        if (edges) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
          e.position.copy(mesh.position);
          group.add(e);
        }
      };

      if (o.type === 'door') {
        const head = Math.min(Openings.DOOR_HEIGHT, H);
        slab(head, H, wallMat);
        const d = o.door;
        const mat = sel ? selMat : doorMat;
        if (d) {
          // 도면의 원호처럼 90° 열린 문짝: 경첩에서 열리는 쪽으로 수직
          const leaf = d.leaf / k, th = 0.04;
          const hingeA = ((o.horiz ? o.x : o.y) + d.hingeAt) / k;
          const face = ((o.horiz ? o.y : o.x) + (d.swing > 0 ? (o.horiz ? o.h : o.w) : 0)) / k;
          const geo = new THREE.BoxGeometry(o.horiz ? th : leaf, head, o.horiz ? leaf : th);
          const mesh = new THREE.Mesh(geo, mat);
          const along = hingeA + d.along * th / 2, across = face + d.swing * leaf / 2;
          if (o.horiz) mesh.position.set(along - cx, head / 2, across - cz);
          else mesh.position.set(across - cx, head / 2, along - cz);
          group.add(mesh);
        } else {
          slab(0, head, mat, 0.05);
        }
      } else {
        const sill = Math.min(Openings.WIN_SILL, H), head = Math.min(Openings.WIN_HEAD, H);
        slab(0, sill, wallMat);
        slab(head, H, wallMat);
        slab(sill, head, sel ? selMat : glassMat, 0.03, false);
      }
    }
  }

  // 건물 전체가 보이도록 카메라 맞춤
  function frame(p, img) {
    if (!renderer) return;
    const { bw, bd } = center(p, img);
    const d = Math.max(bw, bd, 4) * 1.15;
    controls.target.set(0, p.settings.wallHeight / 3, 0);
    camera.position.set(d * 0.55, d * 0.9, d * 0.85);
    controls.update();
    render();
  }

  function unmount() {
    if (ro) ro.disconnect();
    if (renderer) {
      clearGroup();
      if (texture) texture.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
    renderer = scene = camera = controls = group = grid = ro = texture = texSrc = null;
  }

  return { mount, unmount, build, frame };
})();
