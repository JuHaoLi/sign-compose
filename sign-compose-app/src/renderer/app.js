'use strict';

/* 应用入口：视图切换、顶栏状态、toast */
(function () {
  const view = document.getElementById('view');
  const tabs = document.getElementById('tabs');
  const currentUserEl = document.getElementById('current-user');
  const switchUserBtn = document.getElementById('switch-user');
  const toastEl = document.getElementById('toast');

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
  }

  async function showUsers() {
    try { await window.api.users.logout(); } catch (_) { /* 忽略 */ }
    tabs.classList.add('hidden');
    currentUserEl.classList.add('hidden');
    switchUserBtn.classList.add('hidden');
    window.UsersView.mount(view, ctx);
  }

  function showTab(name) {
    tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'library') window.LibraryView.mount(view, ctx);
    else window.WorkspaceView.mount(view, ctx);
  }

  const ctx = {
    toast,
    enterApp(profile) {
      tabs.classList.remove('hidden');
      currentUserEl.classList.remove('hidden');
      switchUserBtn.classList.remove('hidden');
      currentUserEl.textContent = `当前用户：${profile.name}`;
      showTab('library');
    },
  };

  tabs.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => showTab(b.dataset.view);
  });
  switchUserBtn.onclick = showUsers;

  // 启动：若已有会话用户直接进 app，否则进用户选择
  window.api.users.current().then(({ profile }) => {
    if (profile) ctx.enterApp(profile);
    else showUsers();
  });
})();
