import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = { config: null, session: null, dashboard: null, friend: null, selectedFriend: null, drawer: null, editingWish: null, editingFriend: null, inviteResult: null };

const icons = {
  plus: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  user: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/></svg>',
  gift: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14M12 7H7.5a2.5 2.5 0 1 1 0-5c3.5 0 4.5 5 4.5 5Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z"/></svg>',
  eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  logout: '<svg class="icon" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg>',
  home: '<svg class="icon" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v10h-6v-6H9v6H3Z"/></svg>',
  leaf: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16ZM5 20c2-5 6-8 11-11"/></svg>',
};

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
function rpcError(error) {
  if (!error) return null;
  const message = error.message || '请求失败';
  if (/invalid login credentials/i.test(message)) return new Error('邮箱或密码不正确');
  if (/rate limit/i.test(message)) return new Error('尝试次数过多，请稍后再试');
  if (/invite_invalid/i.test(message)) return new Error('邀请链接已失效，请联系花园主人重新生成');
  if (/not_owner/i.test(message)) return new Error('当前账号没有主人权限');
  if (/friend_access_denied/i.test(message)) return new Error('这个愿望花园的访问已失效');
  return new Error(message);
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw rpcError(error);
  return data;
}

function attachInviteUrl(result) {
  return result?.inviteToken ? { ...result, inviteUrl: `${location.origin}/invite/${result.inviteToken}` } : result;
}

async function request(url, options = {}) {
  if (!supabase) throw new Error('尚未配置 Supabase 环境变量');
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  let match;
  if (url === '/api/config') return { mode: 'secure', provider: 'supabase' };
  if (url === '/api/login') {
    const { error } = await supabase.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) throw rpcError(error);
    await rpc('owner_assert');
    return { ok: true };
  }
  if (url === '/api/logout') { await supabase.auth.signOut(); return { ok: true }; }
  if (url === '/api/session') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { role: 'guest' };
    if (session.user?.is_anonymous) return { role: 'friend' };
    try { await rpc('owner_assert'); return { role: 'owner' }; } catch { return { role: 'guest' }; }
  }
  if (url === '/api/owner/dashboard') return rpc('owner_dashboard');
  if (url === '/api/owner/friends' && method === 'POST') return attachInviteUrl(await rpc('owner_create_friend', { p_name: body.name, p_birthday: body.birthday, p_note: body.note || '' }));
  if ((match = url.match(/^\/api\/owner\/friends\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]);
    if (method === 'GET') return rpc('owner_friend', { p_friend_id: id });
    if (method === 'PATCH') return rpc('owner_update_friend', { p_friend_id: id, p_name: body.name, p_birthday: body.birthday, p_note: body.note || '' });
    if (method === 'DELETE') return rpc('owner_delete_friend', { p_friend_id: id });
  }
  if ((match = url.match(/^\/api\/owner\/friends\/([^/]+)\/invite$/))) {
    const id = decodeURIComponent(match[1]);
    return method === 'DELETE' ? rpc('owner_revoke_invite', { p_friend_id: id }) : attachInviteUrl(await rpc('owner_regenerate_invite', { p_friend_id: id }));
  }
  if ((match = url.match(/^\/api\/owner\/wishes\/([^/]+)\/status$/))) return rpc('owner_set_wish_status', { p_wish_id: decodeURIComponent(match[1]), p_status: body.status });
  if (url === '/api/invite/exchange') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.is_anonymous) { await supabase.auth.signOut(); await supabase.auth.signInAnonymously(); }
    await rpc('claim_invite', { p_token: body.token });
    return { ok: true };
  }
  if (url === '/api/friend/me') return rpc('friend_context');
  if (url === '/api/friend/wishes' && method === 'POST') return rpc('friend_save_wish', { p_wish_id: null, p_name: body.name, p_product_url: body.productUrl || '', p_price_cents: body.price ? Math.round(Number(body.price) * 100) : null, p_priority: body.priority, p_note: body.note || '' });
  if ((match = url.match(/^\/api\/friend\/wishes\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]);
    if (method === 'DELETE') return rpc('friend_delete_wish', { p_wish_id: id });
    return rpc('friend_save_wish', { p_wish_id: id, p_name: body.name, p_product_url: body.productUrl || '', p_price_cents: body.price ? Math.round(Number(body.price) * 100) : null, p_priority: body.priority, p_note: body.note || '' });
  }
  throw new Error('不支持的请求');
}

