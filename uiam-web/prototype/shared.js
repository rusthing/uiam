/* ============================================================
   uiam 原型 · 公共脚本
   应用注册表 / 窗口内容 / 窗口管理
   各方案通过 window.SHELL 控制标题栏样式
   ============================================================ */

/* 图标：24x24 线性符号，白色描边，靠 CSS 缩放到各场景 */
var ICONS = {
  users:
    '<circle cx="12" cy="8.2" r="3.5"/>' +
    '<path d="M5.2 19.8c0-3.4 3-5.9 6.8-5.9s6.8 2.5 6.8 5.9"/>',
  roles:
    '<path d="M12 3.2l7 2.7v5.9c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V5.9l7-2.7z"/>' +
    '<path d="M9 12.1l2.2 2.2 4-4.2"/>',
  clients:
    '<rect x="3.6" y="3.6" width="7" height="7" rx="2"/>' +
    '<rect x="13.4" y="3.6" width="7" height="7" rx="2"/>' +
    '<rect x="3.6" y="13.4" width="7" height="7" rx="2"/>' +
    '<rect x="13.4" y="13.4" width="7" height="7" rx="2"/>',
  sso:
    '<circle cx="8.6" cy="15.4" r="3.6"/>' +
    '<path d="M11.2 12.8L20 4M16.6 4H20v3.4"/>',
  sessions:
    '<rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2.2"/>' +
    '<path d="M8.5 20.6h7M12 16.8v3.8"/>' +
    '<path d="M6.8 10.6h2.1l1.4-2.9 2 4.7 1.4-1.9h3.5"/>',
  audit:
    '<path d="M6.4 3.4h7.6l4.2 4.2v13H6.4z"/>' +
    '<path d="M14 3.4v4.2h4.2"/>' +
    '<path d="M9.4 12h6.2M9.4 15.4h6.2M9.4 8.6h2.2"/>',
  gateway:
    '<circle cx="12" cy="4.6" r="2.1"/>' +
    '<circle cx="4.6" cy="18" r="2.1"/>' +
    '<circle cx="19.4" cy="18" r="2.1"/>' +
    '<path d="M12 6.7v4.4M12 11.1l-5.9 4.9M12 11.1l5.9 4.9"/>',
  settings:
    '<circle cx="12" cy="12" r="3.1"/>' +
    '<path d="M12 2.6v2.7M12 18.7v2.7M21.4 12h-2.7M5.3 12H2.6M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3L5.4 5.4"/>'
};

var APPS = [
  { id:'users',    name:'用户中心', icon:ICONS.users,    c1:'#4facfe', c2:'#0a6ed1', w:900, h:580 },
  { id:'roles',    name:'角色权限', icon:ICONS.roles,    c1:'#a06bf5', c2:'#6b32c9', w:840, h:580 },
  { id:'clients',  name:'应用接入', icon:ICONS.clients,  c1:'#2ad1d6', c2:'#0a8a99', w:880, h:560 },
  { id:'sso',      name:'单点登录', icon:ICONS.sso,      c1:'#4cd964', c2:'#1a8f3c', w:780, h:620 },
  { id:'sessions', name:'在线会话', icon:ICONS.sessions, c1:'#ffb340', c2:'#d97500', w:900, h:540 },
  { id:'audit',    name:'审计日志', icon:ICONS.audit,    c1:'#ff6b6b', c2:'#c9202a', w:940, h:560 },
  { id:'gateway',  name:'网关配置', icon:ICONS.gateway,  c1:'#6f8cf7', c2:'#2f4bc0', w:960, h:600 },
  { id:'settings', name:'系统设置', icon:ICONS.settings, c1:'#9aa0a6', c2:'#4a4f55', w:740, h:580 }
];
var APP_MAP = {};
APPS.forEach(function (a) { APP_MAP[a.id] = a; });

function tileStyle(a) { return '--c1:' + a.c1 + ';--c2:' + a.c2 + ';'; }
function tile(a, extra) {
  var inner = a.icon
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + a.icon + '</svg>'
    : (a.glyph || '');
  return '<div class="tile" style="' + tileStyle(a) + (extra || '') + '">' + inner + '</div>';
}

