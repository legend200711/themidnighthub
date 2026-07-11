/* ============================================================
   THE MIDNIGHT HUB — script.js
   Full PWA app logic — Firebase Auth + Realtime Database
   ============================================================ */

'use strict';

// ── Firebase Config ────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyByZRmp6R9HY17T2_WdJUFWeeaLNOP6y2Y",
  authDomain:        "horr-a08f4.firebaseapp.com",
  databaseURL:       "https://horr-a08f4-default-rtdb.firebaseio.com",
  projectId:         "horr-a08f4",
  storageBucket:     "horr-a08f4.firebasestorage.app",
  messagingSenderId: "933810617818",
  appId:             "1:933810617818:web:7e677d20bbbe6bb17c14e3"
};

// ── App State ──────────────────────────────────────────────
const App = {
  currentUser: null,
  currentPage: 'feed',
  viewingProfile: null,
  activeConvo: null,
  fbApp:   null,
  auth:    null,
  db:      null,
  useLocalFallback: true,
  deferredInstallPrompt: null,
  unreadNotifs: 0,
  unreadMessages: 0,
  _listeners: [],
  _initDone: false,
};

// ── Local-storage mock DB (used when Firebase is not yet configured) ──
const LocalDB = {
  _key: k => `mh_${k}`,
  get: k  => { try { return JSON.parse(localStorage.getItem(LocalDB._key(k))); } catch { return null; } },
  set: (k, v) => localStorage.setItem(LocalDB._key(k), JSON.stringify(v)),
  push: (k, item) => {
    const arr = LocalDB.get(k) || [];
    item.id = item.id || `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    arr.unshift(item);
    LocalDB.set(k, arr);
    return item;
  },
  update: (k, id, patch) => {
    const arr = LocalDB.get(k) || [];
    const idx = arr.findIndex(x => x.id === id);
    if (idx !== -1) { arr[idx] = { ...arr[idx], ...patch }; LocalDB.set(k, arr); }
  },
  remove: (k, id) => {
    const arr = (LocalDB.get(k) || []).filter(x => x.id !== id);
    LocalDB.set(k, arr);
  }
};

// ── DOM helpers ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeAgo = ts => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const avatarInitials = name => name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) : '?';
const avatarColor = name => {
  const colors = ['#7c5cfc','#e05c5c','#4caf7d','#e0a050','#5cb8e0','#d45ce0','#5ce0c8'];
  let h = 0; for (const c of (name||'')) h = (h*31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
};

// ── Toast ──────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  const icons = { info: 'ℹ️', success: '✅', danger: '❌', warning: '⚠️' };
  const container = $('toast-container');
  const toast = el('div', `toast ${type}`, `<span>${icons[type]||''}</span><span>${esc(msg)}</span>`);
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ── Page router ────────────────────────────────────────────
function navigate(pageId, opts = {}) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.sidenav-item, .bottom-nav-btn').forEach(b => b.classList.remove('active'));
  const page = $(`page-${pageId}`);
  if (page) { page.classList.add('active'); page.classList.add('fade-in'); }
  $$(`[data-page="${pageId}"]`).forEach(b => b.classList.add('active'));
  App.currentPage = pageId;

  if (pageId === 'feed')     renderFeed();
  if (pageId === 'search')   initSearch();
  if (pageId === 'messages') renderConvoList();
  if (pageId === 'notifs')   renderNotifications();
  if (pageId === 'profile')  renderProfile(opts.uid || App.currentUser?.uid);
  if (pageId === 'settings') renderSettings();

  // Refresh right-sidebar suggestions (defined in post-load script)
  setTimeout(() => { if (typeof renderSuggestedUsers === 'function') renderSuggestedUsers(); }, 80);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Auth ───────────────────────────────────────────────────
function openAuthModal(tab = 'login') {
  const overlay = $('auth-modal');
  overlay.classList.add('open');
  switchAuthTab(tab);
}
function closeAuthModal() { $('auth-modal').classList.remove('open'); }

function switchAuthTab(tab) {
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('auth-login-form').classList.toggle('hidden', tab !== 'login');
  $('auth-register-form').classList.toggle('hidden', tab !== 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const pass  = $('login-pass').value;
  if (!email || !pass) { showToast('Please fill in all fields.', 'warning'); return; }
  clearFormErrors('auth-login-form');

  try {
    if (!App.useLocalFallback && App.auth) {
      await App.auth.signInWithEmailAndPassword(email, pass);
      closeAuthModal();
      showToast('Welcome back!', 'success');
      // onAuthStateChanged handles profile load + UI update
    } else {
      const users = LocalDB.get('users') || [];
      const user  = users.find(u => u.email === email && u.password === btoa(pass));
      if (!user) throw new Error('Invalid email or password.');
      setCurrentUser(user);
      closeAuthModal();
      showToast('Welcome back!', 'success');
      navigate('feed');
    }
  } catch (err) {
    const msg = friendlyAuthError(err.code || err.message);
    showFormError('login-email', msg);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name  = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const pass  = $('reg-pass').value;
  const conf  = $('reg-confirm').value;
  clearFormErrors('auth-register-form');

  if (!name || !email || !pass) { showToast('Please fill in all fields.', 'warning'); return; }
  if (pass !== conf)   { showFormError('reg-confirm', 'Passwords do not match.'); return; }
  if (pass.length < 6) { showFormError('reg-pass', 'Password must be at least 6 characters.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFormError('reg-email', 'Enter a valid email address.'); return; }

  try {
    if (!App.useLocalFallback && App.auth) {
      const cred = await App.auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name });

      const usersSnap = await App.db.ref('users').once('value');
      const isFirst   = !usersSnap.exists();
      const profile   = {
        uid: cred.user.uid, name, email,
        handle:    '@' + name.toLowerCase().replace(/\s+/g, '') + Math.floor(Math.random() * 999),
        bio: '', photoURL: null,
        badges:    isFirst ? ['founder'] : [],
        followers: {}, following: {},
        createdAt: Date.now()
      };
      await App.db.ref(`users/${cred.user.uid}`).set(profile);
      closeAuthModal();
      showToast('Account created! Welcome to The Midnight Hub 🌙', 'success');
      // onAuthStateChanged handles profile load + UI update
    } else {
      const users   = LocalDB.get('users') || [];
      if (users.find(u => u.email === email)) throw new Error('Email already registered.');
      const isFirst = users.length === 0;
      const newUser = {
        uid: `u_${Date.now()}`, name, email,
        password: btoa(pass),
        handle: '@' + name.toLowerCase().replace(/\s+/g,'') + Math.floor(Math.random()*999),
        bio: '', photoURL: null,
        badges: isFirst ? ['founder'] : [],
        followers: [], following: [],
        createdAt: Date.now()
      };
      users.push(newUser);
      LocalDB.set('users', users);
      setCurrentUser(newUser);
      closeAuthModal();
      showToast('Account created! Welcome to The Midnight Hub 🌙', 'success');
      navigate('feed');
    }
  } catch (err) {
    const msg = friendlyAuthError(err.code || err.message);
    showFormError('reg-email', msg);
  }
}

function handleLogout() {
  // Detach all RTDB listeners
  App._listeners.forEach(off => off());
  App._listeners = [];
  App._initDone  = false;

  if (!App.useLocalFallback && App.auth) {
    App.auth.signOut();
    // onAuthStateChanged will fire with null and call updateAuthUI + renderFeed
  } else {
    App.currentUser = null;
    LocalDB.set('currentUser', null);
    updateAuthUI();
    navigate('feed');
  }
  showToast('Signed out.', 'info');
}

// Map Firebase error codes to friendly messages
function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/invalid-email':        'Enter a valid email address.',
    'auth/too-many-requests':    'Too many attempts. Please try again later.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || code || 'Something went wrong. Please try again.';
}

function setCurrentUser(user) {
  App.currentUser = user;
  LocalDB.set('currentUser', user);
  updateAuthUI();
}

function updateAuthUI() {
  const loggedIn = !!App.currentUser;
  $$('.auth-only').forEach(el => el.classList.toggle('hidden', !loggedIn));
  $$('.guest-only').forEach(el => el.classList.toggle('hidden', loggedIn));
  if (loggedIn) {
    const u = App.currentUser;
    $$('.current-user-name').forEach(el => { el.textContent = u.name; });
    $$('.current-user-avatar').forEach(el => renderAvatarInto(el, u));
  }
}

function showFormError(fieldId, msg) {
  const field = $(fieldId);
  if (!field) return;
  field.style.borderColor = 'var(--danger)';
  let errEl = field.parentElement.querySelector('.form-error');
  if (!errEl) { errEl = el('p', 'form-error', ''); field.parentElement.appendChild(errEl); }
  errEl.textContent = msg;
}

function clearFormErrors(formId) {
  const form = $(formId);
  if (!form) return;
  form.querySelectorAll('.form-error').forEach(e => e.remove());
  form.querySelectorAll('.form-control').forEach(e => e.style.borderColor = '');
}

// ── Avatar renderer ────────────────────────────────────────
function renderAvatarInto(container, user) {
  if (!container) return;
  if (user?.photoURL) {
    container.innerHTML = `<img src="${esc(user.photoURL)}" alt="${esc(user.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    container.style.background = avatarColor(user?.name || '?');
    container.textContent = avatarInitials(user?.name || '?');
  }
}

