/* 해시 라우터: #/home, #/project/{id}, #/settings */
const Router = (() => {
  let current = null; // { name, leave }

  function parse() {
    const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
    return { name: parts[0] || 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function setNav(name) {
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  }

  function resolve() {
    const route = parse();
    if (current && current.leave) current.leave();
    current = null;
    // 화면마다 새 요소로 교체해서 이전 화면의 이벤트 리스너가 남지 않게 함
    const old = document.getElementById('view');
    const view = old.cloneNode(false);
    old.replaceWith(view);
    UI.setTitle('');

    if (route.name === 'project') {
      const id = route.id || Store.lastOpened();
      if (!id || !Store.get(id)) {
        if (route.id) UI.toast('프로젝트를 찾을 수 없습니다.', 'error');
        location.hash = '#/home';
        return;
      }
      if (!route.id) { location.hash = '#/project/' + encodeURIComponent(id); return; }
      setNav('project');
      Workspace.open(view, id);
      current = { name: 'project', leave: Workspace.close };
    } else if (route.name === 'settings') {
      setNav('settings');
      Home.renderSettings(view);
      current = { name: 'settings' };
    } else {
      setNav('home');
      Home.render(view);
      current = { name: 'home' };
    }
  }

  function start() {
    window.addEventListener('hashchange', resolve);
    resolve();
  }

  return { start, resolve, go: hash => { location.hash = hash; } };
})();