/* ============================================================
   窗口管理
   ============================================================ */
var zTop = 100, openWins = {}, cascade = 0, focusId = null;

function miniTile(app) {
  var inner = app.icon
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + app.icon + '</svg>'
    : (app.glyph || '');
  return '<span class="mini" style="background:linear-gradient(180deg,' + app.c1 + ',' + app.c2 + ')">' + inner + '</span>';
}

function buildTitlebar(app, id) {
  var shell = window.SHELL || {};
  var kind = shell.titlebar || 'mac';

  if (kind === 'mac') {
    return '<div class="win-bar mac">' +
      '<div class="traffic">' +
        '<div class="tl c" onclick="closeWin(\'' + id + '\')">' +
          '<svg viewBox="0 0 8 8"><path d="M1.4 1.4l5.2 5.2M6.6 1.4L1.4 6.6" stroke="#4d0000" stroke-width="1.3" stroke-linecap="round"/></svg></div>' +
        '<div class="tl m" onclick="minimize(\'' + id + '\')">' +
          '<svg viewBox="0 0 8 8"><path d="M1.4 4h5.2" stroke="#5a3b00" stroke-width="1.4" stroke-linecap="round"/></svg></div>' +
        '<div class="tl z" onclick="maximize(\'' + id + '\')">' +
          '<svg viewBox="0 0 8 8"><path d="M2 6V2h4M2 2l4 4" stroke="#0a3d0a" stroke-width="1.2" stroke-linecap="round"/></svg></div>' +
      '</div>' +
      '<div class="win-title">' + app.name + '</div>' +
      '<div class="win-tools"></div></div>';
  }

  if (kind === 'win') {
    return '<div class="win-bar win">' +
      '<div class="win-title">' + miniTile(app) + app.name + '</div>' +
      '<div class="win-ctrls">' +
        '<button class="wc min" onclick="minimize(\'' + id + '\')"></button>' +
        '<button class="wc max" onclick="maximize(\'' + id + '\')"></button>' +
        '<button class="wc close" onclick="closeWin(\'' + id + '\')"></button>' +
      '</div></div>';
  }

  return '<div class="win-bar mini">' +
    '<div class="win-title">' + app.name + '</div>' +
    '<div class="win-ctrls">' +
      '<button class="wc min" onclick="minimize(\'' + id + '\')"></button>' +
      '<button class="wc max" onclick="maximize(\'' + id + '\')"></button>' +
      '<button class="wc close" onclick="closeWin(\'' + id + '\')"></button>' +
    '</div></div>';
}

function openApp(id) {
  var app = APP_MAP[id];
  if (!app) return;
  var win = document.getElementById('win-' + id);
  if (!win) {
    win = document.createElement('div');
    win.className = 'window open animating';
    win.id = 'win-' + id;
    var w = Math.min(app.w, window.innerWidth - 70);
    var h = Math.min(app.h, window.innerHeight - 110);
    var off = (cascade++ % 5) * 24;
    win.style.width = w + 'px';
    win.style.height = h + 'px';
    win.style.left = Math.max(30, (window.innerWidth - w) / 2 - 50 + off) + 'px';
    win.style.top = Math.max(38, (window.innerHeight - h) / 2 - 40 + off) + 'px';
    win.innerHTML = buildTitlebar(app, id) +
      '<div class="win-body">' + renderContent(id) + '</div>';
    document.getElementById('windows').appendChild(win);
    makeDraggable(win);
    win.addEventListener('mousedown', function () { focusWin(id); });
    setTimeout(function () { win.classList.remove('animating'); }, 220);
    openWins[id] = { min: false };
  }
  win.classList.add('open');
  win.classList.remove('max');
  win.style.display = 'flex';
  openWins[id].min = false;
  focusWin(id);
  if (typeof onWindowOpened === 'function') onWindowOpened(id);
}

function focusWin(id) {
  var win = document.getElementById('win-' + id);
  if (!win) return;
  focusId = id;
  win.style.zIndex = ++zTop;
  Object.keys(openWins).forEach(function (k) {
    var el = document.getElementById('win-' + k);
    if (el) el.classList.toggle('focus', k === id);
  });
  if (typeof onWindowFocus === 'function') onWindowFocus(id);
  if (typeof syncRunning === 'function') syncRunning();
}

