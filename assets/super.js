/* ==========================================================================
   MyStore — portal do super administrador
   ========================================================================== */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { auth, db, firebaseConfigured, CONFIG_ERROR_MESSAGE } from './firebase.js';
import { superAdminEmails } from './firebase-config.js';

const state = {
  user: null,
  stores: [],
  users: [],
  invites: [],
  metrics: {},
  metricsLoaded: false,
  view: 'dashboard',
  search: '',
  filter: 'all',
  loaded: false,
};

const VIEW_HASH = {
  dashboard: '#/visao',
  stores: '#/lojas',
  reports: '#/relatorios',
};

const VIEW_LABEL = {
  dashboard: 'Visão geral',
  stores: 'Lojas e clientes',
  reports: 'Relatórios',
};

const bootScreen = document.getElementById('super-boot');
const loginScreen = document.getElementById('super-login');
const appShell = document.getElementById('super-app');
const contentEl = document.getElementById('super-content');
const loginError = document.getElementById('super-login-error');
const googleButton = document.getElementById('super-google');
const toastRegion = document.getElementById('toast-region');
const modalRoot = document.getElementById('modal-root');
const sidebar = document.getElementById('super-sidebar');
const sidebarBackdrop = document.getElementById('super-backdrop');

const modalStack = [];
let modalSequence = 0;

/* --------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */

function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => replacements[char]);
}

function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="assets/icons.svg#i-${name}"></use></svg>`;
}

function getInitials(name) {
  const parts = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58);
}

function randomId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isAllowedEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  return superAdminEmails.some((item) => String(item || '').trim().toLowerCase() === target);
}

function firebaseErrorMessage(error, fallback = 'Não foi possível concluir a ação.') {
  const code = String((error && error.code) || '');
  const messages = {
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente novamente.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir.',
    'auth/cancelled-popup-request': 'A janela do Google foi fechada antes de concluir.',
    'auth/unauthorized-domain': 'Este endereço ainda não está autorizado no Firebase Authentication. Adicione o domínio em Authentication > Settings > Authorized domains.',
    'auth/operation-not-allowed': 'O login com Google não está ativado no Firebase. Ative o provedor Google em Authentication > Sign-in method.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique sua internet e tente novamente.',
    'auth/email-already-in-use': 'Este e-mail já possui uma conta no Firebase. Use outro e-mail ou envie um link de redefinição de senha.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'permission-denied': 'Sua conta não tem permissão para esta ação. Publique as regras do Firestore atualizadas.',
    'unavailable': 'Não foi possível conectar ao banco de dados. Verifique sua internet.',
  };
  return messages[code] || (error && error.message) || fallback;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let succeeded = false;
  try { succeeded = document.execCommand('copy'); } catch {}
  textarea.remove();
  return succeeded;
}

function showToast(message, type = 'success', duration = 3600) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type === 'error' ? 'error' : 'success'}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon(type === 'error' ? 'alert' : 'check')}</span>
    <p class="toast-message">${escapeHtml(message)}</p>
  `;
  toastRegion.appendChild(toast);
  while (toastRegion.children.length > 3) toastRegion.firstElementChild.remove();
  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 200);
  }, duration);
}

function setButtonLoading(button, loading, label = 'Salvando...') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner btn-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
  } else {
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function syncBodyLock() {
  document.body.style.overflow = modalStack.length ? 'hidden' : '';
}

function openModal(markup, options = {}) {
  const id = ++modalSequence;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal-card ${options.className || ''}" role="dialog" aria-modal="true" tabindex="-1">${markup}</div>`;
  modalRoot.appendChild(backdrop);

  const card = backdrop.firstElementChild;
  const title = card.querySelector('h2');
  if (title) {
    if (!title.id) title.id = `sa-modal-title-${id}`;
    card.setAttribute('aria-labelledby', title.id);
  }

  const previouslyFocused = document.activeElement;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    const index = modalStack.findIndex((entry) => entry.root === backdrop);
    if (index > -1) modalStack.splice(index, 1);
    backdrop.remove();
    syncBodyLock();
    if (previousFocusedValid(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    if (typeof options.onClose === 'function') options.onClose();
  }

  const entry = { root: backdrop, card, close };
  modalStack.push(entry);
  syncBodyLock();

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop && !options.staticBackdrop) close();
  });
  card.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', close);
  });

  document.addEventListener('keydown', function onKeydown(event) {
    if (!document.contains(backdrop)) {
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  window.requestAnimationFrame(() => {
    const target = card.querySelector('[data-autofocus]')
      || card.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])');
    if (target) target.focus({ preventScroll: true });
  });

  return entry;
}

function previousFocusedValid(element) {
  return element && typeof element.focus === 'function' && document.contains(element);
}

function closeAllModals() {
  while (modalStack.length) modalStack[modalStack.length - 1].close();
}

function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    let modal;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (modal) modal.close();
    };
    modal = openModal(`
      <button class="icon-btn modal-floating-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
      <div class="confirm-body">
        <span class="confirm-icon">${icon(danger ? 'trash' : 'alert')}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer confirm-footer">
        <button class="btn btn-secondary" type="button" data-confirm-cancel data-autofocus>${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
      </div>
    `, {
      className: 'modal-sm',
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    modal.root.querySelector('[data-confirm-cancel]').addEventListener('click', () => finish(false));
    modal.root.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
  });
}

/* --------------------------------------------------------------------------
   Sessão
   -------------------------------------------------------------------------- */

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

