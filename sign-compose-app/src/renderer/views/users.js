'use strict';

/* 登录视图：账号 + 密码；可切换到注册新账号 */
window.UsersView = {
  mode: 'login', // login | register

  async mount(container, ctx) {
    this.ctx = ctx;
    this.mode = 'login';
    this.render(container);
  },

  render(container) {
    const isLogin = this.mode === 'login';
    container.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h2>${isLogin ? '登录' : '注册新账号'}</h2>
          <label class="auth-field">
            <span>账号</span>
            <input type="text" id="auth-account" placeholder="账号" autocomplete="off" />
          </label>
          ${isLogin ? '' : `
          <label class="auth-field">
            <span>昵称</span>
            <input type="text" id="auth-name" placeholder="显示名称（可留空，默认用账号）" autocomplete="off" />
          </label>`}
          <label class="auth-field">
            <span>密码</span>
            <input type="password" id="auth-password" placeholder="${isLogin ? '密码' : '至少 8 个字符'}" ${isLogin ? '' : 'minlength="8"'} maxlength="128" />
          </label>
          ${isLogin ? '' : `
          <label class="auth-field">
            <span>确认密码</span>
            <input type="password" id="auth-password2" placeholder="再次输入密码" minlength="8" maxlength="128" />
          </label>`}
          <button class="primary auth-submit" id="auth-submit">${isLogin ? '登录' : '注册并进入'}</button>
          <p class="auth-switch">
            ${isLogin
              ? '还没有账号？<a href="#" id="to-register">注册新账号</a>'
              : '已有账号？<a href="#" id="to-login">返回登录</a>'}
          </p>
        </div>
      </div>`;

    const submit = () => (isLogin ? this.doLogin(container) : this.doRegister(container));
    container.querySelector('#auth-submit').onclick = submit;
    container.querySelectorAll('input').forEach((inp) => {
      inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    });
    const toReg = container.querySelector('#to-register');
    if (toReg) toReg.onclick = (e) => { e.preventDefault(); this.mode = 'register'; this.render(container); };
    const toLogin = container.querySelector('#to-login');
    if (toLogin) toLogin.onclick = (e) => { e.preventDefault(); this.mode = 'login'; this.render(container); };

    const first = container.querySelector('#auth-account');
    if (first) first.focus();
  },

  async doLogin(container) {
    const account = container.querySelector('#auth-account').value.trim();
    const password = container.querySelector('#auth-password').value;
    if (!account || !password) return this.ctx.toast('请输入账号和密码');
    try {
      const { profile, stats } = await window.api.users.login({ account, password });
      this.ctx.enterApp(profile, stats);
    } catch (err) {
      this.ctx.toast(err.message || '登录失败');
    }
  },

  async doRegister(container) {
    const account = container.querySelector('#auth-account').value.trim();
    const name = container.querySelector('#auth-name').value.trim();
    const password = container.querySelector('#auth-password').value;
    const password2 = container.querySelector('#auth-password2').value;
    if (!account || !password) return this.ctx.toast('请输入账号和密码');
    if (password !== password2) return this.ctx.toast('两次输入的密码不一致');
    if (password.length < 8) return this.ctx.toast('密码至少需要 8 个字符');
    try {
      const { profile, stats } = await window.api.users.register({ account, name, password });
      this.ctx.enterApp(profile, stats);
    } catch (err) {
      this.ctx.toast(err.message || '注册失败');
    }
  },
};