function minimize(id) {
  var win = document.getElementById('win-' + id);
  if (!win) return;
  win.style.display = 'none';
  openWins[id].min = true;
  if (typeof syncRunning === 'function') syncRunning();
}

function maximize(id) {
  var win = document.getElementById('win-' + id);
  if (!win) return;
  win.classList.toggle('max');
}

function closeWin(id) {
  var win = document.getElementById('win-' + id);
  if (!win) return;
  win.style.display = 'none';
  win.classList.remove('open');
  delete openWins[id];
  if (focusId === id) {
    focusId = null;
    if (typeof onWindowFocus === 'function') onWindowFocus(null);
  }
  if (typeof syncRunning === 'function') syncRunning();
}

function makeDraggable(win) {
  var bar = win.querySelector('.win-bar');
  var on = false, sx = 0, sy = 0, ox = 0, oy = 0;
  bar.addEventListener('mousedown', function (e) {
    if (e.target.closest('.traffic') || e.target.closest('.win-ctrls')) return;
    if (win.classList.contains('max')) return;
    on = true; sx = e.clientX; sy = e.clientY;
    ox = parseInt(win.style.left || 0, 10);
    oy = parseInt(win.style.top || 0, 10);
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!on) return;
    win.style.left = (ox + e.clientX - sx) + 'px';
    win.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', function () { on = false; });
}

/* ============================================================
   窗口内容
   ============================================================ */
function renderContent(id) {
  switch (id) {
    case 'users':    return usersContent();
    case 'roles':    return rolesContent();
    case 'clients':  return clientsContent();
    case 'sso':      return ssoContent();
    case 'sessions': return sessionsContent();
    case 'audit':    return auditContent();
    case 'gateway':  return gatewayContent();
    case 'settings': return settingsContent();
    default: return '<div class="pane">敬请期待</div>';
  }
}

function usersContent() {
  var rows = [
    ['zhangbz', '张宝忠', '138****6201', '超级管理员', 1, '11-14 19:42'],
    ['lisi',    '李四',   '139****3312', '运维管理员', 1, '11-14 17:08'],
    ['wangwu',  '王五',   '137****8845', '财务主管',   1, '11-13 09:21'],
    ['zhaoliu', '赵六',   '135****2290', '只读用户',   1, '11-10 14:55'],
    ['sunqi',   '孙七',   '186****7712', '只读用户',   0, '10-28 11:03']
  ];
  return '<div class="pane">' +
    '<div class="pane-head"><div><div class="pane-title">用户中心</div>' +
      '<div class="pane-desc">账号数据来自 adm，uiam 只维护登录态与权限映射</div></div>' +
      '<div class="pane-actions"><input class="search" placeholder="搜索"><button class="btn btn-primary">新建用户</button></div></div>' +
    '<table><thead><tr><th>登录名</th><th>姓名</th><th>手机号</th><th>角色</th><th>状态</th><th>最后登录</th><th></th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td class="mono">' + r[0] + '</td><td>' + r[1] + '</td><td class="mono muted">' + r[2] + '</td>' +
        '<td><span class="chip blue">' + r[3] + '</span></td>' +
        '<td><span class="status"><span class="dot ' + (r[4] ? 'on' : 'off') + '"></span>' + (r[4] ? '启用' : '停用') + '</span></td>' +
        '<td class="mono muted">' + r[5] + '</td>' +
        '<td><button class="btn-link btn">详情</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function rolesContent() {
  var roles = [['超级管理员', 128], ['运维管理员', 64], ['财务主管', 32], ['只读用户', 12]];
  var tree = [
    { lv:1, label:'adm 管理后台', state:'on', children:[
      { lv:2, label:'用户管理', state:'on', children:[
        { lv:3, label:'查看用户', state:'on' },
        { lv:3, label:'新建 / 编辑用户', state:'on' },
        { lv:3, label:'重置密码', state:'on' }
      ]},
      { lv:2, label:'角色权限', state:'half', children:[
        { lv:3, label:'查看角色', state:'on' },
        { lv:3, label:'分配权限', state:'' }
      ]}
    ]},
    { lv:1, label:'网关管理', state:'half', children:[
      { lv:2, label:'配置查看', state:'on' },
      { lv:2, label:'配置发布', state:'' }
    ]}
  ];
  function node(n) {
    var h = '<div class="tree-row"><span class="caret">›</span>' +
      '<span class="cbx ' + n.state + '"></span>' +
      '<span style="' + (n.lv === 1 ? 'font-weight:600' : '') + '">' + n.label + '</span></div>';
    if (n.children) h += '<div class="tree-children">' + n.children.map(node).join('') + '</div>';
    return h;
  }
  return '<div class="finder">' +
    '<div class="sidebar">' +
      '<div class="side-group"><div class="side-title">角色</div>' +
      roles.map(function (r, i) {
        return '<div class="side-item' + (i === 0 ? ' active' : '') + '">' +
          '<span class="ic">◆</span>' + r[0] + '<span class="cnt">' + r[1] + '</span></div>';
      }).join('') + '</div>' +
      '<button class="btn btn-sm" style="width:100%">新建角色</button>' +
    '</div>' +
    '<div class="finder-main" style="padding:16px 18px">' +
      '<div class="pane-head"><div><div class="pane-title">超级管理员</div>' +
        '<div class="pane-desc">勾选该角色可访问的菜单与权限点</div></div>' +
        '<div class="pane-actions"><button class="btn">全选</button><button class="btn btn-primary">保存</button></div></div>' +
      '<div class="tree">' + tree.map(node).join('') + '</div>' +
    '</div></div>';
}

function clientsContent() {
  var list = [
    { n:'adm 管理后台', g:'应', c1:'#4facfe', c2:'#0a6ed1', s:'已接入 · 单点登录', cid:'adm-web' },
    { n:'dbz 控制台',   g:'数', c1:'#2ad1d6', c2:'#0a8a99', s:'已接入 · 单点登录', cid:'dbz-web' },
    { n:'dtw 后台',     g:'物', c1:'#4cd964', c2:'#1a8f3c', s:'已接入 · 单点登录', cid:'dtw-web' },
    { n:'msg 消息中心', g:'消', c1:'#ffb340', c2:'#d97500', s:'已接入 · 单点登录', cid:'msg-web' },
    { n:'jobx 调度台',  g:'调', c1:'#a06bf5', c2:'#6b32c9', s:'待接入', cid:'jobx-web' },
    { n:'oss 文件台',   g:'存', c1:'#9aa0a6', c2:'#4a4f55', s:'待接入', cid:'oss-web' }
  ];
  return '<div class="pane">' +
    '<div class="pane-head"><div><div class="pane-title">应用接入</div>' +
      '<div class="pane-desc">每个接入系统登记 client_id、回调地址与入口地址</div></div>' +
      '<div class="pane-actions"><button class="btn btn-primary">接入新应用</button></div></div>' +
    '<div class="cards">' + list.map(function (a) {
      return '<div class="app-card">' +
        '<div class="tile" style="--c1:' + a.c1 + ';--c2:' + a.c2 + '">' + a.g + '</div>' +
        '<div style="min-width:0"><div class="n">' + a.n + '</div><div class="s">' + a.s + '</div>' +
        '<div class="cid">' + a.cid + '</div></div></div>';
    }).join('') + '</div></div>';
}

function ssoContent() {
  return '<div class="pane"><div class="pane-head">' +
    '<div><div class="pane-title">单点登录 · adm-web</div><div class="pane-desc">OIDC 客户端配置</div></div>' +
    '<div class="pane-actions"><button class="btn">生成新密钥</button><button class="btn btn-primary">保存</button></div></div>' +
    '<div class="banner info"><div>token 使用 <b>ES512</b> 签名。旧网关可用同一把 EC 私钥（keystore.pfx）验签，轮换时先把新公钥发布到网关再切换 active 密钥。</div></div>' +
    '<div class="form">' +
      '<div class="sec-label">客户端</div>' +
      '<div class="row2"><div class="field"><label>client_id</label><input class="input mono" value="adm-web"></div>' +
      '<div class="field"><label>client_secret</label><input class="input mono" value="················"></div></div>' +
      '<div class="field"><label>回调地址 redirect_uri</label><input class="input mono" value="https://gw.zbz.com/adm-rs-web/sso/callback">' +
        '<div class="help">登录成功后跳回该地址并携带授权码，多个地址用换行分隔。</div></div>' +
      '<div class="field"><label>入口地址 home_url</label><input class="input mono" value="https://gw.zbz.com/adm-rs-web/">' +
        '<div class="help">桌面点击应用时打开这个地址。adm 的应用表没有 url 字段，所以存在这里。</div></div>' +
      '<div class="sec-label">授权</div>' +
      '<div class="field"><label>允许申请的 scope</label><input class="input mono" value="openid profile roles perms"></div>' +
      '<div class="row2"><div class="field"><label>令牌有效期</label><select class="select"><option>30 分钟</option><option>1 小时</option><option>8 小时</option></select></div>' +
      '<div class="field"><label>刷新令牌</label><select class="select"><option>启用（7 天）</option><option>不启用</option></select></div></div>' +
    '</div></div>';
}

function sessionsContent() {
  var rows = [
    ['zhangbz', '张宝忠', '10.0.1.24', '11-14 19:42', 'Chrome 141 / macOS', 'adm-web'],
    ['lisi',    '李四',   '10.0.1.88', '11-14 17:08', 'Chrome 141 / Windows', 'dbz-web'],
    ['wangwu',  '王五',   '10.0.2.15', '11-14 09:21', 'Safari 18 / iPadOS', 'adm-web'],
    ['zhaoliu', '赵六',   '10.0.2.91', '11-13 14:55', 'Edge 141 / Windows', 'dtw-web']
  ];
  return '<div class="pane">' +
    '<div class="pane-head"><div><div class="pane-title">在线会话</div>' +
      '<div class="pane-desc">4 个活跃会话 · 单点登出会让该用户所有会话同时失效</div></div>' +
      '<div class="pane-actions"><input class="search" placeholder="搜索"><button class="btn">全部下线</button></div></div>' +
    '<table><thead><tr><th>登录名</th><th>姓名</th><th>来源 IP</th><th>登录时间</th><th>客户端</th><th>来源应用</th><th></th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td class="mono">' + r[0] + '</td><td>' + r[1] + '</td><td class="mono muted">' + r[2] + '</td>' +
        '<td class="mono muted">' + r[3] + '</td><td class="muted">' + r[4] + '</td>' +
        '<td><span class="chip blue">' + r[5] + '</span></td>' +
        '<td><button class="btn-danger-link btn" onclick="toast(\'已强制下线 ' + r[0] + '\')">强制下线</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function auditContent() {
  var rows = [
    ['11-14 19:42', 'zhangbz', '登录成功', 'adm-web', '成功'],
    ['11-14 18:15', 'zhangbz', '发布网关配置 v12', 'svr01', '成功'],
    ['11-14 17:40', 'zhangbz', '修改路由 /dtw-rs-web/', 'svr01', '成功'],
    ['11-14 12:08', 'lisi',    '修改负载均衡器 dbz', 'svr01', '成功'],
    ['11-14 11:02', 'wangwu',  '申请访问 dbz-web', '应用权限', '被拒绝'],
    ['11-13 22:31', 'zhangbz', '回滚网关配置 v9', 'svr01', '成功']
  ];
  return '<div class="pane">' +
    '<div class="pane-head"><div><div class="pane-title">审计日志</div>' +
      '<div class="pane-desc">只增不改，凭证字段已脱敏</div></div>' +
      '<div class="pane-actions"><input class="search" placeholder="搜索"><button class="btn">导出</button></div></div>' +
    '<table><thead><tr><th style="width:120px">时间</th><th style="width:100px">操作人</th><th>动作</th><th style="width:120px">目标</th><th style="width:70px">结果</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var cls = r[4] === '成功' ? 'green' : 'red';
      return '<tr><td class="mono muted">' + r[0] + '</td><td class="mono">' + r[1] + '</td><td>' + r[2] + '</td>' +
        '<td class="muted">' + r[3] + '</td><td><span class="chip ' + cls + '">' + r[4] + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function gatewayContent() {
  var rows = [
    ['adm 后台接口', 'prefix', '/adm-rs-web/',  'load-balancer', 'adm', 1],
    ['dbz 控制台',   'prefix', '/dbz-web/',     'load-balancer', 'dbz', 1],
    ['dtw 后台接口', 'prefix', '/dtw-rs-web/',  'load-balancer', 'dtw', 1],
    ['测试接口',     'prefix', '/test/',        'host', '127.0.0.1:8080', 1],
    ['静态资源',     'prefix', '/static/',      'static', '—', 0]
  ];
  return '<div class="pane">' +
    '<div class="pane-head"><div><div class="pane-title">网关配置 · svr01</div>' +
      '<div class="pane-desc">KV gatex-rs-svr01.toml · 当前 v12 · 2 个监听器</div></div>' +
    '<div class="pane-actions"><button class="btn">校验</button><button class="btn btn-primary">发布</button></div></div>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">' +
      '<span class="chip blue">http</span><b style="font-size:12.5px">0.0.0.0:80</b>' +
      '<span class="muted" style="font-size:11px">5 条路由</span>' +
      '<button class="btn btn-sm" style="margin-left:auto">+ 路由</button></div>' +
    '<table><thead><tr><th style="width:28px">#</th><th style="width:140px">名称</th><th>匹配器</th><th>目标</th><th style="width:70px">状态</th><th style="width:56px"></th></tr></thead><tbody>' +
    rows.map(function (r, i) {
      return '<tr><td class="muted">' + (i + 1) + '</td><td>' + r[0] + '</td>' +
        '<td><span class="chip">' + r[1] + '</span> <span class="mono">' + r[2] + '</span></td>' +
        '<td><span class="chip">' + r[3] + '</span> <span class="mono">' + r[4] + '</span></td>' +
        '<td><span class="status"><span class="dot ' + (r[5] ? 'on' : 'off') + '"></span>' + (r[5] ? '启用' : '停用') + '</span></td>' +
        '<td><button class="btn-link btn">编辑</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function settingsContent() {
  return '<div class="pane"><div class="pane-head"><div><div class="pane-title">系统设置</div>' +
    '<div class="pane-desc">平台外观与认证策略</div></div>' +
    '<div class="pane-actions"><button class="btn btn-primary">保存</button></div></div>' +
    '<div class="form">' +
      '<div class="sec-label">外观</div>' +
      '<div class="field"><label>平台名称</label><input class="input" value="uiam 统一身份认证平台"></div>' +
      '<div class="sec-label">认证策略</div>' +
      '<div class="row2">' +
        '<div class="field"><label>会话超时</label><select class="select"><option>30 分钟</option><option>2 小时</option><option>8 小时</option></select></div>' +
        '<div class="field"><label>单账号并发会话</label><select class="select"><option>不限</option><option>3 个</option><option>1 个</option></select></div>' +
      '</div>' +
      '<div class="field"><label>单点登出</label><select class="select"><option>启用（退出即全平台失效）</option><option>仅退出当前应用</option></select>' +
        '<div class="help">启用后，用户在任一应用退出，uiam 会通知所有已接入系统清除本地会话。</div></div>' +
      '<div class="sec-label">桌面</div>' +
      '<div class="field"><label>桌面组件</label><select class="select"><option>允许用户自定义布局</option><option>统一布局（不可修改）</option></select>' +
        '<div class="help">允许自定义时，用户可以拖动排序、切换尺寸、增删组件；布局按人保存在本地。</div></div>' +
      '<div class="field"><label>默认组件</label><input class="input" value="时钟、当前用户、在线用户、快捷应用、最近发布、网关节点、今日登录、待办审批">' +
        '<div class="help">首次登录时的初始布局。快捷应用按角色可见范围生成，与 adm 的应用白名单一致。</div></div>' +
    '</div></div>';
}

/* ============================================================
   Toast / 时钟
   ============================================================ */
var toastTimer = null;
function toast(text) {
  var el = document.getElementById('toast');
  if (!el) return;
  document.getElementById('toast-text').textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
}

function startClock(elId) {
  function tick() {
    var el = document.getElementById(elId);
    if (!el) return;
    var d = new Date();
    var w = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    el.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + w + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  tick();
  setInterval(tick, 20000);
}