function avatarHTML(user, cls = '') {
  const bg   = user?.photoURL ? '' : `style="background:${avatarColor(user?.name||'?')}"`;
  const inner = user?.photoURL
    ? `<img src="${esc(user.photoURL)}" alt="${esc(user?.name||'')}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
    : avatarInitials(user?.name || '?');
  return `<div class="avatar ${cls}" ${bg}>${inner}</div>`;
}

// ── Feed / Posts ───────────────────────────────────────────
function renderFeed() {
  if (!App.useLocalFallback) { renderFeedFirebase(); return; }
  const feed = $('feed-posts');
  if (!feed) return;
  feed.innerHTML = '';
  const posts = LocalDB.get('posts') || seedPosts();
  if (posts.length === 0) {
    feed.innerHTML = '<p class="text-muted text-center mt-2">No posts yet. Be the first to share something!</p>';
    return;
  }
  posts.forEach(post => feed.appendChild(buildPostEl(post)));
}

function buildPostEl(post) {
  const users  = App.useLocalFallback
    ? (LocalDB.get('users') || [])
    : [];
  const author = users.find(u => u.uid === post.uid) || { name: post.authorName || 'Unknown', uid: post.uid };
  // likes can be an object (Firebase) or array (local)
  const likesArr = Array.isArray(post.likes) ? post.likes : Object.keys(post.likes || {});
  const liked    = App.currentUser && likesArr.includes(App.currentUser.uid);
  const commentCount = Array.isArray(post.comments) ? post.comments.length : Object.keys(post.comments || {}).length;
  const div = el('div', 'post fade-in');
  div.dataset.postId = post.id;

  const badges = (author.badges || []).map(b => badgeHTML(b)).join(' ');
  div.innerHTML = `
    <div class="post-header">
      ${avatarHTML(author)}
      <div class="post-meta">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="post-author">${esc(author.name)}</span>
          ${badges}
        </div>
        <span class="post-time">${timeAgo(post.createdAt)}</span>
      </div>
      ${App.currentUser?.uid === post.uid ? `<button class="btn-icon btn" onclick="deletePost('${esc(post.id)}')" title="Delete post" aria-label="Delete post">🗑</button>` : ''}
    </div>
    <div class="post-body">${esc(post.body)}</div>
    ${post.imageURL ? `<img class="post-image" src="${esc(post.imageURL)}" alt="Post image" loading="lazy">` : ''}
    <div class="post-actions">
      <button class="post-action-btn ${liked ? 'liked' : ''}" onclick="toggleLike('${esc(post.id)}')" aria-label="Like">
        ${liked ? '❤️' : '🤍'} <span class="like-count">${likesArr.length}</span>
      </button>
      <button class="post-action-btn" onclick="toggleComments('${esc(post.id)}')" aria-label="Comments">
        💬 <span>${commentCount}</span>
      </button>
      <button class="post-action-btn" onclick="sharePost('${esc(post.id)}')" aria-label="Share">🔗 Share</button>
    </div>
    <div class="comments-section hidden" id="comments-${post.id}"></div>`;
  return div;
}

function badgeHTML(badge) {
  const map = { founder: '👑 Founder', verified: '✓ Verified', mod: '🛡 Mod' };
  return `<span class="badge badge-${badge}">${map[badge] || badge}</span>`;
}

async function submitPost() {
  if (!App.currentUser) { openAuthModal(); return; }
  const textarea = $('post-textarea');
  const body = textarea.value.trim();
  if (!body) { showToast('Write something first!', 'warning'); return; }
  if (body.length > 500) { showToast('Posts must be under 500 characters.', 'warning'); return; }

  const post = {
    id: `p_${Date.now()}`,
    uid: App.currentUser.uid,
    authorName: App.currentUser.name,
    body,
    imageURL: null,
    likes: [],
    comments: [],
    createdAt: Date.now()
  };
  LocalDB.push('posts', post);
  textarea.value = '';
  renderFeed();
  showToast('Post shared!', 'success');
  addNotification({ type: 'system', text: 'Your post was published.' });
}
function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  LocalDB.remove('posts', postId);
  renderFeed();
  showToast('Post deleted.', 'info');
}

async function toggleLike(postId) {
  if (!App.currentUser) { openAuthModal(); return; }
  if (!App.useLocalFallback) {
    const snap = await App.db.ref(`posts/${postId}/likes/${App.currentUser.uid}`).once('value');
    await toggleLikeFirebase(postId, snap.exists());
    return;
  }
  const posts = LocalDB.get('posts') || [];
  const post  = posts.find(p => p.id === postId);
  if (!post) return;
  const idx = (post.likes || []).indexOf(App.currentUser.uid);
  if (idx === -1) { post.likes.push(App.currentUser.uid); }
  else            { post.likes.splice(idx, 1); }
  LocalDB.update('posts', postId, { likes: post.likes });

  const btn = document.querySelector(`[data-post-id="${postId}"] .post-action-btn`);
  if (btn) {
    const liked = idx === -1;
    btn.classList.toggle('liked', liked);
    btn.innerHTML = `${liked ? '❤️' : '🤍'} <span class="like-count">${post.likes.length}</span>`;
  }
}

function sharePost(postId) {
  const url = `${location.origin}/themidnighthub/?post=${postId}`;
  if (navigator.share) {
    navigator.share({ title: 'The Midnight Hub', url });
  } else {
    navigator.clipboard.writeText(url).then(() => showToast('Link copied!', 'success'));
  }
}

// ── Comments ───────────────────────────────────────────────
function toggleComments(postId) {
  const section = $(`comments-${postId}`);
  if (!section) return;
  const isHidden = section.classList.toggle('hidden');
  if (!isHidden) renderComments(postId, section);
}

function renderComments(postId, container) {
  if (!App.useLocalFallback) { renderCommentsFirebase(postId, container); return; }
  const posts = LocalDB.get('posts') || [];
  const post  = posts.find(p => p.id === postId);
  const comments = post?.comments || [];
  container.innerHTML = '';

  comments.forEach(c => {
    const users  = LocalDB.get('users') || [];
    const author = users.find(u => u.uid === c.uid) || { name: c.authorName || 'Unknown' };
    const div = el('div', 'comment');
    div.innerHTML = `${avatarHTML(author,'avatar-sm')}
      <div class="comment-body">
        <div class="comment-author">${esc(author.name)}</div>
        <div class="comment-text">${esc(c.text)}</div>
      </div>`;
    container.appendChild(div);
  });

  const row = el('div', 'comment-input-row');
  row.innerHTML = `
    <input type="text" class="form-control" placeholder="Write a comment…" id="ci-${postId}" maxlength="300" aria-label="Comment">
    <button class="btn btn-primary btn-sm" onclick="submitComment('${esc(postId)}')">Post</button>`;
  container.appendChild(row);
  const inp = $(`ci-${postId}`);
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitComment(postId); });
}

function renderCommentsFirebase(postId, container) {
  container.innerHTML = '<p class="text-muted" style="font-size:0.85rem;padding:0.25rem 0;">Loading…</p>';
  const ref = App.db.ref(`posts/${postId}/comments`).orderByChild('createdAt');
  const off = () => ref.off();
  App._listeners.push(off);
  ref.on('value', snap => {
    container.innerHTML = '';
    snap.forEach(c => {
      const m   = c.val();
      const div = el('div', 'comment');
      div.innerHTML = `<div class="avatar avatar-sm" style="background:${avatarColor(m.authorName||'?')}">${avatarInitials(m.authorName||'?')}</div>
        <div class="comment-body">
          <div class="comment-author">${esc(m.authorName||'Unknown')}</div>
          <div class="comment-text">${esc(m.text)}</div>
        </div>`;
      container.appendChild(div);
    });
    const row = el('div', 'comment-input-row');
    row.innerHTML = `
      <input type="text" class="form-control" placeholder="Write a comment…" id="ci-${postId}" maxlength="300" aria-label="Comment">
      <button class="btn btn-primary btn-sm" onclick="submitComment('${esc(postId)}')">Post</button>`;
    container.appendChild(row);
    const inp = $(`ci-${postId}`);
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitComment(postId); });
  });
}

async function submitComment(postId) {
  if (!App.currentUser) { openAuthModal(); return; }
  const inp  = $(`ci-${postId}`);
  const text = inp?.value.trim();
  if (!text) return;
  inp.value = '';
  if (!App.useLocalFallback) {
    await submitCommentFirebase(postId, text);
    return;
  }
  const posts = LocalDB.get('posts') || [];
  const post  = posts.find(p => p.id === postId);
  if (!post) return;
  post.comments = post.comments || [];
  const comment = { id: `c_${Date.now()}`, uid: App.currentUser.uid, authorName: App.currentUser.name, text, createdAt: Date.now() };
  post.comments.push(comment);
  LocalDB.update('posts', postId, { comments: post.comments });
  renderComments(postId, $(`comments-${postId}`));
  showToast('Comment posted!', 'success');
}

// ── Image upload (post) ────────────────────────────────────
function triggerImageUpload() {
  if (!App.currentUser) { openAuthModal(); return; }
  $('image-upload-input').click();
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file.', 'warning'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB.', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    App._pendingImage = ev.target.result;
    $('image-preview').src = ev.target.result;
    $('image-preview-wrap').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearImagePreview() {
  App._pendingImage = null;
  $('image-preview').src = '';
  $('image-preview-wrap').classList.add('hidden');
  $('image-upload-input').value = '';
}

async function submitPostWithImage() {
  if (!App.currentUser) { openAuthModal(); return; }
  const body = $('post-textarea').value.trim();
  if (!body && !App._pendingImage) { showToast('Write something or add an image.', 'warning'); return; }
  if (body.length > 500) { showToast('Posts must be under 500 characters.', 'warning'); return; }

  if (!App.useLocalFallback) {
    try {
      await submitPostFirebase(body, App._pendingImage || null);
      $('post-textarea').value = '';
      clearImagePreview();
      showToast('Post shared!', 'success');
    } catch (err) {
      showToast('Failed to post. Try again.', 'danger');
      console.error(err);
    }
  } else {
    const post = {
      id: `p_${Date.now()}`,
      uid: App.currentUser.uid,
      authorName: App.currentUser.name,
      body: body || '',
      imageURL: App._pendingImage || null,
      likes: [],
      comments: [],
      createdAt: Date.now()
    };
    LocalDB.push('posts', post);
    $('post-textarea').value = '';
    clearImagePreview();
    renderFeed();
    showToast('Post shared!', 'success');
  }
}

// ── Profile ────────────────────────────────────────────────
async function renderProfile(uid) {
  if (!uid) { if (!App.currentUser) { openAuthModal(); return; } uid = App.currentUser.uid; }
  App.viewingProfile = uid;

  let user, posts = [];

  if (!App.useLocalFallback) {
    const [uSnap, pSnap] = await Promise.all([
      App.db.ref(`users/${uid}`).once('value'),
      App.db.ref('posts').orderByChild('uid').equalTo(uid).once('value')
    ]);
    user = uSnap.val() ? { uid, ...uSnap.val() } : null;
    pSnap.forEach(c => posts.unshift({ id: c.key, ...c.val() }));
  } else {
    const users = LocalDB.get('users') || [];
    user  = users.find(u => u.uid === uid) || App.currentUser;
    posts = (LocalDB.get('posts') || []).filter(p => p.uid === uid);
  }

  if (!user) return;

  const isOwn = App.currentUser?.uid === uid;
  const followers = Array.isArray(user.followers) ? user.followers : Object.keys(user.followers || {});
  const following = Array.isArray(user.following) ? user.following : Object.keys(user.following || {});
  const isFollowing = App.currentUser && followers.includes(App.currentUser.uid);
  const profileEl = $('page-profile');

  profileEl.innerHTML = `
    <div class="card card-flush" style="margin-bottom:1rem;">
      <div class="profile-banner"></div>
      <div class="profile-info">
        <div class="profile-avatar-wrap">
          <div class="avatar avatar-xl" id="profile-avatar" style="background:${avatarColor(user.name)}">
            ${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="${esc(user.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : avatarInitials(user.name)}
          </div>
          ${isOwn ? `<button class="profile-edit-avatar" onclick="$('profile-photo-input').click()" aria-label="Change avatar">📷</button>
            <input type="file" id="profile-photo-input" accept="image/*" class="hidden" onchange="handleProfilePhoto(event)">` : ''}
        </div>
        <div class="flex items-center gap-1 flex-wrap" style="margin-bottom:0.3rem;">
          <div class="profile-name">${esc(user.name)}</div>
          ${(user.badges||[]).map(b => badgeHTML(b)).join('')}
        </div>
        <div class="profile-handle">${esc(user.handle||'')}</div>
        <div class="profile-bio">${esc(user.bio || 'No bio yet.')}</div>
        <div class="profile-stats">
          <div class="stat"><div class="stat-value">${posts.length}</div><div class="stat-label">Posts</div></div>
          <div class="stat"><div class="stat-value">${followers.length}</div><div class="stat-label">Followers</div></div>
          <div class="stat"><div class="stat-value">${following.length}</div><div class="stat-label">Following</div></div>
        </div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
          ${isOwn
            ? `<button class="btn btn-ghost btn-sm" onclick="openEditProfile()">✏️ Edit Profile</button>`
            : App.currentUser
              ? `<button class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="toggleFollow('${uid}')">${isFollowing ? 'Unfollow' : 'Follow'}</button>
                 <button class="btn btn-ghost btn-sm" onclick="openDM('${uid}')">💬 Message</button>`
              : `<button class="btn btn-primary btn-sm" onclick="openAuthModal()">Follow</button>`}
        </div>
      </div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" onclick="showProfileTab('posts',this)">Posts</button>
      <button class="profile-tab" onclick="showProfileTab('liked',this)">Liked</button>
    </div>
    <div id="profile-posts-tab">
      ${posts.length === 0 ? '<p class="text-muted text-center mt-2">No posts yet.</p>' : ''}
    </div>`;

  const postsTab = profileEl.querySelector('#profile-posts-tab');
  posts.forEach(p => postsTab.appendChild(buildPostEl(p)));
}

function showProfileTab(tab, btn) {
  $$('.profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const uid   = App.viewingProfile;
  const posts = LocalDB.get('posts') || [];
  const container = $('profile-posts-tab');
  if (!container) return;
  container.innerHTML = '';
  const filtered = tab === 'liked'
    ? posts.filter(p => (p.likes||[]).includes(uid))
    : posts.filter(p => p.uid === uid);
  if (filtered.length === 0) container.innerHTML = '<p class="text-muted text-center mt-2">Nothing here yet.</p>';
  else filtered.forEach(p => container.appendChild(buildPostEl(p)));
}

function toggleFollow(targetUid) {
  if (!App.currentUser) { openAuthModal(); return; }
  if (!App.useLocalFallback) { toggleFollowFirebase(targetUid); return; }
  const users = LocalDB.get('users') || [];
  const target  = users.find(u => u.uid === targetUid);
  const current = users.find(u => u.uid === App.currentUser.uid);
  if (!target || !current) return;

  target.followers  = target.followers  || [];
  current.following = current.following || [];

  const idx = target.followers.indexOf(App.currentUser.uid);
  if (idx === -1) {
    target.followers.push(App.currentUser.uid);
    current.following.push(targetUid);
    addNotification({ type: 'follow', text: `You followed ${target.name}.` });
  } else {
    target.followers.splice(idx, 1);
    const fi = current.following.indexOf(targetUid);
    if (fi !== -1) current.following.splice(fi, 1);
  }
  LocalDB.update('users', targetUid, { followers: target.followers });
  LocalDB.update('users', App.currentUser.uid, { following: current.following });
  setCurrentUser({ ...App.currentUser, following: current.following });
  renderProfile(targetUid);
}

async function handleProfilePhoto(e) {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 3 * 1024 * 1024) { showToast('Photo must be under 3 MB.', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const photoURL = ev.target.result;
    if (!App.useLocalFallback) {
      await App.db.ref(`users/${App.currentUser.uid}/photoURL`).set(photoURL);
    } else {
      LocalDB.update('users', App.currentUser.uid, { photoURL });
    }
    setCurrentUser({ ...App.currentUser, photoURL });
    renderProfile(App.currentUser.uid);
    showToast('Profile photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}

// ── Edit Profile modal ─────────────────────────────────────
function openEditProfile() {
  if (!App.currentUser) return;
  const u = App.currentUser;
  $('edit-name').value  = u.name  || '';
  $('edit-bio').value   = u.bio   || '';
  $('edit-handle').value = (u.handle||'').replace('@','');
  $('edit-profile-modal').classList.add('open');
}
function closeEditProfile() { $('edit-profile-modal').classList.remove('open'); }

function saveProfile(e) {
  e.preventDefault();
  const name   = $('edit-name').value.trim();
  const bio    = $('edit-bio').value.trim();
  const handle = '@' + $('edit-handle').value.trim().replace(/[^a-zA-Z0-9_]/g,'').toLowerCase();
  if (!name) { showToast('Name cannot be empty.', 'warning'); return; }

  const updates = { name, bio, handle };
  if (!App.useLocalFallback) {
    saveProfileFirebase(updates).then(() => {
      closeEditProfile();
      renderProfile(App.currentUser.uid);
      showToast('Profile saved!', 'success');
    }).catch(() => showToast('Failed to save. Try again.', 'danger'));
  } else {
    LocalDB.update('users', App.currentUser.uid, updates);
    setCurrentUser({ ...App.currentUser, ...updates });
    closeEditProfile();
    renderProfile(App.currentUser.uid);
    showToast('Profile saved!', 'success');
  }
}

// ── Search ─────────────────────────────────────────────────
function initSearch() {
  const inp = $('search-input');
  if (inp) { inp.focus(); inp.addEventListener('input', debounce(runSearch, 300)); }
  runSearch();
}

async function runSearch() {
  const q = ($('search-input')?.value || '').trim().toLowerCase();
  const filter  = document.querySelector('#page-search .filter-chip.active')?.dataset?.filter || 'all';
  const results = $('search-results');
  if (!results) return;
  results.innerHTML = '';

  if (!q) { results.innerHTML = '<p class="text-muted text-center mt-2">Search for people or posts…</p>'; return; }

  let users = [], posts = [];

  if (!App.useLocalFallback) {
    // Firebase: load all users and posts then filter client-side
    // (for a small community this is fine; swap to server-side search later)
    const [uSnap, pSnap] = await Promise.all([
      App.db.ref('users').once('value'),
      App.db.ref('posts').once('value')
    ]);
    uSnap.forEach(c => users.push({ uid: c.key, ...c.val() }));
    pSnap.forEach(c => posts.push({ id:  c.key, ...c.val() }));
  } else {
    users = LocalDB.get('users') || [];
    posts = LocalDB.get('posts') || [];
  }

  if (filter === 'all' || filter === 'people') {
    users.filter(u => u.name?.toLowerCase().includes(q) || u.handle?.toLowerCase().includes(q))
         .forEach(u => results.appendChild(buildUserCard(u)));
  }

  if (filter === 'all' || filter === 'posts') {
    posts.filter(p => p.body?.toLowerCase().includes(q))
         .forEach(p => results.appendChild(buildPostEl(p)));
  }

  if (results.children.length === 0)
    results.innerHTML = `<p class="text-muted text-center mt-2">No results for "<strong>${esc(q)}</strong>"</p>`;
}

function buildUserCard(user) {
  const followers   = Array.isArray(user.followers) ? user.followers : Object.keys(user.followers || {});
  const isFollowing = App.currentUser && followers.includes(App.currentUser.uid);
  const div = el('div', 'card flex items-center gap-2', `
    ${avatarHTML(user)}
    <div style="flex:1;min-width:0;">
      <div class="flex items-center gap-1 flex-wrap">
        <strong>${esc(user.name)}</strong>
        ${(user.badges||[]).map(b => badgeHTML(b)).join('')}
      </div>
      <small class="text-muted">${esc(user.handle||'')}</small>
    </div>
    ${App.currentUser?.uid !== user.uid
      ? `<button class="btn btn-sm ${isFollowing ? 'btn-ghost' : 'btn-primary'}" onclick="toggleFollow('${esc(user.uid)}')">${isFollowing ? 'Unfollow' : 'Follow'}</button>`
      : ''}
  `);
  div.style.cursor = 'pointer';
  div.style.marginBottom = '0.5rem';
  div.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') navigate('profile', { uid: user.uid }); });
  return div;
}

function setSearchFilter(chip) {
  $$('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  runSearch();
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ── Messaging ──────────────────────────────────────────────
function renderConvoList() {
  if (!App.useLocalFallback) { renderConvoListFirebase(); return; }
  if (!App.currentUser) { $('convo-list').innerHTML = '<p class="text-muted" style="padding:1rem;">Sign in to view messages.</p>'; return; }
  const convos = LocalDB.get('convos') || [];
  const myConvos = convos.filter(c => c.participants.includes(App.currentUser.uid));
  const list = $('convo-list');
  if (!list) return;
  list.innerHTML = '';

  if (myConvos.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem;font-size:0.88rem;">No conversations yet.</p>';
    return;
  }
  const users = LocalDB.get('users') || [];
  myConvos.forEach(c => {
    const otherId = c.participants.find(p => p !== App.currentUser.uid);
    const other   = users.find(u => u.uid === otherId) || { name: 'Unknown', uid: otherId };
    const last    = c.messages?.[c.messages.length-1];
    const div = el('div', `convo-item ${App.activeConvo === c.id ? 'active' : ''}`, `
      ${avatarHTML(other)}
      <div class="convo-meta">
        <div class="convo-name">${esc(other.name)}</div>
        <div class="convo-preview truncate">${esc(last?.text || 'Start a conversation')}</div>
      </div>`);
    div.addEventListener('click', () => openConvo(c.id, other));
    list.appendChild(div);
  });
}

function openDM(targetUid) {
  if (!App.useLocalFallback) { openDMFirebase(targetUid); return; }
  if (!App.currentUser) { openAuthModal(); return; }
  const convos = LocalDB.get('convos') || [];
  let convo = convos.find(c => c.participants.includes(App.currentUser.uid) && c.participants.includes(targetUid));
  if (!convo) {
    convo = { id: `conv_${Date.now()}`, participants: [App.currentUser.uid, targetUid], messages: [], createdAt: Date.now() };
    convos.push(convo);
    LocalDB.set('convos', convos);
  }
  navigate('messages');
  const users = LocalDB.get('users') || [];
  const other = users.find(u => u.uid === targetUid) || { name: 'Unknown', uid: targetUid };
  openConvo(convo.id, other);
}

function openConvo(convoId, other) {
  App.activeConvo = convoId;
  renderConvoList();
  const chatArea = $('chat-area');
  if (!chatArea) return;

  const convos = LocalDB.get('convos') || [];
  const convo  = convos.find(c => c.id === convoId);

  chatArea.innerHTML = `
    <div class="chat-header card" style="border-radius:0;border-left:0;border-right:0;border-top:0;padding:0.85rem 1rem;display:flex;align-items:center;gap:0.75rem;">
      ${avatarHTML(other)}
      <strong>${esc(other.name)}</strong>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-bar">
      <input class="form-control" id="chat-input" placeholder="Message ${esc(other.name)}…" maxlength="1000" aria-label="Message">
      <button class="btn btn-primary" onclick="sendMessage('${esc(convoId)}')">Send</button>
    </div>`;

  const inp = $('chat-input');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(convoId); });
  renderMessages(convoId);
}

function renderMessages(convoId) {
  const convos  = LocalDB.get('convos') || [];
  const convo   = convos.find(c => c.id === convoId);
  const msgsEl  = $('chat-messages');
  if (!msgsEl || !convo) return;
  msgsEl.innerHTML = '';
  (convo.messages || []).forEach(m => {
    const isMine = m.uid === App.currentUser?.uid;
    const bubble = el('div', `chat-bubble ${isMine ? 'sent' : 'recv'}`, esc(m.text));
    msgsEl.appendChild(bubble);
  });
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function sendMessage(convoId) {
  const inp  = $('chat-input');
  const text = inp?.value.trim();
  if (!text || !App.currentUser) return;
  const convos = LocalDB.get('convos') || [];
  const convo  = convos.find(c => c.id === convoId);
  if (!convo) return;
  convo.messages = convo.messages || [];
  convo.messages.push({ id: `m_${Date.now()}`, uid: App.currentUser.uid, text, createdAt: Date.now() });
  LocalDB.set('convos', convos);
  inp.value = '';
  renderMessages(convoId);
  renderConvoList();
}

// ── Notifications ──────────────────────────────────────────
function addNotification(data) {
  if (!App.useLocalFallback && App.currentUser) {
    addNotificationFirebase(App.currentUser.uid, data);
    return;
  }
  const notif = { id: `n_${Date.now()}`, ...data, read: false, createdAt: Date.now() };
  LocalDB.push('notifs', notif);
  updateNotifBadge();
}

function updateNotifBadge() {
  if (!App.useLocalFallback) return; // Firebase listener handles this
  const notifs = LocalDB.get('notifs') || [];
  const unread = notifs.filter(n => !n.read).length;
  App.unreadNotifs = unread;
  const badge = $('notif-badge');
  if (badge) badge.classList.toggle('hidden', unread === 0);
}

function toggleNotifPanel() {
  const panel = $('notif-panel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderNotifications();
}

function renderNotifications() {
  if (!App.useLocalFallback) { renderNotifsFirebase(); return; }
  if (!App.currentUser) return;
  const notifs  = LocalDB.get('notifs') || [];
  const list    = $('notif-list');
  if (!list) return;
  list.innerHTML = '';

  notifs.forEach(n => n.read = true);
  LocalDB.set('notifs', notifs);
  updateNotifBadge();

  if (notifs.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem;font-size:0.88rem;">No notifications yet.</p>';
    return;
  }
  notifs.slice(0, 30).forEach(n => {
    const icons = { follow: '👤', like: '❤️', comment: '💬', system: '🔔', message: '✉️' };
    const div = el('div', 'notif-item', `
      <span style="font-size:1.3rem;">${icons[n.type]||'🔔'}</span>
      <div>
        <div class="notif-text">${esc(n.text)}</div>
        <div class="notif-time">${timeAgo(n.createdAt)}</div>
      </div>`);
    list.appendChild(div);
  });
}

// ── Settings ───────────────────────────────────────────────
function renderSettings() {
  const prefs = LocalDB.get('prefs') || {};
  const darkToggle = $('setting-dark');
  if (darkToggle) darkToggle.checked = prefs.darkMode !== false; // default dark
  const notifToggle = $('setting-notifs');
  if (notifToggle) notifToggle.checked = prefs.notifs !== false;
}

function saveSetting(key, value) {
  const prefs = LocalDB.get('prefs') || {};
  prefs[key] = value;
  LocalDB.set('prefs', prefs);
  if (key === 'darkMode') applyDarkMode(value);
  showToast('Setting saved.', 'success');
}

function applyDarkMode(enabled) {
  // App is dark-first; toggling adds a light-mode class
  document.body.classList.toggle('light-mode', !enabled);
}

function clearAllData() {
  if (!confirm('This will clear all local data. Are you sure?')) return;
  ['posts','users','convos','notifs','prefs','currentUser'].forEach(k => localStorage.removeItem(`mh_${k}`));
  App.currentUser = null;
  updateAuthUI();
  navigate('feed');
  showToast('All data cleared.', 'info');
}

// ── PWA Install ────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  App.deferredInstallPrompt = e;
  const banner = $('install-banner');
  if (banner) banner.classList.remove('hidden');
});

async function installPWA() {
  if (!App.deferredInstallPrompt) return;
  App.deferredInstallPrompt.prompt();
  const { outcome } = await App.deferredInstallPrompt.userChoice;
  App.deferredInstallPrompt = null;
  $('install-banner')?.classList.add('hidden');
  if (outcome === 'accepted') showToast('App installed! Find it on your home screen.', 'success');
}

window.addEventListener('appinstalled', () => {
  $('install-banner')?.classList.add('hidden');
  App.deferredInstallPrompt = null;
});

// ── Firebase bootstrap ─────────────────────────────────────
function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      console.warn('[Firebase] SDK not loaded — running in local fallback mode.');
      return false;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    App.fbApp = firebase.app();
    App.auth  = firebase.auth();
    App.db    = firebase.database();
    App.useLocalFallback = false;
    console.log('[Firebase] Initialised ✓');
    return true;

  } catch (err) {
    console.warn('[Firebase] Init error — local fallback mode.', err);
    return false;
  }
}

// ── Firebase: real-time feed listener ─────────────────────
function listenToFeed() {
  if (App.useLocalFallback || !App.db) return;
  const ref = App.db.ref('posts').orderByChild('createdAt').limitToLast(50);
  const off = () => ref.off();
  App._listeners.push(off);
  ref.on('value', snap => {
    const feed = $('feed-posts');
    if (!feed || App.currentPage !== 'feed') return;
    feed.innerHTML = '';
    const posts = [];
    snap.forEach(child => posts.unshift({ id: child.key, ...child.val() }));
    if (posts.length === 0) {
      feed.innerHTML = '<p class="text-muted text-center mt-2">No posts yet. Be the first!</p>';
      return;
    }
    posts.forEach(p => feed.appendChild(buildPostEl(p)));
  });
}

// ── Firebase: notifications listener ──────────────────────
function listenToNotifs() {
  if (App.useLocalFallback || !App.db || !App.currentUser) return;
  const ref = App.db.ref(`notifs/${App.currentUser.uid}`).orderByChild('createdAt').limitToLast(30);
  const off = () => ref.off();
  App._listeners.push(off);
  ref.on('value', snap => {
    let unread = 0;
    snap.forEach(child => { if (!child.val().read) unread++; });
    App.unreadNotifs = unread;
    const badge = $('notif-badge');
    if (badge) badge.classList.toggle('hidden', unread === 0);
  });
}

// ── Firebase: submit post ──────────────────────────────────
async function submitPostFirebase(body, imageURL) {
  const post = {
    uid:        App.currentUser.uid,
    authorName: App.currentUser.name,
    body:       body || '',
    imageURL:   imageURL || null,
    likes:      {},
    comments:   {},
    createdAt:  Date.now()
  };
  await App.db.ref('posts').push(post);
}

// ── Firebase: toggle like ──────────────────────────────────
async function toggleLikeFirebase(postId, liked) {
  const likeRef = App.db.ref(`posts/${postId}/likes/${App.currentUser.uid}`);
  if (liked) await likeRef.remove();
  else       await likeRef.set(true);
}

// ── Firebase: submit comment ───────────────────────────────
async function submitCommentFirebase(postId, text) {
  const comment = {
    uid:        App.currentUser.uid,
    authorName: App.currentUser.name,
    text,
    createdAt:  Date.now()
  };
  await App.db.ref(`posts/${postId}/comments`).push(comment);
}

// ── Firebase: send message ─────────────────────────────────
async function sendMessageFirebase(convoId, text) {
  const msg = { uid: App.currentUser.uid, text, createdAt: Date.now() };
  await App.db.ref(`convos/${convoId}/messages`).push(msg);
  await App.db.ref(`convos/${convoId}/lastMessage`).set({ text, updatedAt: Date.now() });
}

// ── Firebase: add notification ─────────────────────────────
async function addNotificationFirebase(targetUid, data) {
  const notif = { ...data, read: false, createdAt: Date.now() };
  await App.db.ref(`notifs/${targetUid}`).push(notif);
}

// ── Firebase: toggle follow ────────────────────────────────
async function toggleFollowFirebase(targetUid) {
  const myUid   = App.currentUser.uid;
  const follRef = App.db.ref(`users/${targetUid}/followers/${myUid}`);
  const follSnap = await follRef.once('value');
  if (follSnap.exists()) {
    await follRef.remove();
    await App.db.ref(`users/${myUid}/following/${targetUid}`).remove();
  } else {
    await follRef.set(true);
    await App.db.ref(`users/${myUid}/following/${targetUid}`).set(true);
    const target = (await App.db.ref(`users/${targetUid}`).once('value')).val();
    await addNotificationFirebase(targetUid, { type: 'follow', text: `${App.currentUser.name} followed you.` });
  }
  // Refresh profile
  const snap = await App.db.ref(`users/${myUid}`).once('value');
  setCurrentUser({ ...snap.val(), uid: myUid });
  renderProfile(targetUid);
}

// ── Firebase: save profile ─────────────────────────────────
async function saveProfileFirebase(updates) {
  await App.db.ref(`users/${App.currentUser.uid}`).update(updates);
  setCurrentUser({ ...App.currentUser, ...updates });
}

// ── Firebase: render feed (one-time load) ─────────────────
async function renderFeedFirebase() {
  const feed = $('feed-posts');
  if (!feed) return;
  feed.innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:0.75rem;"></div>'.repeat(3);
  const snap  = await App.db.ref('posts').orderByChild('createdAt').limitToLast(50).once('value');
  feed.innerHTML = '';
  const posts = [];
  snap.forEach(child => posts.unshift({ id: child.key, ...child.val() }));
  if (posts.length === 0) { feed.innerHTML = '<p class="text-muted text-center mt-2">No posts yet. Be the first!</p>'; return; }
  posts.forEach(p => feed.appendChild(buildPostEl(p)));
}

// ── Firebase: render notifications ────────────────────────
async function renderNotifsFirebase() {
  if (!App.currentUser) return;
  const snap   = await App.db.ref(`notifs/${App.currentUser.uid}`).orderByChild('createdAt').limitToLast(30).once('value');
  const list   = $('notif-list');
  const listPg = $('notif-list-page');
  const notifs = [];
  snap.forEach(c => notifs.unshift({ id: c.key, ...c.val() }));

  // Mark all read
  const updates = {};
  notifs.forEach(n => { updates[`notifs/${App.currentUser.uid}/${n.id}/read`] = true; });
  if (Object.keys(updates).length) App.db.ref().update(updates);

  const html = notifs.length === 0
    ? '<p class="text-muted" style="padding:1rem;font-size:0.88rem;">No notifications yet.</p>'
    : notifs.map(n => {
        const icons = { follow:'👤', like:'❤️', comment:'💬', system:'🔔', message:'✉️' };
        return `<div class="notif-item">
          <span style="font-size:1.3rem;">${icons[n.type]||'🔔'}</span>
          <div><div class="notif-text">${esc(n.text)}</div>
          <div class="notif-time">${timeAgo(n.createdAt)}</div></div></div>`;
      }).join('');

  if (list)   list.innerHTML   = html;
  if (listPg) listPg.innerHTML = html;
  App.unreadNotifs = 0;
  $('notif-badge')?.classList.add('hidden');
}

// ── Firebase: render convo list ────────────────────────────
async function renderConvoListFirebase() {
  if (!App.currentUser) return;
  const snap   = await App.db.ref('convos')
    .orderByChild(`participants/${App.currentUser.uid}`).equalTo(true).once('value');
  const list   = $('convo-list');
  if (!list) return;
  list.innerHTML = '';

  const convos = [];
  snap.forEach(c => convos.push({ id: c.key, ...c.val() }));

  if (convos.length === 0) {
    list.innerHTML = '<p class="text-muted" style="padding:1rem;font-size:0.88rem;">No conversations yet.</p>';
    return;
  }

  for (const c of convos) {
    const otherId = Object.keys(c.participants || {}).find(uid => uid !== App.currentUser.uid);
    const uSnap   = await App.db.ref(`users/${otherId}`).once('value');
    const other   = uSnap.val() || { name: 'Unknown', uid: otherId };
    const lastMsg = c.lastMessage?.text || 'Start a conversation';
    const div = el('div', `convo-item ${App.activeConvo === c.id ? 'active' : ''}`, `
      ${avatarHTML(other)}
      <div class="convo-meta">
        <div class="convo-name">${esc(other.name)}</div>
        <div class="convo-preview truncate">${esc(lastMsg)}</div>
      </div>`);
    div.addEventListener('click', () => openConvoFirebase(c.id, other));
    list.appendChild(div);
  }
}

// ── Firebase: open DM ──────────────────────────────────────
async function openDMFirebase(targetUid) {
  if (!App.currentUser) { openAuthModal(); return; }
  // Look for existing convo
  const snap = await App.db.ref('convos').once('value');
  let convoId = null;
  snap.forEach(c => {
    const p = c.val().participants || {};
    if (p[App.currentUser.uid] && p[targetUid]) convoId = c.key;
  });
  if (!convoId) {
    const ref = App.db.ref('convos').push();
    convoId   = ref.key;
    await ref.set({ participants: { [App.currentUser.uid]: true, [targetUid]: true }, createdAt: Date.now() });
  }
  const uSnap = await App.db.ref(`users/${targetUid}`).once('value');
  const other = uSnap.val() || { name: 'Unknown', uid: targetUid };
  navigate('messages');
  openConvoFirebase(convoId, other);
}

function openConvoFirebase(convoId, other) {
  App.activeConvo = convoId;
  renderConvoListFirebase();
  const chatArea = $('chat-area');
  if (!chatArea) return;

  chatArea.innerHTML = `
    <div class="chat-header card" style="border-radius:0;border-left:0;border-right:0;border-top:0;padding:0.85rem 1rem;display:flex;align-items:center;gap:0.75rem;">
      ${avatarHTML(other)}<strong>${esc(other.name)}</strong>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-bar">
      <input class="form-control" id="chat-input" placeholder="Message ${esc(other.name)}…" maxlength="1000" aria-label="Message">
      <button class="btn btn-primary" onclick="sendMessageHandler('${esc(convoId)}')">Send</button>
    </div>`;

  const inp = $('chat-input');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessageHandler(convoId); });

  // Real-time messages
  const ref = App.db.ref(`convos/${convoId}/messages`).orderByChild('createdAt').limitToLast(100);
  const off = () => ref.off();
  App._listeners.push(off);
  ref.on('value', snap => {
    const msgsEl = $('chat-messages');
    if (!msgsEl) return;
    msgsEl.innerHTML = '';
    snap.forEach(c => {
      const m      = c.val();
      const isMine = m.uid === App.currentUser?.uid;
      msgsEl.appendChild(el('div', `chat-bubble ${isMine ? 'sent' : 'recv'}`, esc(m.text)));
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  });
}

// ── Unified send message handler ───────────────────────────
async function sendMessageHandler(convoId) {
  const inp  = $('chat-input');
  const text = inp?.value.trim();
  if (!text || !App.currentUser) return;
  inp.value = '';
  if (!App.useLocalFallback) {
    await sendMessageFirebase(convoId, text);
  } else {
    sendMessage(convoId);
  }
}

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/themidnighthub/sw.js')
        .then(reg => {
          console.log('[SW] Registered:', reg.scope);
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('Update available — refresh to get the latest version.', 'info', 6000);
              }
            });
          });
        })
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  }
}

// ── Seed data (first-run demo content) ────────────────────
function seedPosts() {
  const existing = LocalDB.get('posts');
  if (existing && existing.length > 0) return existing;
  const founderUid = `u_founder`;
  const users = LocalDB.get('users') || [];
  if (!users.find(u => u.uid === founderUid)) {
    users.push({
      uid: founderUid, name: 'The Midnight Hub', handle: '@midnighthub',
      bio: 'Official account. Welcome to the community 🌙',
      badges: ['founder', 'verified'], photoURL: null,
      followers: [], following: [], createdAt: Date.now() - 86400000
    });
    LocalDB.set('users', users);
  }
  const seedData = [
    { uid: founderUid, authorName: 'The Midnight Hub', body: '🌙 Welcome to The Midnight Hub! A place to connect, share, and explore. Create your account to get started.' },
    { uid: founderUid, authorName: 'The Midnight Hub', body: 'Pro tip: You can share posts, react with likes, leave comments, and message other members directly. Enjoy the community!' },
  ];
  seedData.forEach((d, i) => {
    LocalDB.push('posts', { id: `p_seed_${i}`, ...d, likes: [], comments: [], imageURL: null, createdAt: Date.now() - (seedData.length - i) * 3600000 });
  });
  return LocalDB.get('posts') || [];
}

// ── Keyboard shortcuts ─────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('auth-modal')?.classList.remove('open');
    $('edit-profile-modal')?.classList.remove('open');
    $('notif-panel')?.classList.remove('open');
  }
});

// Close panels when clicking outside
document.addEventListener('click', e => {
  const panel = $('notif-panel');
  if (panel?.classList.contains('open') && !panel.contains(e.target) && !e.target.closest('.notif-btn')) {
    panel.classList.remove('open');
  }
});

// ── Init ───────────────────────────────────────────────────
function init() {
  registerServiceWorker();

  // Restore dark-mode preference early (before any render)
  const prefs = LocalDB.get('prefs') || {};
  if (prefs.darkMode === false) applyDarkMode(false);

  // Wire up static event listeners
  $('login-form-el')?.addEventListener('submit', handleLogin);
  $('register-form-el')?.addEventListener('submit', handleRegister);
  $('edit-profile-form')?.addEventListener('submit', saveProfile);
  $('submit-post-btn')?.addEventListener('click', submitPostWithImage);
  $('image-upload-input')?.addEventListener('change', handleImageUpload);

  const firebaseReady = initFirebase();

  if (firebaseReady) {
    // Show a brief loading state while Firebase resolves auth
    const feed = $('feed-posts');
    if (feed) feed.innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:0.75rem;border-radius:12px;"></div>'.repeat(3);

    // onAuthStateChanged fires once immediately with the restored session (or null)
    App.auth.onAuthStateChanged(async fbUser => {
      if (fbUser) {
        try {
          let snap = await App.db.ref(`users/${fbUser.uid}`).once('value');
          let profile = snap.val();
          if (!profile) {
            profile = {
              uid:       fbUser.uid,
              name:      fbUser.displayName || fbUser.email.split('@')[0],
              email:     fbUser.email,
              handle:    '@' + (fbUser.displayName || 'user').toLowerCase().replace(/\s+/g, '') + Math.floor(Math.random() * 999),
              bio:       '',
              photoURL:  fbUser.photoURL || null,
              badges:    [],
              followers: {},
              following: {},
              createdAt: Date.now()
            };
            await App.db.ref(`users/${fbUser.uid}`).set(profile);
          }
          setCurrentUser({ ...profile, uid: fbUser.uid });
          listenToFeed();
          listenToNotifs();
        } catch (err) {
          console.error('[Auth] Failed to load profile:', err);
          setCurrentUser({ uid: fbUser.uid, name: fbUser.displayName || 'User', email: fbUser.email, badges: [], followers: {}, following: {} });
        }
      } else {
        App.currentUser = null;
        updateAuthUI();
        renderFeed();  // show feed (seed posts visible to guests too)
      }
      // Only navigate on the very first auth state resolution
      if (!App._initDone) {
        App._initDone = true;
        navigate('feed');
      }
    });

  } else {
    // Local fallback mode
    const saved = LocalDB.get('currentUser');
    if (saved) App.currentUser = saved;
    seedPosts();
    updateAuthUI();
    updateNotifBadge();
    navigate('feed');
  }

  console.log('🌙 The Midnight Hub initialised.');
}

document.addEventListener('DOMContentLoaded', init);