function brand() { return `<a class="brand" href="/"><span class="brand-mark">愿</span><span class="brand-copy"><strong>愿望花园</strong><span>WISH GARDEN</span></span></a>`; }
function modeBanner() { return ''; }
function shell(content, role = 'owner') {
  return `<main class="shell"><div class="page"><header class="topbar">${brand()}<button class="icon-button" data-action="logout" aria-label="退出登录">${icons.logout}</button></header>${modeBanner()}${content}</div>${role === 'owner' ? `<nav class="bottom-nav" aria-label="主人导航"><button class="active">${icons.home}<span>首页</span></button><button data-action="new-friend">${icons.user}<span>朋友</span></button><button>${icons.gift}<span>愿望</span></button></nav>` : ''}</main>`;
}

function loginView() {
  app.innerHTML = `<main class="auth"><img class="auth-flower" src="/assets/botanical-corner.png" alt="" /><section class="auth-panel">${brand()}<div style="height:34px"></div><h1>把心意，<br>种进花园。</h1><p>收集朋友真正想要的礼物，在生日到来前，从容准备每一份惊喜。</p><form class="form" id="login-form"><div class="field"><label for="email">主人邮箱</label><input class="input" id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">密码</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div><button class="button primary" type="submit">进入我的花园 ${icons.leaf}</button></form></section></main>`;
}