function showLogin(message = '') {
  closeAllModals();
  loginScreen.classList.remove('is-hidden');
  appShell.classList.add('is-hidden');
  hideBoot();
  if (message) showLoginError(message);
  else loginError.hidden = true;
  if (googleButton) googleButton.disabled = !firebaseConfigured;
  document.title = 'MyStore — Portal do super administrador';
}

function showApp() {
  loginScreen.classList.add('is-hidden');
  appShell.classList.remove('is-hidden');
  hideBoot();
}

function hideBoot() {
  bootScreen.classList.add('is-hidden');
  if (typeof window.__mystoreBooted === 'function') window.__mystoreBooted();
}

async function handleGoogleLogin() {
  if (!firebaseConfigured) {
    showLoginError(CONFIG_ERROR_MESSAGE);
    return;
  }

  loginError.hidden = true;
  setButtonLoading(googleButton, true, 'Conectando...');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = String((error && error.code) || '');
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        showLoginError(firebaseErrorMessage(redirectError, 'Não foi possível entrar com o Google.'));
        return;
      }
    }
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      showLoginError(firebaseErrorMessage(error, 'Não foi possível entrar com o Google.'));
    }
  } finally {
    setButtonLoading(googleButton, false);
  }
}

async function handleLogout() {
  closeAllModals();
  state.stores = [];
  state.users = [];
  state.invites = [];
  state.metrics = {};
  state.metricsLoaded = false;
  state.loaded = false;
  try { await signOut(auth); } catch {}
}

/* --------------------------------------------------------------------------
   Dados
   -------------------------------------------------------------------------- */

function usersByStore() {
  const map = new Map();
  state.users.forEach((user) => {
    if (user.storeId && !map.has(user.storeId)) map.set(user.storeId, user);
  });
  return map;
}

function invitesByStore() {
  const map = new Map();
  state.invites.forEach((invite) => {
    if (invite.storeId && !map.has(invite.storeId)) map.set(invite.storeId, invite);
  });
  return map;
}

function storeMetrics(storeId) {
  return state.metrics[storeId] || { products: null, catalogs: null };
}

async function loadData() {
  const [storesSnap, usersSnap, invitesSnap] = await Promise.all([
    getDocs(collection(db, 'stores')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'storeInvites')),
  ]);

  state.stores = storesSnap.docs
    .map((storeDoc) => {
      const data = storeDoc.data() || {};
      return {
        id: storeDoc.id,
        name: data.name || 'Loja sem nome',
        logo: data.logoUrl || '',
        whatsapp: data.whatsapp || '',
        showPrices: data.showPrices !== false,
        status: data.status === 'paused' ? 'paused' : 'active',
        authMode: data.authMode === 'google' ? 'google' : 'password',
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
      };
    })
    .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)));

  state.users = usersSnap.docs.map((userDoc) => {
    const data = userDoc.data() || {};
    return {
      uid: userDoc.id,
      role: data.role || 'client',
      storeId: data.storeId || '',
      name: data.name || '',
      email: data.email || '',
    };
  });

  state.invites = invitesSnap.docs.map((inviteDoc) => {
    const data = inviteDoc.data() || {};
    return {
      id: inviteDoc.id,
      storeId: data.storeId || '',
      email: data.email || inviteDoc.id,
      name: data.name || '',
    };
  });

  state.loaded = true;
  refreshShell();
  renderView();
  loadMetrics();
}

async function loadMetrics() {
  if (!state.stores.length) {
    state.metrics = {};
    state.metricsLoaded = true;
    renderView();
    return;
  }

  const entries = await Promise.allSettled(state.stores.map(async (store) => {
    const [productsCount, catalogsCount] = await Promise.all([
      getCountFromServer(collection(db, 'stores', store.id, 'products')),
      getCountFromServer(collection(db, 'stores', store.id, 'catalogs')),
    ]);
    return [store.id, { products: productsCount.data().count, catalogs: catalogsCount.data().count }];
  }));

  const metrics = {};
  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') metrics[entry.value[0]] = entry.value[1];
  });
  state.metrics = metrics;
  state.metricsLoaded = true;
  renderView();
}

function refreshShell() {
  const countEl = document.getElementById('super-stores-count');
  if (countEl) countEl.textContent = String(state.stores.length);

  const emailEl = document.getElementById('super-email');
  if (emailEl) emailEl.textContent = (state.user && state.user.email) || '—';

  const avatar = document.getElementById('super-avatar');
  if (avatar) avatar.textContent = getInitials((state.user && state.user.email) || 'SA');
}

function totals() {
  const active = state.stores.filter((store) => store.status === 'active').length;
  let products = 0;
  let catalogs = 0;
  state.stores.forEach((store) => {
    const metric = state.metrics[store.id];
    if (metric) {
      products += metric.products || 0;
      catalogs += metric.catalogs || 0;
    }
  });
  return {
    stores: state.stores.length,
    active,
    paused: state.stores.length - active,
    clients: state.users.filter((user) => user.role === 'client').length,
    products,
    catalogs,
  };
}

/* --------------------------------------------------------------------------
   Navegação
   -------------------------------------------------------------------------- */

function getViewFromHash() {
  const entry = Object.entries(VIEW_HASH).find(([, hash]) => hash === window.location.hash);
  return entry ? entry[0] : 'dashboard';
}

function navigateTo(view) {
  if (!VIEW_HASH[view]) return;
  state.view = view;
  if (window.location.hash !== VIEW_HASH[view]) {
    window.history.replaceState(null, '', VIEW_HASH[view]);
  }
  renderView({ scroll: true });
  closeSidebar();
}