function birthdayDistance(mmdd) {
  const now = new Date();
  const [month, day] = mmdd.split('-').map(Number);
  let date = new Date(now.getFullYear(), month - 1, day);
  if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.round((date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
function sortFriends(friends) { return [...friends].sort((a, b) => birthdayDistance(a.birthday) - birthdayDistance(b.birthday)); }
function dateLabel(mmdd) { const [m, d] = mmdd.split('-').map(Number); return `${m}月${d}日`; }

function dashboardView() {
  const friends = sortFriends(state.dashboard?.friends || []);
  const next = friends[0];
  const pending = friends.reduce((sum, item) => sum + item.pendingCount, 0);
  const purchased = friends.reduce((sum, item) => sum + item.purchasedCount, 0);
  const given = friends.reduce((sum, item) => sum + item.givenCount, 0);
  const nextBlock = next ? `<section class="next-birthday"><div class="avatar">${escapeHtml(next.name.slice(-1))}</div><div class="birthday-copy"><span class="eyeline">下一个生日 · ${dateLabel(next.birthday)}</span><h2>${escapeHtml(next.name)}</h2><div class="date">还有 ${birthdayDistance(next.birthday)} 天</div><div class="birthday-stats"><span><strong>${next.wishCount}</strong>她/他的愿望</span><span><strong>${pending}</strong>待购买</span><span><strong>${purchased}</strong>已购买</span><span><strong>${given}</strong>已送出</span></div></div></section>` : `<div class="empty"><strong>花园里还没有朋友</strong>创建一封邀请，让第一颗愿望种子发芽吧。</div>`;
  const list = friends.length ? friends.map((friend) => {
    const completed = friend.purchasedCount + friend.givenCount;
    const progress = friend.wishCount ? Math.round(completed / friend.wishCount * 100) : 0;
    return `<button class="friend-row" data-friend-id="${friend.id}"><span class="mini-avatar">${escapeHtml(friend.name.slice(-1))}</span><span class="friend-name"><strong>${escapeHtml(friend.name)}</strong><span>${dateLabel(friend.birthday)} · 还有 ${birthdayDistance(friend.birthday)} 天</span></span><span class="friend-progress"><span class="progress-copy"><span>${friend.wishCount} 个愿望</span><span>${completed}/${friend.wishCount} 已准备</span></span><span class="progress"><i style="width:${progress}%"></i></span></span><span class="chevron">›</span></button>`;
  }).join('') : '';
  app.innerHTML = shell(`<section class="greeting"><div><h1>早上好，花园主人</h1><p>今天也为重要的人，留一份刚刚好的心意。</p></div><div class="action-cluster"><button class="button primary" data-action="new-friend">${icons.plus}<span>创建邀请</span></button></div></section>${nextBlock}<section><div class="section-head"><div><h2>全部朋友</h2><p>已按最近生日自动排序</p></div><button class="button ghost" data-action="new-friend">${icons.plus} 添加朋友</button></div><div class="friend-list">${list}</div></section><section><div class="section-head"><div><h2>数据安全</h2><p>数据保存在 Supabase；建议定期下载一份 JSON 备份</p></div></div><div class="data-actions"><button class="button secondary" data-action="export-data">导出全部数据</button></div></section>`);
  renderDrawer();
}

function friendOwnerView() {
  const friend = state.selectedFriend;
  const rows = friend.wishes.map((wish) => wishOwnerRow(wish)).join('');
  app.innerHTML = shell(`<section class="greeting"><div><button class="button ghost" data-action="back-dashboard">← 返回</button><h1 style="margin-top:20px">${escapeHtml(friend.name)}的愿望</h1><p>${dateLabel(friend.birthday)} · 还有 ${birthdayDistance(friend.birthday)} 天</p></div></section><div class="desktop-grid"><section><div class="section-head"><div><h2>愿望清单</h2><p>状态仅主人可见，朋友不会看到购买进度</p></div></div><div class="wish-list">${rows || '<div class="empty"><strong>还没有愿望</strong>等朋友慢慢把喜欢的东西种进来。</div>'}</div></section><aside class="side-panel"><h3>朋友小档案</h3><div class="meta"><span>生日</span><strong>${dateLabel(friend.birthday)}</strong></div><div class="meta"><span>愿望数量</span><strong>${friend.wishes.length} 个</strong></div><div class="meta"><span>给主人的备注</span><strong>${escapeHtml(friend.note || '暂无')}</strong></div><div class="meta"><span>邀请状态</span><strong>${friend.inviteActive ? '有效' : '已撤销'}</strong></div><div class="security-note">重新生成或撤销邀请后，旧链接和旧朋友会话都会立即失效。</div><div class="manage-actions"><button class="button secondary" data-action="edit-friend">编辑朋友资料</button><button class="button ghost" data-action="regenerate-invite">重新生成邀请</button><button class="button ghost" data-action="revoke-invite" ${friend.inviteActive ? '' : 'disabled'}>撤销当前邀请</button><button class="button danger" data-action="delete-friend">删除朋友及愿望</button></div></aside></div>`);
}
function wishOwnerRow(wish) {
  const status = { pending: '待购买', purchased: '已购买', given: '已送出' };
  const priority = { high: '高优先级', medium: '中优先级', low: '随缘' };
  return `<article class="wish-row"><div><div class="wish-title"><h3>${escapeHtml(wish.name)}</h3><span class="priority ${wish.priority}">${priority[wish.priority]}</span></div>${wish.priceCents != null ? `<div class="wish-price">¥ ${(wish.priceCents / 100).toFixed(0)}</div>` : ''}${wish.note ? `<p class="wish-note">${escapeHtml(wish.note)}</p>` : ''}${wish.productUrl ? `<a class="wish-link" href="${escapeHtml(wish.productUrl)}" target="_blank" rel="noopener noreferrer">查看商品链接 ↗</a>` : ''}</div><div class="wish-actions"><select class="status-select" data-wish-status="${wish.id}" aria-label="礼物状态">${Object.entries(status).map(([value, label]) => `<option value="${value}" ${wish.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></article>`;
}

function friendView() {
  const friend = state.friend;
  const rows = friend.wishes.map(wishFriendRow).join('');
  app.innerHTML = shell(`<section class="friend-intro"><h1>给${escapeHtml(friend.name)}的<br>愿望花园</h1><p>生日是属于你的特别日子，把真正喜欢的礼物都种进这里吧。只有你和花园主人可以看到这份清单。</p><span class="birthday-tag">${icons.gift} 我的生日 · ${dateLabel(friend.birthday)}</span></section><section><div class="section-head"><div><h2>我的愿望</h2><p>随时回来修改，购买状态不会对你显示</p></div><div class="privacy-note">${icons.eye}<span>私密清单</span></div></div><div class="wish-list">${rows || '<div class="empty"><strong>愿望还是一片空地</strong>把第一个真正喜欢的礼物种进来吧。</div>'}</div><div style="margin-top:16px"><button class="button primary" style="width:100%" data-action="new-wish">${icons.plus} 添加愿望</button></div></section>`, 'friend');
  renderDrawer();
}
function wishFriendRow(wish) {
  const priority = { high: '高优先级', medium: '中优先级', low: '随缘' };
  return `<article class="wish-row"><div><div class="wish-title"><h3>${escapeHtml(wish.name)}</h3><span class="priority ${wish.priority}">${priority[wish.priority]}</span></div>${wish.priceCents != null ? `<div class="wish-price">¥ ${(wish.priceCents / 100).toFixed(0)}</div>` : ''}${wish.note ? `<p class="wish-note">${escapeHtml(wish.note)}</p>` : ''}${wish.productUrl ? `<a class="wish-link" href="${escapeHtml(wish.productUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(wish.productUrl)}</a>` : ''}</div><div class="wish-actions"><button class="tiny-button" data-edit-wish="${wish.id}">编辑</button><button class="tiny-button" data-delete-wish="${wish.id}">删除</button></div></article>`;
}

function renderDrawer() {
  document.querySelector('.drawer-backdrop')?.remove();
  if (!state.drawer) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'drawer-backdrop';
  if (state.drawer === 'friend') {
    const friend = state.editingFriend;
    wrapper.innerHTML = `<section class="drawer"><div class="drawer-head"><div><h2>${friend ? '编辑朋友资料' : '创建朋友邀请'}</h2><p>${friend ? '生日和备注会立即更新' : '每位朋友都有独立且私密的入口'}</p></div><button class="close" data-action="close-drawer" aria-label="关闭">×</button></div><form class="form" id="friend-form"><div class="field"><label>朋友姓名</label><input class="input" name="name" required maxlength="60" placeholder="例如：林小满" value="${escapeHtml(friend?.name || '')}"></div><div class="field"><label>生日（月-日）</label><input class="input" name="birthday" required placeholder="05-20" pattern="\\d{2}-\\d{2}" value="${escapeHtml(friend?.birthday || '')}"></div><div class="field"><label>给自己的备注（可选）</label><textarea class="textarea" name="note" maxlength="300" placeholder="她最近开始学习陶艺……">${escapeHtml(friend?.note || '')}</textarea></div><button class="button primary" type="submit">${friend ? '保存资料' : '生成专属邀请'}</button></form><div id="invite-result"></div></section>`;
  }
  if (state.drawer === 'invite') {
    wrapper.innerHTML = `<section class="drawer"><div class="drawer-head"><div><h2>新邀请已生成</h2><p>旧链接和旧会话已经失效</p></div><button class="close" data-action="close-drawer" aria-label="关闭">×</button></div><div class="invite-result"><p>请只把这个链接发送给 <strong>${escapeHtml(state.selectedFriend?.name || '朋友')}</strong>：</p><div class="invite-link"><input class="input" id="invite-url" readonly value="${escapeHtml(state.inviteResult || '')}"><button class="button secondary" type="button" data-action="copy-invite">复制</button></div></div></section>`;
  }
  if (state.drawer === 'wish') {
    const wish = state.editingWish;
    wrapper.innerHTML = `<section class="drawer"><div class="drawer-head"><div><h2>${wish ? '编辑愿望' : '添加愿望'}</h2><p>喜欢的礼物，值得被认真记下来</p></div><button class="close" data-action="close-drawer" aria-label="关闭">×</button></div><form class="form" id="wish-form"><div class="field"><label>礼物名称</label><input class="input" name="name" required maxlength="80" placeholder="例如：手绘植物马克杯" value="${escapeHtml(wish?.name || '')}"></div><div class="field"><label>商品链接</label><input class="input" name="productUrl" type="url" maxlength="500" placeholder="https://" value="${escapeHtml(wish?.productUrl || '')}"></div><div class="form-row"><div class="field"><label>价格</label><input class="input" name="price" type="number" min="0" step="0.01" placeholder="128" value="${wish?.priceCents != null ? wish.priceCents / 100 : ''}"></div><div class="field"><label>优先级</label><select class="select" name="priority"><option value="high" ${wish?.priority === 'high' ? 'selected' : ''}>高优先级</option><option value="medium" ${!wish || wish.priority === 'medium' ? 'selected' : ''}>中优先级</option><option value="low" ${wish?.priority === 'low' ? 'selected' : ''}>随缘</option></select></div></div><div class="field"><label>备注</label><textarea class="textarea" name="note" maxlength="500" placeholder="写下你喜欢它的原因吧～">${escapeHtml(wish?.note || '')}</textarea></div><div class="form-row"><button class="button ghost" type="button" data-action="close-drawer">取消</button><button class="button primary" type="submit">保存愿望 ${icons.leaf}</button></div></form></section>`;
  }
  document.body.appendChild(wrapper);
}

async function loadDashboard() { state.dashboard = await request('/api/owner/dashboard'); state.selectedFriend = null; dashboardView(); window.scrollTo(0, 0); }
async function loadFriend() { const data = await request('/api/friend/me'); state.friend = data.friend; friendView(); window.scrollTo(0, 0); }
async function openFriend(id) { const data = await request(`/api/owner/friends/${encodeURIComponent(id)}`); state.selectedFriend = data.friend; friendOwnerView(); window.scrollTo(0, 0); }

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  button?.setAttribute('disabled', '');
  try {
    if (form.id === 'login-form') {
      const data = Object.fromEntries(new FormData(form));
      await request('/api/login', { method: 'POST', body: JSON.stringify(data) });
      state.session = { role: 'owner' }; history.replaceState({}, '', '/owner'); await loadDashboard();
    }
    if (form.id === 'friend-form') {
      const data = Object.fromEntries(new FormData(form));
      if (state.editingFriend) {
        const result = await request(`/api/owner/friends/${state.editingFriend.id}`, { method: 'PATCH', body: JSON.stringify(data) });
        state.selectedFriend = result.friend; state.editingFriend = null; state.drawer = null; showToast('朋友资料已更新'); friendOwnerView(); renderDrawer();
      } else {
        const result = await request('/api/owner/friends', { method: 'POST', body: JSON.stringify(data) });
        document.querySelector('#invite-result').innerHTML = `<div class="invite-result"><p><strong>${escapeHtml(result.friend.name)}</strong> 的邀请已准备好。这个链接只发给本人：</p><div class="invite-link"><input class="input" id="invite-url" readonly value="${escapeHtml(result.inviteUrl)}"><button class="button secondary" type="button" data-action="copy-invite">复制</button></div></div>`;
        await refreshDashboardQuietly();
      }
    }
    if (form.id === 'wish-form') {
      const data = Object.fromEntries(new FormData(form));
      const url = state.editingWish ? `/api/friend/wishes/${state.editingWish.id}` : '/api/friend/wishes';
      await request(url, { method: state.editingWish ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      state.drawer = null; state.editingWish = null; showToast('愿望已保存'); await loadFriend();
    }
  } catch (error) { showToast(error.message); }
  finally { button?.removeAttribute('disabled'); }
});

async function refreshDashboardQuietly() { state.dashboard = await request('/api/owner/dashboard'); }
document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const friendId = event.target.closest('[data-friend-id]')?.dataset.friendId;
  const editId = event.target.closest('[data-edit-wish]')?.dataset.editWish;
  const deleteId = event.target.closest('[data-delete-wish]')?.dataset.deleteWish;
  try {
    if (friendId) return await openFriend(friendId);
    if (action === 'new-friend') { state.editingFriend = null; state.drawer = 'friend'; renderDrawer(); }
    if (action === 'new-wish') { state.drawer = 'wish'; state.editingWish = null; renderDrawer(); }
    if (action === 'close-drawer') { state.drawer = null; state.editingWish = null; state.editingFriend = null; state.inviteResult = null; renderDrawer(); }
    if (action === 'back-dashboard') await loadDashboard();
    if (action === 'copy-invite') { const input = document.querySelector('#invite-url'); await navigator.clipboard.writeText(input.value); showToast('邀请链接已复制'); }
    if (action === 'edit-friend') { state.editingFriend = state.selectedFriend; state.drawer = 'friend'; renderDrawer(); }
    if (action === 'regenerate-invite') {
      const result = await request(`/api/owner/friends/${state.selectedFriend.id}/invite`, { method: 'POST' });
      state.selectedFriend = result.friend; state.inviteResult = result.inviteUrl; state.drawer = 'invite'; renderDrawer();
    }
    if (action === 'revoke-invite' && confirm('撤销后，旧邀请链接和朋友当前登录都会立即失效。确定撤销吗？')) {
      const result = await request(`/api/owner/friends/${state.selectedFriend.id}/invite`, { method: 'DELETE' });
      state.selectedFriend = result.friend; showToast('邀请已撤销'); friendOwnerView();
    }
    if (action === 'delete-friend' && confirm(`确定删除 ${state.selectedFriend.name} 及其全部愿望吗？此操作无法撤销。`)) {
      await request(`/api/owner/friends/${state.selectedFriend.id}`, { method: 'DELETE' }); showToast('朋友资料已删除'); await loadDashboard();
    }
    if (action === 'export-data') {
      const data = await rpc('owner_export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `wish-garden-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('数据已导出');
    }
    if (action === 'logout') { await request('/api/logout', { method: 'POST' }); state.session = { role: 'guest' }; history.replaceState({}, '', '/'); loginView(); }
    if (editId) { state.editingWish = state.friend.wishes.find((wish) => wish.id === editId); state.drawer = 'wish'; renderDrawer(); }
    if (deleteId && confirm('确定删除这个愿望吗？')) { await request(`/api/friend/wishes/${deleteId}`, { method: 'DELETE' }); showToast('愿望已删除'); await loadFriend(); }
  } catch (error) { showToast(error.message); }
});

document.addEventListener('change', async (event) => {
  const wishId = event.target.dataset.wishStatus;
  if (!wishId) return;
  try { await request(`/api/owner/wishes/${wishId}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); showToast('礼物状态已更新'); }
  catch (error) { showToast(error.message); }
});

async function boot() {
  app.innerHTML = '<div class="loading" aria-label="加载中"></div>';
  try {
    state.config = await request('/api/config');
    const inviteMatch = location.pathname.match(/^\/invite\/([^/]+)$/);
    if (inviteMatch) {
      await request('/api/invite/exchange', { method: 'POST', body: JSON.stringify({ token: decodeURIComponent(inviteMatch[1]) }) });
      history.replaceState({}, '', '/friend'); state.session = { role: 'friend' }; return await loadFriend();
    }
    state.session = await request('/api/session');
    if (state.session.role === 'owner') return await loadDashboard();
    if (state.session.role === 'friend' && location.pathname === '/friend') return await loadFriend();
    loginView();
  } catch (error) { app.innerHTML = `<div class="auth"><section class="auth-panel"><h1>花园暂时打不开</h1><p>${escapeHtml(error.message)}</p><button class="button primary" onclick="location.reload()">重新试试</button></section></div>`; }
}

boot();