function renderView(options = {}) {
  if (!state.loaded) return;

  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  let markup = '';
  if (state.view === 'stores') markup = renderStoresView();
  else if (state.view === 'reports') markup = renderReportsView();
  else markup = renderDashboardView();

  contentEl.innerHTML = markup;
  document.title = `MyStore — ${VIEW_LABEL[state.view] || 'Portal'}`;
  if (options.scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function openSidebar() {
  sidebar.classList.add('is-open');
  sidebarBackdrop.classList.add('is-visible');
}

function closeSidebar() {
  sidebar.classList.remove('is-open');
  sidebarBackdrop.classList.remove('is-visible');
}

/* --------------------------------------------------------------------------
   Visão geral
   -------------------------------------------------------------------------- */

function renderDashboardView() {
  const summary = totals();
  const metricsReady = state.metricsLoaded;

  const statCards = [
    { icon: 'store', tone: '', value: String(summary.stores), label: 'Lojas cadastradas', tag: summary.stores === 1 ? '1 cliente' : `${summary.stores} clientes` },
    { icon: 'check', tone: 'gold', value: String(summary.active), label: 'Lojas ativas', tag: summary.paused ? `${summary.paused} pausada(s)` : 'Todas ativas' },
    { icon: 'box', tone: 'clay', value: metricsReady ? String(summary.products) : '—', label: 'Produtos cadastrados', tag: 'Somando as lojas' },
    { icon: 'link', tone: 'neutral', value: metricsReady ? String(summary.catalogs) : '—', label: 'Catálogos criados', tag: 'Links ativos' },
  ];

  const statsMarkup = statCards.map((stat) => `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-icon ${stat.tone}">${icon(stat.icon)}</span>
        <span class="stat-tag">${escapeHtml(stat.tag)}</span>
      </div>
      <span class="stat-value">${escapeHtml(stat.value)}</span>
      <span class="stat-label">${escapeHtml(stat.label)}</span>
    </article>
  `).join('');

  const recent = state.stores.slice(0, 5);
  const recentRows = recent.map((store) => {
    const client = usersByStore().get(store.id);
    const metric = storeMetrics(store.id);
    return `
      <div class="recent-row">
        <span class="recent-icon">${store.logo ? `<img src="${escapeHtml(store.logo)}" alt="">` : icon('store')}</span>
        <div class="recent-info">
          <strong>${escapeHtml(store.name)}</strong>
          <small>${escapeHtml(client ? (client.name || client.email) : 'Sem cliente vinculado')} · criada em ${escapeHtml(formatDate(store.createdAt))}</small>
        </div>
        <span class="super-store-chip">${icon('box')} ${metric.products == null ? '—' : metric.products}</span>
        <span class="super-store-chip">${icon('link')} ${metric.catalogs == null ? '—' : metric.catalogs}</span>
        <a class="btn btn-sm btn-secondary" href="index.html?loja=${encodeURIComponent(store.id)}">Abrir painel</a>
      </div>
    `;
  }).join('');

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('sparkles')} Portal do super administrador</span>
          <h1>Visão geral</h1>
          <p class="page-subtitle">Cadastre clientes, abra o painel de cada loja e acompanhe o movimento dos catálogos.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" type="button" data-action="view-reports">${icon('list')} Ver relatórios</button>
          <button class="btn btn-primary" type="button" data-action="new-store">${icon('plus')} Nova loja</button>
        </div>
      </div>

      ${!state.stores.length ? `
        <div class="notice">
          ${icon('alert')}
          <span>Nenhuma loja cadastrada ainda. Crie a primeira loja e o acesso do cliente em poucos passos. <a href="#/lojas">Começar agora</a></span>
        </div>
      ` : ''}

      <div class="stats-grid">${statsMarkup}</div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Lojas recentes</h2>
              <p>Últimos clientes cadastrados no portal</p>
            </div>
            <a class="panel-link" href="#/lojas">Ver todas ${icon('arrow-right')}</a>
          </div>
          <div class="panel-body">
            ${recentRows || `
              <div class="panel-empty">
                <strong>Nenhuma loja ainda</strong>
                Cadastre o primeiro cliente para começar a montar catálogos.
              </div>
            `}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Como funciona</h2>
              <p>O fluxo de trabalho do portal</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="recent-row">
              <span class="recent-icon">${icon('plus')}</span>
              <div class="recent-info">
                <strong>1. Cadastre a loja e o cliente</strong>
                <small>Informe o nome da loja e o e-mail Google do cliente.</small>
              </div>
            </div>
            <div class="recent-row">
              <span class="recent-icon">${icon('box')}</span>
              <div class="recent-info">
                <strong>2. O cliente monta o catálogo</strong>
                <small>Ele entra com a própria conta e cadastra produtos e fotos.</small>
              </div>
            </div>
            <div class="recent-row">
              <span class="recent-icon">${icon('link')}</span>
              <div class="recent-info">
                <strong>3. Os pedidos chegam no WhatsApp</strong>
                <small>Compartilhe o link do catálogo com os clientes finais.</small>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Lojas e clientes
   -------------------------------------------------------------------------- */

function filteredStores() {
  const query = state.search.trim().toLowerCase();
  return state.stores.filter((store) => {
    if (state.filter !== 'all' && store.status !== state.filter) return false;
    if (!query) return true;
    const client = usersByStore().get(store.id);
    const invite = invitesByStore().get(store.id);
    const haystack = `${store.name} ${store.id} ${client ? `${client.name} ${client.email}` : ''} ${invite ? invite.email : ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function storeCardMarkup(store) {
  const client = usersByStore().get(store.id);
  const invite = invitesByStore().get(store.id);
  const metric = storeMetrics(store.id);
  const isGoogleMode = store.authMode === 'google';
  const accessLabel = isGoogleMode ? 'Google' : 'E-mail e senha';
  const clientLine = client
    ? `${escapeHtml(client.name || 'Cliente')} · ${escapeHtml(client.email)}`
    : (invite ? `Convite pendente · ${escapeHtml(invite.email)}` : 'Sem cliente vinculado');
  return `
    <article class="super-store-card">
      <div class="super-store-main">
        <span class="super-store-logo">${store.logo ? `<img src="${escapeHtml(store.logo)}" alt="">` : escapeHtml(getInitials(store.name))}</span>
        <div class="super-store-info">
          <h3>${escapeHtml(store.name)}</h3>
          <p>${clientLine}</p>
          <div class="super-store-meta">
            <span class="super-status ${store.status === 'active' ? '' : 'is-paused'}">${store.status === 'active' ? 'Ativa' : 'Pausada'}</span>
            <span class="super-store-chip">${icon(isGoogleMode ? 'users' : 'lock')} ${accessLabel}</span>
            <span class="super-store-chip">${icon('box')} ${metric.products == null ? '—' : `${metric.products} produto${metric.products === 1 ? '' : 's'}`}</span>
            <span class="super-store-chip">${icon('link')} ${metric.catalogs == null ? '—' : `${metric.catalogs} catálogo${metric.catalogs === 1 ? '' : 's'}`}</span>
            <span class="super-store-chip">${icon('clock')} ${escapeHtml(formatDate(store.createdAt))}</span>
          </div>
        </div>
      </div>
      <div class="super-store-actions">
        <a class="btn btn-sm btn-primary" href="index.html?loja=${encodeURIComponent(store.id)}">${icon('arrow-up-right')} Abrir painel</a>
        <button class="btn btn-sm btn-secondary" type="button" data-action="edit-store" data-id="${escapeHtml(store.id)}">${icon('edit')} Editar</button>
        <div class="super-icon-actions">
          ${isGoogleMode ? '' : `<button class="icon-btn" type="button" data-action="reset-password" data-id="${escapeHtml(store.id)}" aria-label="Redefinir a senha de ${escapeHtml(store.name)}">${icon('refresh')}</button>`}
          <button class="icon-btn icon-btn-danger" type="button" data-action="delete-store" data-id="${escapeHtml(store.id)}" aria-label="Excluir a loja ${escapeHtml(store.name)}">${icon('trash')}</button>
        </div>
      </div>
    </article>
  `;
}

function renderStoresView() {
  const stores = filteredStores();

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('store')} Clientes</span>
          <h1>Lojas e clientes</h1>
          <p class="page-subtitle">Cada loja é um cliente diferente, com painel, produtos e link de catálogo próprios.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" type="button" data-action="new-store">${icon('plus')} Nova loja</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-field">
          ${icon('search')}
          <input id="super-search" type="search" placeholder="Buscar por loja, cliente ou e-mail" value="${escapeHtml(state.search)}" autocomplete="off">
        </div>
        <div class="super-filters">
          <button class="super-filter ${state.filter === 'all' ? 'active' : ''}" type="button" data-filter="all">Todas</button>
          <button class="super-filter ${state.filter === 'active' ? 'active' : ''}" type="button" data-filter="active">Ativas</button>
          <button class="super-filter ${state.filter === 'paused' ? 'active' : ''}" type="button" data-filter="paused">Pausadas</button>
        </div>
      </div>

      ${stores.length ? `
        <div class="super-store-list">${stores.map(storeCardMarkup).join('')}</div>
      ` : `
        <div class="empty-state">
          <span class="empty-icon">${icon('store')}</span>
          <h2>${state.stores.length ? 'Nenhuma loja encontrada' : 'Comece cadastrando a primeira loja'}</h2>
          <p>${state.stores.length ? 'Ajuste a busca ou o filtro para encontrar o cliente.' : 'Informe o nome da loja e o e-mail Google do cliente. Ele entra sem senha e monta o próprio catálogo.'}</p>
          <button class="btn btn-primary" type="button" data-action="new-store">${icon('plus')} Nova loja</button>
        </div>
      `}
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Relatórios
   -------------------------------------------------------------------------- */

function monthlySeries(months = 6) {
  const now = new Date();
  const series = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    series.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''),
      count: 0,
    });
  }
  state.stores.forEach((store) => {
    if (!store.createdAt) return;
    const date = new Date(store.createdAt);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const entry = series.find((item) => item.key === key);
    if (entry) entry.count += 1;
  });
  return series;
}

function renderReportsView() {
  const summary = totals();
  const series = monthlySeries();
  const maxCount = Math.max(1, ...series.map((item) => item.count));
  const metricsReady = state.metricsLoaded;

  const chart = series.map((item) => `
    <div class="super-chart-col">
      <span class="super-chart-value">${item.count}</span>
      <span class="super-chart-bar ${item.count ? '' : 'is-empty'}" style="height: ${item.count ? Math.max(10, Math.round((item.count / maxCount) * 140)) : 6}px"></span>
      <span class="super-chart-label">${escapeHtml(item.label)}</span>
    </div>
  `).join('');

  const rows = state.stores.map((store) => {
    const client = usersByStore().get(store.id);
    const metric = storeMetrics(store.id);
    return `
      <tr>
        <td><strong>${escapeHtml(store.name)}</strong><br><span class="super-muted-note">${escapeHtml(store.id)}</span></td>
        <td>${client ? escapeHtml(client.name || 'Cliente') : '—'}<br><span class="super-muted-note">${client ? escapeHtml(client.email) : ''}</span></td>
        <td>${store.authMode === 'google' ? 'Google' : 'E-mail e senha'}</td>
        <td><span class="super-status ${store.status === 'active' ? '' : 'is-paused'}">${store.status === 'active' ? 'Ativa' : 'Pausada'}</span></td>
        <td>${metric.products == null ? '—' : metric.products}</td>
        <td>${metric.catalogs == null ? '—' : metric.catalogs}</td>
        <td>${escapeHtml(formatDate(store.createdAt))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('list')} Relatórios</span>
          <h1>Relatórios</h1>
          <p class="page-subtitle">Acompanhe o crescimento do portal e o volume de produtos e catálogos por loja.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" type="button" data-action="export-csv" ${state.stores.length ? '' : 'disabled'}>${icon('copy')} Exportar CSV</button>
          <button class="btn btn-primary" type="button" data-action="new-store">${icon('plus')} Nova loja</button>
        </div>
      </div>

      <div class="stats-grid">
        <article class="stat-card">
          <div class="stat-top"><span class="stat-icon">${icon('store')}</span><span class="stat-tag">Total</span></div>
          <span class="stat-value">${summary.stores}</span>
          <span class="stat-label">Lojas cadastradas</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-icon gold">${icon('users')}</span><span class="stat-tag">Clientes</span></div>
          <span class="stat-value">${summary.clients}</span>
          <span class="stat-label">Contas de acesso criadas</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-icon clay">${icon('box')}</span><span class="stat-tag">Catálogo</span></div>
          <span class="stat-value">${metricsReady ? summary.products : '—'}</span>
          <span class="stat-label">Produtos somados</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-icon neutral">${icon('link')}</span><span class="stat-tag">Links</span></div>
          <span class="stat-value">${metricsReady ? summary.catalogs : '—'}</span>
          <span class="stat-label">Catálogos somados</span>
        </article>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Novas lojas por mês</h2>
            <p>Últimos ${series.length} meses</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="super-chart">${chart}</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Detalhamento por loja</h2>
            <p>Produtos, catálogos e status de cada cliente</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="super-table-wrap">
            <table class="super-table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Cliente</th>
                  <th>Acesso</th>
                  <th>Status</th>
                  <th>Produtos</th>
                  <th>Catálogos</th>
                  <th>Criada em</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td class="super-table-empty" colspan="7">Nenhuma loja cadastrada ainda.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Cadastro e edição de loja
   -------------------------------------------------------------------------- */

async function buildUniqueStoreId(name) {
  const base = slugify(name) || 'loja';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffix = randomId().replace(/-/g, '').slice(0, 5);
    const candidate = `${base}-${suffix}`.slice(0, 78).replace(/-+$/, '');
    const existing = await getDoc(doc(db, 'stores', candidate));
    if (!existing.exists()) return candidate;
  }
  throw new Error('Não foi possível gerar o endereço da loja. Tente outro nome.');
}

function buildStoreFormMarkup(store) {
  const isEditing = Boolean(store);
  const client = isEditing ? usersByStore().get(store.id) : null;
  const invite = isEditing ? invitesByStore().get(store.id) : null;
  const canEditEmail = isEditing && store.authMode === 'google' && !client;
  const emailValue = client ? client.email : (invite ? invite.email : '');
  const emailHint = !isEditing
    ? 'O cliente entra clicando em "Entrar com Google" usando exatamente este e-mail. Não é preciso senha.'
    : (store.authMode === 'google'
        ? (client ? 'O cliente já entrou com esta conta Google.' : 'Enquanto o cliente não entrar pela primeira vez, você pode corrigir o e-mail.')
        : 'Este cliente entra com e-mail e senha. O e-mail não pode ser alterado.');
  return `
    <div class="modal-header">
      <div>
        <h2>${isEditing ? 'Editar loja' : 'Nova loja'}</h2>
        <p>${isEditing ? 'Atualize os dados do cliente e o status da loja.' : 'Crie a loja e o convite Google do cliente — sem senha.'}</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <form id="sa-store-form" class="modal-content-form">
      <div class="modal-body">
        <p class="form-section-label">Loja</p>
        <div class="form-grid">
          <div class="form-group span-2">
            <label class="field-label" for="sa-store-name">Nome da loja <span class="required-mark">*</span></label>
            <input class="text-input" id="sa-store-name" type="text" maxlength="80" required data-autofocus value="${escapeHtml(isEditing ? store.name : '')}" placeholder="Ex.: Barbearia do João">
            <p class="field-hint" id="sa-slug-hint">${isEditing ? `Endereço: ${escapeHtml(store.id)}` : 'O endereço do catálogo é gerado automaticamente a partir do nome.'}</p>
          </div>
          <div class="form-group">
            <label class="field-label" for="sa-store-whatsapp">WhatsApp de pedidos</label>
            <div class="input-with-icon">
              ${icon('whatsapp')}
              <input class="text-input" id="sa-store-whatsapp" type="tel" inputmode="tel" value="${escapeHtml(isEditing ? store.whatsapp : '')}" placeholder="(11) 99999-9999">
            </div>
          </div>
          <div class="form-group">
            <label class="field-label" for="sa-store-status">Status da loja</label>
            <select class="text-input" id="sa-store-status">
              <option value="active" ${(!isEditing || store.status === 'active') ? 'selected' : ''}>Ativa</option>
              <option value="paused" ${(isEditing && store.status === 'paused') ? 'selected' : ''}>Pausada (bloqueia o acesso do cliente)</option>
            </select>
          </div>
          <div class="form-group span-2">
            <div class="settings-row">
              <div class="settings-row-copy">
                <strong>Exibir valores nos catálogos</strong>
                <p>O cliente também pode mudar esta opção no painel dele.</p>
              </div>
              <label class="switch">
                <input id="sa-store-prices" type="checkbox" ${(!isEditing || store.showPrices) ? 'checked' : ''}>
                <span class="switch-track"></span>
                <span class="sr-only">Exibir valores nos catálogos</span>
              </label>
            </div>
          </div>
        </div>

        <p class="form-section-label">Cliente</p>
        ${!isEditing ? `
          <div class="notice">
            ${icon('users')}
            <span>O cliente entra no painel com a própria conta Google — <strong>sem senha</strong>. Use um e-mail que ele já acessa.</span>
          </div>
        ` : ''}
        <div class="form-grid">
          <div class="form-group">
            <label class="field-label" for="sa-client-name">Nome do cliente <span class="required-mark">*</span></label>
            <input class="text-input" id="sa-client-name" type="text" maxlength="80" required value="${escapeHtml(client ? client.name : (invite && invite.name ? invite.name : ''))}" placeholder="Ex.: João Silva">
          </div>
          <div class="form-group">
            <label class="field-label" for="sa-client-email">E-mail Google do cliente <span class="required-mark">*</span></label>
            <input class="text-input" id="sa-client-email" type="email" autocomplete="off" required ${isEditing && !canEditEmail ? 'disabled' : ''} value="${escapeHtml(emailValue)}" placeholder="cliente@gmail.com">
            <p class="field-hint">${emailHint}</p>
          </div>
        </div>

        <p class="form-error" id="sa-store-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="sa-store-save">${icon('check')} ${isEditing ? 'Salvar alterações' : 'Criar loja e acesso'}</button>
      </div>
    </form>
  `;
}

function openStoreModal(store = null) {
  const isEditing = Boolean(store);
  const modal = openModal(buildStoreFormMarkup(store), { className: 'modal-lg' });
  const form = modal.root.querySelector('#sa-store-form');
  const errorBox = modal.root.querySelector('#sa-store-error');
  const saveButton = modal.root.querySelector('#sa-store-save');
  const nameInput = modal.root.querySelector('#sa-store-name');
  const whatsappInput = modal.root.querySelector('#sa-store-whatsapp');
  const statusInput = modal.root.querySelector('#sa-store-status');
  const pricesInput = modal.root.querySelector('#sa-store-prices');
  const clientNameInput = modal.root.querySelector('#sa-client-name');
  const clientEmailInput = modal.root.querySelector('#sa-client-email');
  const canEditEmail = isEditing && store.authMode === 'google' && !usersByStore().get(store.id);
  let busy = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  nameInput.addEventListener('input', () => {
    errorBox.hidden = true;
    const hint = modal.root.querySelector('#sa-slug-hint');
    if (hint && !isEditing) {
      const preview = slugify(nameInput.value) || 'loja';
      hint.textContent = `O endereço começará com "${preview}-" e termina com um código único.`;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    errorBox.hidden = true;

    const storeName = nameInput.value.trim();
    const clientName = clientNameInput.value.trim();
    const clientEmail = String(clientEmailInput.value || '').trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail);

    if (!storeName) {
      nameInput.focus();
      nameInput.reportValidity();
      return;
    }
    if (!clientName) {
      clientNameInput.focus();
      clientNameInput.reportValidity();
      return;
    }
    if ((!isEditing || canEditEmail) && !emailValid) {
      clientEmailInput.focus();
      clientEmailInput.reportValidity();
      return;
    }

    busy = true;
    setButtonLoading(saveButton, true, isEditing ? 'Salvando...' : 'Criando acesso...');

    const rawWhatsapp = (whatsappInput.value || '').replace(/\D/g, '');
    const whatsapp = normalizeWhatsapp(rawWhatsapp);

    try {
      if (isEditing) {
        const now = new Date().toISOString();
        await setDoc(doc(db, 'stores', store.id), {
          name: storeName,
          whatsapp,
          showPrices: pricesInput.checked,
          status: statusInput.value === 'paused' ? 'paused' : 'active',
          updatedAt: now,
        }, { merge: true });

        const client = usersByStore().get(store.id);
        if (client && clientName) {
          await setDoc(doc(db, 'users', client.uid), { name: clientName, updatedAt: now }, { merge: true });
        }

        if (store.authMode === 'google' && !client) {
          const invite = invitesByStore().get(store.id);
          const currentInviteId = invite ? invite.id : '';
          if (clientEmail !== currentInviteId) {
            const existing = await getDoc(doc(db, 'storeInvites', clientEmail));
            if (existing.exists() && String(existing.data().storeId || '') !== store.id) {
              showError('Este e-mail Google já está convidado para outra loja.');
              return;
            }
            const alreadyLinked = state.users.find((user) => String(user.email || '').toLowerCase() === clientEmail);
            if (alreadyLinked) {
              showError('Este e-mail já está vinculado a uma loja no portal.');
              return;
            }
            await setDoc(doc(db, 'storeInvites', clientEmail), {
              storeId: store.id,
              email: clientEmail,
              name: clientName,
              createdAt: now,
              updatedAt: now,
            }, { merge: true });
            if (currentInviteId) await deleteDoc(doc(db, 'storeInvites', currentInviteId)).catch(() => {});
          } else if (currentInviteId) {
            await setDoc(doc(db, 'storeInvites', currentInviteId), { name: clientName, updatedAt: now }, { merge: true });
          }
        }

        await loadData();
        modal.close();
        showToast('Loja atualizada com sucesso.');
      } else {
        const alreadyLinked = state.users.find((user) => String(user.email || '').toLowerCase() === clientEmail);
        if (alreadyLinked) {
          showError('Este e-mail já está vinculado a uma loja no portal. Use outro e-mail Google.');
          return;
        }
        const existingInvite = await getDoc(doc(db, 'storeInvites', clientEmail));
        if (existingInvite.exists()) {
          showError('Este e-mail Google já está convidado para outra loja.');
          return;
        }

        const storeId = await buildUniqueStoreId(storeName);
        const now = new Date().toISOString();
        const batch = writeBatch(db);
        batch.set(doc(db, 'stores', storeId), {
          name: storeName,
          slug: storeId,
          whatsapp,
          showPrices: pricesInput.checked,
          status: 'active',
          authMode: 'google',
          logoUrl: '',
          logoPath: '',
          createdAt: now,
          updatedAt: now,
        });
        batch.set(doc(db, 'storeInvites', clientEmail), {
          storeId,
          email: clientEmail,
          name: clientName,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();

        await loadData();
        modal.close();
        openCredentialsModal(storeName, clientEmail);
      }
    } catch (error) {
      console.error(error);
      showError(firebaseErrorMessage(error, 'Não foi possível salvar a loja.'));
    } finally {
      busy = false;
      setButtonLoading(saveButton, false);
    }
  });
}

function normalizeWhatsapp(value) {
  let digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.slice(0, 15);
}

function openCredentialsModal(storeName, email) {
  const panelUrl = new URL('index.html', window.location.href).href;
  const modal = openModal(`
    <button class="icon-btn modal-floating-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    <div class="success-body">
      <span class="success-icon">${icon('check')}</span>
      <span class="eyebrow">Loja criada</span>
      <h2>${escapeHtml(storeName)} está pronta!</h2>
      <p>Envie o convite para o cliente. Ele entra no painel clicando em <strong>Entrar com Google</strong> — sem senha.</p>
      <div class="super-credentials">
        <div class="super-credentials-row">
          <span>E-mail Google</span>
          <strong>${escapeHtml(email)}</strong>
        </div>
        <div class="super-credentials-row">
          <span>Endereço do painel</span>
          <strong>${escapeHtml(panelUrl)}</strong>
        </div>
      </div>
      <p class="super-muted-note">Importante: o cliente precisa entrar com esta conta Google exata. Se ele usar outro e-mail, o convite não é reconhecido.</p>
    </div>
    <div class="modal-footer success-footer">
      <button class="btn btn-secondary" type="button" data-copy-credentials>${icon('copy')} Copiar convite</button>
      <button class="btn btn-primary" type="button" data-modal-close>Concluir</button>
    </div>
  `, { className: 'modal-sm' });

  const copyButton = modal.root.querySelector('[data-copy-credentials]');
  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      const copied = await copyText(`Acesso ao painel MyStore\nLoja: ${storeName}\nE-mail Google: ${email}\nEntre em: ${panelUrl}\nClique em "Entrar com Google" e escolha esta conta. Não é preciso senha.`);
      showToast(copied ? 'Convite copiado para a área de transferência.' : 'Não foi possível copiar o convite.', copied ? 'success' : 'error');
    });
  }
}

async function resetClientPassword(store) {
  if (store.authMode === 'google') {
    showToast('Este cliente entra com o Google — não há senha para redefinir.', 'error', 5000);
    return;
  }

  const client = usersByStore().get(store.id);
  if (!client || !client.email) {
    showToast('Esta loja não tem um cliente com e-mail cadastrado.', 'error');
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Enviar redefinição de senha?',
    message: `O Firebase enviará um e-mail para ${client.email} com um link para o cliente criar uma nova senha. O acesso atual continua funcionando até a troca.`,
    confirmLabel: 'Enviar link',
    danger: false,
  });
  if (!confirmed) return;

  try {
    await sendPasswordResetEmail(auth, client.email);
    showToast(`Link de redefinição enviado para ${client.email}.`, 'success', 6000);
  } catch (error) {
    showToast(firebaseErrorMessage(error, 'Não foi possível enviar o link de redefinição.'), 'error');
  }
}

async function deleteStore(store) {
  const client = usersByStore().get(store.id);
  const invite = invitesByStore().get(store.id);
  const accessEmail = client ? client.email : (invite ? invite.email : 'cliente');
  const confirmed = await confirmDialog({
    title: 'Excluir esta loja?',
    message: `Todos os produtos, catálogos e o acesso de ${accessEmail} serão removidos. Os links de catálogo vão parar de funcionar. A conta de acesso continua existindo, mas sem permissão na loja.`,
    confirmLabel: 'Excluir loja',
  });
  if (!confirmed) return;

  try {
    const [productsSnap, pricesSnap, catalogsSnap] = await Promise.all([
      getDocs(collection(db, 'stores', store.id, 'products')),
      getDocs(collection(db, 'stores', store.id, 'productPrices')),
      getDocs(collection(db, 'stores', store.id, 'catalogs')),
    ]);

    const refs = [
      ...productsSnap.docs.map((entry) => entry.ref),
      ...pricesSnap.docs.map((entry) => entry.ref),
      ...catalogsSnap.docs.map((entry) => entry.ref),
    ];

    for (let index = 0; index < refs.length; index += 400) {
      const batch = writeBatch(db);
      refs.slice(index, index + 400).forEach((reference) => batch.delete(reference));
      await batch.commit();
    }

    const userRefs = state.users.filter((user) => user.storeId === store.id).map((user) => doc(db, 'users', user.uid));
    const inviteRefs = state.invites.filter((inviteDoc) => inviteDoc.storeId === store.id).map((inviteDoc) => doc(db, 'storeInvites', inviteDoc.id));
    const finalBatch = writeBatch(db);
    finalBatch.delete(doc(db, 'stores', store.id));
    userRefs.forEach((reference) => finalBatch.delete(reference));
    inviteRefs.forEach((reference) => finalBatch.delete(reference));
    await finalBatch.commit();

    await loadData();
    showToast('Loja excluída do portal.');
  } catch (error) {
    showToast(firebaseErrorMessage(error, 'Não foi possível excluir a loja.'), 'error');
  }
}

/* --------------------------------------------------------------------------
   Relatório em CSV
   -------------------------------------------------------------------------- */

function exportCsv() {
  const header = ['Loja', 'Endereço', 'Cliente', 'E-mail', 'Acesso', 'Status', 'Produtos', 'Catálogos', 'Criada em'];
  const lines = state.stores.map((store) => {
    const client = usersByStore().get(store.id);
    const metric = storeMetrics(store.id);
    return [
      store.name,
      store.id,
      client ? client.name : '',
      client ? client.email : '',
      store.authMode === 'google' ? 'Google' : 'E-mail e senha',
      store.status === 'active' ? 'Ativa' : 'Pausada',
      metric.products == null ? '' : metric.products,
      metric.catalogs == null ? '' : metric.catalogs,
      store.createdAt ? formatDateTime(store.createdAt) : '',
    ];
  });

  const csv = [header, ...lines]
    .map((row) => row.map((value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mystore-loja-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('Relatório exportado em CSV.');
}

/* --------------------------------------------------------------------------
   Eventos
   -------------------------------------------------------------------------- */

function handleContentClick(event) {
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton && contentEl.contains(filterButton)) {
    state.filter = filterButton.dataset.filter || 'all';
    renderView();
    return;
  }

  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) return;
  const insideContent = contentEl.contains(actionElement);
  const insideMobileHeader = Boolean(actionElement.closest('.mobile-header'));
  if (!insideContent && !insideMobileHeader) return;

  const action = actionElement.dataset.action;
  const id = actionElement.dataset.id;

  if (action === 'new-store') {
    openStoreModal();
    return;
  }
  if (action === 'view-reports') {
    navigateTo('reports');
    return;
  }
  if (action === 'edit-store') {
    const store = state.stores.find((item) => item.id === id);
    if (store) openStoreModal(store);
    return;
  }
  if (action === 'reset-password') {
    const store = state.stores.find((item) => item.id === id);
    if (store) resetClientPassword(store);
    return;
  }
  if (action === 'delete-store') {
    const store = state.stores.find((item) => item.id === id);
    if (store) deleteStore(store);
    return;
  }
  if (action === 'export-csv') {
    exportCsv();
  }
}

function init() {
  if (!firebaseConfigured) {
    showLogin(CONFIG_ERROR_MESSAGE);
    googleButton.disabled = true;
    return;
  }

  const allowedEmailEl = document.getElementById('super-allowed-email');
  if (allowedEmailEl && superAdminEmails.length) {
    allowedEmailEl.textContent = superAdminEmails.join(', ');
  }

  googleButton.addEventListener('click', handleGoogleLogin);
  document.getElementById('super-logout').addEventListener('click', handleLogout);
  document.getElementById('super-menu').addEventListener('click', openSidebar);
  document.getElementById('super-sidebar-close').addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      navigateTo(item.dataset.view);
    });
  });

  contentEl.addEventListener('click', handleContentClick);
  document.querySelector('.mobile-header button[data-action="new-store"]')
    ?.addEventListener('click', () => openStoreModal());

  contentEl.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'super-search') {
      state.search = event.target.value;
      renderView();
      const input = document.getElementById('super-search');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });

  window.addEventListener('hashchange', () => {
    state.view = getViewFromHash();
    if (state.loaded) renderView({ scroll: true });
    closeSidebar();
  });

  getRedirectResult(auth).catch((error) => {
    const code = String((error && error.code) || '');
    if (!code || code === 'auth/no-auth-event') return;
    showLogin();
    showLoginError(firebaseErrorMessage(error, 'Não foi possível concluir o login com o Google.'));
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.user = null;
      showLogin();
      return;
    }

    if (!isAllowedEmail(user.email)) {
      state.user = null;
      await signOut(auth).catch(() => {});
      showLogin('Esta conta Google não é o super administrador. Entre com a conta autorizada.');
      return;
    }

    state.user = user;
    state.view = getViewFromHash();
    showApp();
    try {
      await loadData();
    } catch (error) {
      console.error(error);
      showToast(firebaseErrorMessage(error, 'Não foi possível carregar as lojas.'), 'error', 7000);
    }
  });
}

init();
