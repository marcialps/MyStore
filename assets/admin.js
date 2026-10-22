/* ==========================================================================
   MyStore — painel administrativo
   ========================================================================== */

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import {
  auth,
  db,
  storage,
  firebaseConfigured,
  CONFIG_ERROR_MESSAGE,
} from './firebase.js';
import { imageStorageMode, superAdminEmails } from './firebase-config.js';

const state = {
  data: null,
  view: 'overview',
  productSearch: '',
  storeId: '',
};

const VIEW_HASH = {
  overview: '#/visao',
  products: '#/produtos',
  catalogs: '#/catalogos',
  settings: '#/configuracoes',
};

const VIEW_LABEL = {
  overview: 'Visão geral',
  products: 'Produtos',
  catalogs: 'Catálogos',
  settings: 'Configurações',
};

function isSuperAdminEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  return superAdminEmails.some((item) => String(item || '').trim().toLowerCase() === target);
}

function getRequestedStoreId() {
  const value = String(new URLSearchParams(window.location.search).get('loja') || '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(value) ? value : '';
}

const bootScreen = document.getElementById('boot-screen');
const loginScreen = document.getElementById('login-screen');
const adminApp = document.getElementById('admin-app');
const contentEl = document.getElementById('content');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const mobileMenuBtn = document.getElementById('mobile-menu');
const sidebarCloseBtn = document.getElementById('sidebar-close');
const loginForm = document.getElementById('login-form');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const loginSubmit = document.getElementById('login-submit');
const togglePasswordBtn = document.getElementById('toggle-password');
const forgotPasswordBtn = document.getElementById('forgot-password');
const googleLoginBtn = document.getElementById('google-login');
const toastRegion = document.getElementById('toast-region');
const modalRoot = document.getElementById('modal-root');

const modalStack = [];
let modalSequence = 0;
let settingsLogoDraft = { url: '', path: '', dataUrl: '', preview: '' };
let savedIndicatorTimer = null;
let sessionExpiredNotified = false;

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

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatPrice(value) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return currencyFormatter.format(number);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(date)
    .replace(/\.$/, '');
}

function parsePrice(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return NaN;
  let normalized = raw.replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  return Number(normalized);
}

function normalizeSearch(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeWhatsapp(value) {
  let digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.slice(0, 15);
}

function formatWhatsapp(value) {
  const digits = normalizeWhatsapp(value);
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) {
    const local = digits.slice(2, 13);
    if (local.length >= 10) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, local.length - 4)}-${local.slice(-4)}`;
    }
  }
  return `+${digits}`;
}

function getInitials(name) {
  const parts = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ML';
  return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

function getViewFromHash() {
  const entry = Object.entries(VIEW_HASH).find(([, hash]) => hash === window.location.hash);
  return entry ? entry[0] : 'overview';
}

// O link bonito /c/{loja}/{catalogo} depende do rewrite do Firebase Hosting.
// Em GitHub Pages, Live Server e outras hospedagens estáticas usamos o formato
// com query string (catalog.html?loja=...&c=...), resolvido a partir da página
// atual para funcionar também quando o site fica dentro de uma subpasta.
function supportsPrettyCatalogUrls() {
  return /\.(web\.app|firebaseapp\.com)$/i.test(window.location.hostname);
}

function getCatalogUrl(storeId, slug) {
  const store = storeId || state.storeId;
  if (supportsPrettyCatalogUrls()) {
    return `${window.location.origin}/c/${encodeURIComponent(store)}/${encodeURIComponent(slug)}`;
  }
  const url = new URL('catalog.html', window.location.href);
  url.search = '';
  url.searchParams.set('loja', store);
  url.searchParams.set('c', slug);
  return url.href;
}

function storeRef() {
  return doc(db, 'stores', state.storeId);
}

function productsCollection() {
  return collection(db, 'stores', state.storeId, 'products');
}

function pricesCollection() {
  return collection(db, 'stores', state.storeId, 'productPrices');
}

function catalogsCollection() {
  return collection(db, 'stores', state.storeId, 'catalogs');
}

function getFilteredProducts() {
  const query = normalizeSearch(state.productSearch);
  const products = state.data ? state.data.products : [];
  if (!query) return products;
  return products.filter((product) => normalizeSearch(`${product.name} ${product.description || ''}`).includes(query));
}

function getCatalogProductCount(productId) {
  if (!state.data) return 0;
  return state.data.catalogs.filter((catalog) => catalog.productIds.includes(productId)).length;
}

function productImageMarkup(product, options = {}) {
  if (product && product.image) {
    return `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name || 'Produto')}" loading="lazy">`;
  }
  return `<div class="image-placeholder">${icon('image')}<span>Sem foto</span></div>`;
}

function showToast(message, type = 'success', duration = 3400) {
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
    if (!title.id) title.id = `modal-title-${id}`;
    card.setAttribute('aria-labelledby', title.id);
  } else {
    card.setAttribute('aria-label', options.label || 'Janela de diálogo');
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
    if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
      previouslyFocused.focus({ preventScroll: true });
    }
    if (typeof options.onClose === 'function') options.onClose();
  }

  const entry = { root: backdrop, card, close };
  modalStack.push(entry);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop && !options.staticBackdrop) close();
  });
  card.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', close);
  });

  syncBodyLock();

  window.requestAnimationFrame(() => {
    const target = card.querySelector('[data-autofocus]')
      || card.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])');
    if (target) target.focus({ preventScroll: true });
  });

  return entry;
}

function closeAllModals() {
  while (modalStack.length) {
    modalStack[modalStack.length - 1].close();
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {}
  textarea.remove();
  if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
  return succeeded;
}

function confirmDialog({ title, message, confirmLabel = 'Excluir', cancelLabel = 'Cancelar', danger = true }) {
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

function openShareSuccessModal(catalogName, link) {
  const modal = openModal(`
    <button class="icon-btn modal-floating-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    <div class="success-body">
      <span class="success-icon">${icon('check')}</span>
      <span class="eyebrow">Link pronto</span>
      <h2>Catálogo criado!</h2>
      <p>Envie este link para <strong>${escapeHtml(catalogName)}</strong>. O cliente vê apenas os produtos que você selecionou e finaliza o pedido pelo WhatsApp.</p>
      <div class="share-link-box">
        <span>${escapeHtml(link)}</span>
        <button class="btn btn-secondary" type="button" data-share-copy>${icon('copy')} Copiar</button>
      </div>
    </div>
    <div class="modal-footer success-footer">
      <a class="btn btn-secondary" href="${escapeHtml(link)}" target="_blank" rel="noopener">${icon('arrow-up-right')} Abrir catálogo</a>
      <button class="btn btn-primary" type="button" data-share-copy data-autofocus>${icon('copy')} Copiar link</button>
    </div>
  `, { className: 'modal-sm' });

  modal.root.querySelectorAll('[data-share-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const copied = await copyText(link);
      showToast(copied ? 'Link copiado para a área de transferência.' : 'Não foi possível copiar o link.', copied ? 'success' : 'error');
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível processar esta imagem. Tente JPG, PNG ou WebP.'));
    image.src = source;
  });
}

async function compressImage(file, options = {}) {
  let dataUrl = '';
  if (typeof file === 'string' && /^data:image\//.test(file)) {
    dataUrl = file;
  } else {
    if (!file || !String(file.type || '').startsWith('image/')) {
      throw new Error('Escolha um arquivo de imagem.');
    }
    if (file.size > 25 * 1024 * 1024) {
      throw new Error('A imagem é muito grande. Escolha um arquivo de até 25 MB.');
    }
    dataUrl = await readFileAsDataUrl(file);
  }

  const maxSize = options.maxSize || 1400;
  const quality = options.quality || 0.86;
  const keepAlpha = Boolean(options.keepAlpha);
  const image = await loadImageElement(dataUrl);
  const sourceWidth = image.naturalWidth || image.width || 1000;
  const sourceHeight = image.naturalHeight || image.height || 1000;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!keepAlpha) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(keepAlpha ? 'image/webp' : 'image/jpeg', quality);
}

// Reduz a imagem em etapas até caber no orçamento de bytes do documento.
async function fitImageToBudget(dataUrl, options = {}) {
  const budget = options.budget || 400000;
  const keepAlpha = Boolean(options.keepAlpha);
  let current = dataUrl;
  let attemptSize = options.maxSize || 1000;
  let attemptQuality = options.quality || 0.76;

  for (let attempt = 0; attempt < 6 && current.length > budget; attempt += 1) {
    attemptSize = Math.max(240, Math.round(attemptSize * 0.8));
    attemptQuality = Math.max(0.45, attemptQuality - 0.08);
    current = await compressImage(current, {
      maxSize: attemptSize,
      quality: attemptQuality,
      keepAlpha,
    });
  }

  return current.length <= budget ? current : '';
}

async function openCameraModal(onCapture) {
  let stream = null;
  let closed = false;
  let completed = false;

  function stopStream() {
    closed = true;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  const modal = openModal(`
    <div class="modal-header camera-header">
      <div>
        <h2>Tirar foto</h2>
        <p>Enquadre o produto e capture a melhor imagem.</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <div class="modal-body camera-body">
      <div class="camera-stage">
        <div class="camera-loading" id="camera-loading">
          <span class="spinner" aria-hidden="true"></span>
          <span>Conectando à câmera...</span>
        </div>
        <video id="camera-video" autoplay playsinline muted hidden></video>
        <div class="camera-error" id="camera-error" hidden>
          ${icon('camera-off')}
          <strong>Câmera indisponível</strong>
          <span class="camera-error-message">Verifique a permissão do navegador ou use uma foto do dispositivo.</span>
          <button class="btn btn-secondary btn-sm" type="button" id="camera-fallback">Escolher foto do dispositivo</button>
        </div>
      </div>
    </div>
    <div class="modal-footer camera-footer">
      <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
      <button class="capture-btn" type="button" id="camera-capture" disabled>${icon('camera')} Capturar foto</button>
    </div>
    <input type="file" id="camera-fallback-input" accept="image/*" capture="environment" hidden>
  `, {
    className: 'modal-camera',
    onClose: stopStream,
  });

  const video = modal.root.querySelector('#camera-video');
  const captureButton = modal.root.querySelector('#camera-capture');
  const loading = modal.root.querySelector('#camera-loading');
  const errorPanel = modal.root.querySelector('#camera-error');
  const errorMessage = modal.root.querySelector('.camera-error-message');
  const fallbackButton = modal.root.querySelector('#camera-fallback');
  const fallbackInput = modal.root.querySelector('#camera-fallback-input');

  function showCameraError(message) {
    loading.hidden = true;
    video.hidden = true;
    errorPanel.hidden = false;
    captureButton.disabled = true;
    if (message) errorMessage.textContent = message;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError('Seu navegador não permite acessar a câmera. Use uma foto do dispositivo.');
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });

      // O modal pode ter sido fechado enquanto o navegador aguardava a permissão.
      if (closed) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      stream = mediaStream;
      video.srcObject = stream;
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('Falha ao iniciar a câmera.'));
      });
      if (closed) return;
      await video.play();
      if (closed) return;
      loading.hidden = true;
      video.hidden = false;
      errorPanel.hidden = true;
      captureButton.disabled = false;
    } catch (error) {
      if (closed) return;
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      showCameraError(denied
        ? 'A permissão da câmera foi negada. Libere o acesso ou escolha uma foto do dispositivo.'
        : 'Não foi possível acessar a câmera. Use uma foto do dispositivo.');
    }
  }

  captureButton.addEventListener('click', () => {
    if (video.hidden || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Não foi possível capturar a foto.', 'error');
        return;
      }
      const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
      completed = true;
      stopStream();
      modal.close();
      onCapture(file);
    }, 'image/jpeg', 0.92);
  });

  fallbackButton.addEventListener('click', () => fallbackInput.click());
  fallbackInput.addEventListener('change', () => {
    const file = fallbackInput.files && fallbackInput.files[0];
    if (!file) return;
    completed = true;
    stopStream();
    modal.close();
    onCapture(file);
  });

  startCamera();
}

/* --------------------------------------------------------------------------
   Firebase: dados, imagens e sessão
   -------------------------------------------------------------------------- */

const DEFAULT_SETTINGS = {
  storeName: 'Minha Loja',
  logo: '',
  logoPath: '',
  whatsapp: '',
  showPrices: true,
};

function firebaseErrorMessage(error, fallback = 'Não foi possível concluir a ação.') {
  const code = String((error && error.code) || '');
  const messages = {
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique sua internet e tente novamente.',
    'auth/operation-not-allowed': 'Ative o login por e-mail e senha no console do Firebase.',
    'auth/unauthorized-domain': 'Este domínio ainda não está autorizado no Firebase Authentication.',
    'auth/weak-password': 'A nova senha precisa ter pelo menos 6 caracteres.',
    'auth/requires-recent-login': 'Sua sessão está antiga. Saia, entre novamente e repita a alteração.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente novamente.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir.',
    'auth/account-exists-with-different-credential': 'Já existe uma conta com este e-mail usando outro método de acesso. Entre com e-mail e senha.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado no Firebase Authentication.',
    'app/store-paused': 'Esta loja está desativada. Fale com o super administrador.',
    'permission-denied': 'Sua conta não tem permissão para acessar estes dados.',
    'unavailable': 'Não foi possível conectar ao banco de dados. Verifique sua internet.',
    'storage/unauthorized': 'Sua conta não tem permissão para enviar imagens. Publique o storage.rules atualizado no console do Firebase.',
    'storage/canceled': 'O envio da imagem foi cancelado.',
    'storage/retry-limit-exceeded': 'O envio demorou demais. Tente uma imagem menor.',
    'storage/quota-exceeded': 'O limite de armazenamento do Firebase foi atingido.',
    'storage/unknown': 'O Cloud Storage do Firebase não está ativado (ou o bucket configurado não existe). No console do Firebase, abra Storage > Começar e publique o storage.rules.',
    'storage/object-not-found': 'O Cloud Storage do Firebase não está ativado. Abra Storage > Começar no console do Firebase.',
    'storage/bucket-not-found': 'O bucket configurado não existe. Ative o Storage no console do Firebase e confira o storageBucket em firebase-config.js.',
  };
  return messages[code] || (error && error.message) || fallback;
}

function randomId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function slugifyCatalogName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl || '').split(',');
  const match = header.match(/^data:([^;]+);base64$/);
  if (!match || !base64) throw new Error('A imagem processada não pôde ser enviada.');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function uploadImage(dataUrl, folder) {
  if (imageStorageMode === 'storage') {
    const blob = dataUrlToBlob(dataUrl);
    const extension = blob.type === 'image/png' ? 'png' : (blob.type === 'image/webp' ? 'webp' : 'jpg');
    const uid = auth && auth.currentUser ? auth.currentUser.uid : 'anonimo';
    if (!state.storeId) throw new Error('Loja não identificada. Entre novamente.');
    const path = `stores/${state.storeId}/${folder}/${uid}/${Date.now()}-${randomId()}.${extension}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, { contentType: blob.type });
    const url = await getDownloadURL(storageRef);
    return { url, path };
  }

  // Modo Firestore: a imagem comprimida fica dentro do próprio documento,
  // sem depender do Cloud Storage. O data URL precisa caber no limite de 1 MiB.
  const isLogo = folder === 'logo';
  const prepared = await fitImageToBudget(dataUrl, {
    maxSize: isLogo ? 384 : 960,
    quality: isLogo ? 0.84 : 0.72,
    keepAlpha: isLogo,
    budget: isLogo ? 120000 : 260000,
  });
  if (!prepared) {
    throw new Error('A imagem ficou grande demais mesmo depois da compressão. Escolha uma foto menor ou com menos detalhes.');
  }
  return { url: prepared, path: '' };
}

async function removeImage(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (error) {
    // A imagem pode já ter sido removida ou pertencer a uma versão antiga.
    console.warn('Não foi possível remover a imagem antiga:', error);
  }
}

async function loadAdminData(user) {
  const isSuper = isSuperAdminEmail(user && user.email);
  let storeId = '';
  let profile = null;
  let role = 'client';

  if (isSuper) {
    storeId = getRequestedStoreId();
    if (!storeId) {
      const redirect = new Error('Redirecionando para o portal do super administrador.');
      redirect.code = 'app/redirect-portal';
      throw redirect;
    }
    role = 'superadmin';
  } else {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) {
      throw new Error('Sua conta ainda não está vinculada a uma loja. Fale com o super administrador.');
    }
    profile = userSnap.data() || {};
    storeId = String(profile.storeId || '').trim();
    if (!storeId) {
      throw new Error('Sua conta não está vinculada a nenhuma loja. Fale com o super administrador.');
    }
  }

  state.storeId = storeId;

  const [settingsSnap, productsSnap, catalogsSnap, pricesSnap] = await Promise.all([
    getDoc(doc(db, 'stores', storeId)),
    getDocs(collection(db, 'stores', storeId, 'products')),
    getDocs(collection(db, 'stores', storeId, 'catalogs')),
    getDocs(collection(db, 'stores', storeId, 'productPrices')),
  ]);

  if (!settingsSnap.exists()) {
    throw new Error('Loja não encontrada. Confira o link ou fale com o super administrador.');
  }

  const settingsData = settingsSnap.data() || {};
  if (settingsData.status === 'paused' && !isSuper) {
    const paused = new Error('Esta loja está desativada. Fale com o super administrador para reativar o acesso.');
    paused.code = 'app/store-paused';
    throw paused;
  }

  const priceMap = new Map(pricesSnap.docs.map((priceDoc) => {
    const value = Number(priceDoc.data().price);
    return [priceDoc.id, Number.isFinite(value) ? value : null];
  }));

  const products = productsSnap.docs
    .map((productDoc) => {
      const product = productDoc.data();
      return {
        id: productDoc.id,
        name: product.name || '',
        description: product.description || '',
        image: product.imageUrl || '',
        imagePath: product.imagePath || '',
        price: priceMap.has(productDoc.id) ? priceMap.get(productDoc.id) : null,
        createdAt: product.createdAt || '',
        updatedAt: product.updatedAt || '',
      };
    })
    .sort((first, second) => String(second.createdAt || second.updatedAt).localeCompare(String(first.createdAt || first.updatedAt)));

  const catalogs = catalogsSnap.docs
    .map((catalogDoc) => {
      const catalog = catalogDoc.data();
      return {
        id: catalogDoc.id,
        slug: catalogDoc.id,
        name: catalog.name || 'Catálogo',
        productIds: Array.isArray(catalog.productIds) ? catalog.productIds.map(String) : [],
        createdAt: catalog.createdAt || '',
        updatedAt: catalog.updatedAt || '',
      };
    })
    .sort((first, second) => String(second.updatedAt || second.createdAt).localeCompare(String(first.updatedAt || first.createdAt)));

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      storeName: settingsData.name || DEFAULT_SETTINGS.storeName,
      logo: settingsData.logoUrl || '',
      logoPath: settingsData.logoPath || '',
      whatsapp: settingsData.whatsapp || '',
      showPrices: settingsData.showPrices !== false,
      status: settingsData.status || 'active',
    },
    products,
    catalogs,
    auth: {
      email: (user && user.email) || '',
      role,
      isSuperAdmin: isSuper,
      storeId,
      clientName: profile ? (profile.name || '') : '',
    },
  };
}

async function refreshData() {
  if (!auth || !auth.currentUser) {
    handleSessionExpired();
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  try {
    const payload = await loadAdminData(auth.currentUser);
    applyPayload(payload);
    return payload;
  } catch (error) {
    if (String((error && error.code) || '') === 'permission-denied') handleSessionExpired();
    throw error;
  }
}

function handleSessionExpired() {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  closeAllModals();
  state.data = null;
  pendingLoginMessage = 'Sua sessão expirou. Entre novamente.';
  showLogin(pendingLoginMessage);
  if (auth) signOut(auth).catch(() => {});
  window.setTimeout(() => { sessionExpiredNotified = false; }, 1500);
}

function applyPayload(payload) {
  if (!payload) return;
  state.data = {
    products: Array.isArray(payload.products) ? payload.products : [],
    catalogs: Array.isArray(payload.catalogs) ? payload.catalogs : [],
    settings: payload.settings || { ...DEFAULT_SETTINGS },
    auth: payload.auth || { email: '', role: 'client', isSuperAdmin: false, storeId: '' },
  };
  state.storeId = state.data.auth.storeId || state.storeId;
  refreshShell();
}

function refreshShell() {
  if (!state.data) return;
  const settings = state.data.settings;
  const productsCount = state.data.products.length;
  const catalogsCount = state.data.catalogs.length;

  const navProducts = document.getElementById('nav-products-count');
  const navCatalogs = document.getElementById('nav-catalogs-count');
  if (navProducts) navProducts.textContent = String(productsCount);
  if (navCatalogs) navCatalogs.textContent = String(catalogsCount);

  const sidebarName = document.getElementById('sidebar-store-name');
  if (sidebarName) sidebarName.textContent = settings.storeName || 'Minha Loja';

  const avatar = document.getElementById('sidebar-store-avatar');
  if (avatar) {
    if (settings.logo) {
      avatar.innerHTML = `<img src="${escapeHtml(settings.logo)}" alt="">`;
    } else {
      avatar.textContent = getInitials(settings.storeName);
    }
  }

  const portalLink = document.getElementById('portal-link');
  if (portalLink) {
    portalLink.classList.toggle('is-hidden', !(state.data.auth && state.data.auth.isSuperAdmin));
  }

  document.body.classList.toggle('is-super-admin', Boolean(state.data.auth && state.data.auth.isSuperAdmin));
}

function hideBootScreen() {
  bootScreen.classList.add('is-hidden');
  if (typeof window.__mystoreBooted === 'function') window.__mystoreBooted();
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

let pendingLoginMessage = '';

function showLogin(message = '') {
  closeSidebar();
  document.body.style.overflow = '';
  loginScreen.classList.remove('is-hidden');
  adminApp.classList.add('is-hidden');
  hideBootScreen();
  document.title = 'MyStore — Acesso';
  loginPassword.value = '';
  loginPassword.type = 'password';
  togglePasswordBtn.setAttribute('aria-label', 'Mostrar senha');
  togglePasswordBtn.querySelector('use').setAttribute('href', 'assets/icons.svg#i-eye');
  loginEmail.disabled = !firebaseConfigured;
  loginPassword.disabled = !firebaseConfigured;
  loginSubmit.disabled = !firebaseConfigured;
  forgotPasswordBtn.disabled = !firebaseConfigured;
  if (googleLoginBtn) googleLoginBtn.disabled = !firebaseConfigured;
  if (message) showLoginError(message);
  else loginError.hidden = true;
  window.setTimeout(() => {
    if (loginScreen.classList.contains('is-hidden')) return;
    if (loginEmail.value.trim()) loginPassword.focus();
    else loginEmail.focus();
  }, 120);
}

function showApp() {
  loginScreen.classList.add('is-hidden');
  adminApp.classList.remove('is-hidden');
  hideBootScreen();
  state.view = getViewFromHash();
  renderView({ scroll: true });
  document.title = `MyStore — ${VIEW_LABEL[state.view] || 'Painel'}`;
}

// Cliente convidado pelo portal: no primeiro login com Google, cria o vínculo
// users/{uid} a partir do convite storeInvites/{email} e apaga o convite.
async function resolveClientInvite(user) {
  const googleAccount = Array.isArray(user.providerData)
    && user.providerData.some((provider) => provider && provider.providerId === 'google.com');
  if (!googleAccount || !user.email) return;

  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) return;

  const inviteId = String(user.email).trim().toLowerCase();
  const inviteRef = doc(db, 'storeInvites', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return;

  const invite = inviteSnap.data() || {};
  const storeId = String(invite.storeId || '').trim();
  if (!storeId) return;

  const now = new Date().toISOString();
  await setDoc(userRef, {
    role: 'client',
    storeId,
    name: invite.name || user.displayName || '',
    email: user.email,
    createdAt: now,
    updatedAt: now,
  });
  await deleteDoc(inviteRef).catch(() => {});
  showToast('Acesso ativado com o Google. Bem-vindo(a) ao painel da sua loja!', 'success', 5000);
}

async function handleAuthenticatedUser(user) {
  const isSuper = isSuperAdminEmail(user.email);

  if (isSuper && !getRequestedStoreId()) {
    window.location.replace('super.html');
    return;
  }

  if (!isSuper) {
    try {
      await resolveClientInvite(user);
    } catch (claimError) {
      console.error('Não foi possível ativar o convite do cliente:', claimError);
    }
  }

  try {
    const payload = await loadAdminData(user);
    applyPayload(payload);
    sessionExpiredNotified = false;
    loginPassword.value = '';
    loginError.hidden = true;
    showApp();
  } catch (error) {
    console.error(error);
    state.data = null;
    if (String(error && error.code) === 'app/redirect-portal') {
      window.location.replace('super.html');
      return;
    }
    const googleAccount = Array.isArray(user.providerData)
      && user.providerData.some((provider) => provider && provider.providerId === 'google.com');
    pendingLoginMessage = String(error && error.code) === 'permission-denied'
      ? 'Sua conta não tem permissão para acessar esta loja. Confira o documento users/{uid} no Firestore.'
      : (googleAccount && /vinculada/i.test(String(error && error.message))
          ? 'Esta conta Google ainda não está vinculada a nenhuma loja. Entre com o e-mail exato do convite ou fale com o super administrador.'
          : firebaseErrorMessage(error, 'Não foi possível carregar os dados da loja.'));
    await signOut(auth).catch(() => {});
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  loginError.hidden = true;

  if (!firebaseConfigured) {
    showLoginError(CONFIG_ERROR_MESSAGE);
    return;
  }
  if (!email) {
    showLoginError('Digite seu e-mail.');
    loginEmail.focus();
    return;
  }
  if (!password) {
    showLoginError('Digite sua senha.');
    loginPassword.focus();
    return;
  }

  setButtonLoading(loginSubmit, true, 'Entrando...');
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showLoginError(firebaseErrorMessage(error, 'Não foi possível entrar.'));
    loginPassword.select();
  } finally {
    setButtonLoading(loginSubmit, false);
  }
}

async function handleGoogleLogin() {
  if (!firebaseConfigured) {
    showLoginError(CONFIG_ERROR_MESSAGE);
    return;
  }

  loginError.hidden = true;
  setButtonLoading(googleLoginBtn, true, 'Conectando...');
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
    setButtonLoading(googleLoginBtn, false);
  }
}

async function handleForgotPassword() {
  loginError.hidden = true;
  if (!firebaseConfigured) {
    showToast(CONFIG_ERROR_MESSAGE, 'error', 6000);
    return;
  }
  const email = loginEmail.value.trim();
  if (!email) {
    showLoginError('Digite seu e-mail para receber o link de redefinição.');
    loginEmail.focus();
    return;
  }

  forgotPasswordBtn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Enviamos um link de redefinição para o seu e-mail.', 'success', 6000);
  } catch (error) {
    showLoginError(firebaseErrorMessage(error, 'Não foi possível enviar o link de redefinição.'));
  } finally {
    forgotPasswordBtn.disabled = false;
  }
}

async function handleLogout() {
  closeAllModals();
  state.data = null;
  state.productSearch = '';
  pendingLoginMessage = '';
  try {
    await signOut(auth);
  } catch {}
  showLogin();
}

/* --------------------------------------------------------------------------
   Navegação e estrutura
   -------------------------------------------------------------------------- */

function openSidebar() {
  sidebar.classList.add('is-open');
  sidebarBackdrop.classList.add('is-visible');
  mobileMenuBtn.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar.classList.remove('is-open');
  sidebarBackdrop.classList.remove('is-visible');
  if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
}

function navigateToView(view) {
  if (!VIEW_HASH[view]) return;
  state.view = view;
  if (window.location.hash !== VIEW_HASH[view]) {
    window.history.replaceState(null, '', VIEW_HASH[view]);
  }
  if (state.data) renderView({ scroll: true });
  closeSidebar();
}

function renderView(options = {}) {
  if (!state.data) return;

  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.route === state.view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  let markup = '';
  if (state.view === 'products') markup = renderProductsView();
  else if (state.view === 'catalogs') markup = renderCatalogsView();
  else if (state.view === 'settings') markup = renderSettingsView();
  else markup = renderOverviewView();

  contentEl.innerHTML = markup;

  if (state.view === 'settings') bindSettingsView();

  document.title = `MyStore — ${VIEW_LABEL[state.view] || 'Painel'}`;
  if (options.scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function trapModalFocus(event) {
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    top.close();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...top.card.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.offsetParent !== null);

  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindGlobalEvents() {
  loginForm.addEventListener('submit', handleLogin);
  if (googleLoginBtn) googleLoginBtn.addEventListener('click', handleGoogleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  togglePasswordBtn.addEventListener('click', () => {
    const showing = loginPassword.type === 'text';
    loginPassword.type = showing ? 'password' : 'text';
    togglePasswordBtn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    togglePasswordBtn.querySelector('use').setAttribute('href', `assets/icons.svg#${showing ? 'i-eye' : 'i-eye-off'}`);
    loginPassword.focus();
  });

  loginEmail.addEventListener('input', () => {
    loginError.hidden = true;
  });

  loginPassword.addEventListener('input', () => {
    loginError.hidden = true;
  });

  forgotPasswordBtn.addEventListener('click', handleForgotPassword);

  mobileMenuBtn.addEventListener('click', openSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-route]') && window.matchMedia('(max-width: 1080px)').matches) {
      closeSidebar();
    }
  });

  contentEl.addEventListener('click', handleContentClick);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.id === 'product-search') {
      state.productSearch = target.value;
      updateProductsResults();
    } else if (target.id === 'settings-store-name') {
      updateSettingsLogoPreview();
    } else if (target.id === 'settings-whatsapp') {
      updatePhonePreview();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (modalStack.length) {
      trapModalFocus(event);
      return;
    }
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  window.addEventListener('hashchange', () => {
    state.view = getViewFromHash();
    if (state.data) renderView({ scroll: true });
    closeSidebar();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1080) closeSidebar();
  });
}

function init() {
  bindGlobalEvents();

  if (!firebaseConfigured) {
    hideBootScreen();
    showLogin(CONFIG_ERROR_MESSAGE);
    return;
  }

  let authResolved = false;
  const authTimeout = window.setTimeout(() => {
    if (authResolved) return;
    authResolved = true;
    hideBootScreen();
    showLogin();
    showToast('Não foi possível verificar sua sessão. Verifique sua conexão e recarregue a página.', 'error', 8000);
  }, 12000);

  getRedirectResult(auth).catch((error) => {
    const code = String((error && error.code) || '');
    if (!code || code === 'auth/no-auth-event') return;
    hideBootScreen();
    showLogin();
    showLoginError(firebaseErrorMessage(error, 'Não foi possível concluir o login com o Google.'));
  });

  onAuthStateChanged(auth, (user) => {
    authResolved = true;
    window.clearTimeout(authTimeout);
    if (!user) {
      state.data = null;
      state.storeId = '';
      hideBootScreen();
      showLogin(pendingLoginMessage);
      pendingLoginMessage = '';
      return;
    }
    handleAuthenticatedUser(user);
  }, (error) => {
    authResolved = true;
    window.clearTimeout(authTimeout);
    console.error(error);
    hideBootScreen();
    showLogin(firebaseErrorMessage(error, 'Não foi possível verificar sua sessão.'));
  });
}

init();

/* --------------------------------------------------------------------------
   Visão geral
   -------------------------------------------------------------------------- */

function capitalize(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function renderOverviewView() {
  const { products, catalogs, settings } = state.data;
  const productsInCatalogs = new Set(catalogs.flatMap((catalog) => catalog.productIds)).size;
  const dateLabel = capitalize(new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date()));

  const statCards = [
    {
      icon: 'box',
      tone: '',
      value: String(products.length),
      label: 'Produtos cadastrados',
      tag: 'Na vitrine',
      tagClass: '',
    },
    {
      icon: 'link',
      tone: 'gold',
      value: String(catalogs.length),
      label: 'Catálogos criados',
      tag: 'Links ativos',
      tagClass: '',
    },
    {
      icon: 'users',
      tone: 'clay',
      value: String(productsInCatalogs),
      label: 'Produtos em catálogos',
      tag: 'Selecionados',
      tagClass: 'muted',
    },
    {
      icon: settings.showPrices ? 'eye' : 'eye-off',
      tone: 'neutral',
      value: settings.showPrices ? 'Visíveis' : 'Ocultos',
      label: 'Preços nos links',
      tag: settings.showPrices ? 'Ativo' : 'Oculto',
      tagClass: settings.showPrices ? '' : 'muted',
      word: true,
    },
  ];

  const statsMarkup = statCards.map((stat) => `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-icon ${stat.tone}">${icon(stat.icon)}</span>
        <span class="stat-tag ${stat.tagClass}">${escapeHtml(stat.tag)}</span>
      </div>
      <span class="stat-value${stat.word ? ' word' : ''}">${escapeHtml(stat.value)}</span>
      <span class="stat-label">${escapeHtml(stat.label)}</span>
    </article>
  `).join('');

  const recentCatalogs = catalogs.slice(0, 4).map((catalog) => `
    <div class="recent-row">
      <span class="recent-icon">${icon('link')}</span>
      <div class="recent-info">
        <strong>${escapeHtml(catalog.name)}</strong>
        <small>${catalog.productIds.length} ${catalog.productIds.length === 1 ? 'produto' : 'produtos'} · criado em ${escapeHtml(formatDate(catalog.createdAt))}</small>
      </div>
      <button class="icon-btn" type="button" data-action="copy-link" data-slug="${escapeHtml(catalog.slug)}" aria-label="Copiar link de ${escapeHtml(catalog.name)}">${icon('copy')}</button>
    </div>
  `).join('');

  const recentProducts = products.slice(0, 4).map((product) => `
    <div class="recent-row">
      <span class="recent-thumb">${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : icon('image')}</span>
      <div class="recent-info">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${getCatalogProductCount(product.id) ? `Em ${getCatalogProductCount(product.id)} catálogo(s)` : 'Ainda não está em catálogos'}</small>
      </div>
      <span class="recent-price">${formatPrice(product.price)}</span>
      <button class="icon-btn" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}" aria-label="Editar ${escapeHtml(product.name)}">${icon('edit')}</button>
    </div>
  `).join('');

  const onboarding = `
    <div class="empty-state">
      <span class="empty-icon">${icon('box')}</span>
      <h2>Sua vitrine começa com um produto</h2>
      <p>Cadastre o primeiro produto com foto, descrição e valor. Depois, monte um catálogo personalizado e envie o link para seu cliente.</p>
      <button class="btn btn-primary" type="button" data-action="new-product">${icon('plus')} Cadastrar primeiro produto</button>
    </div>
  `;

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('sparkles')} Painel · ${escapeHtml(dateLabel)}</span>
          <h1>Visão geral</h1>
          <p class="page-subtitle">Sua loja em um só lugar. Cadastre produtos, monte catálogos e compartilhe com seus clientes.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" type="button" data-action="new-catalog" ${products.length ? '' : 'disabled'}>
            ${icon('link')} Novo catálogo
          </button>
          <button class="btn btn-primary" type="button" data-action="new-product">
            ${icon('plus')} Novo produto
          </button>
        </div>
      </div>

      ${!settings.whatsapp ? `
        <div class="notice">
          ${icon('alert')}
          <span>Seu WhatsApp ainda não foi configurado. Os botões de compra dos catálogos ficarão indisponíveis até você informar o número. <a href="#/configuracoes">Configurar agora</a></span>
        </div>
      ` : ''}

      <div class="stats-grid">${statsMarkup}</div>

      ${products.length === 0 ? onboarding : `
        <div class="overview-grid">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Catálogos recentes</h2>
                <p>Links prontos para enviar aos clientes</p>
              </div>
              <a class="panel-link" href="#/catalogos">Ver todos ${icon('arrow-right')}</a>
            </div>
            <div class="panel-body">
              ${recentCatalogs || `
                <div class="panel-empty">
                  <strong>Nenhum catálogo ainda</strong>
                  Selecione produtos e crie um link exclusivo para cada cliente.
                </div>
              `}
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Produtos recentes</h2>
                <p>Últimos itens adicionados à loja</p>
              </div>
              <a class="panel-link" href="#/produtos">Ver todos ${icon('arrow-right')}</a>
            </div>
            <div class="panel-body">
              ${recentProducts || `
                <div class="panel-empty">
                  <strong>Nenhum produto ainda</strong>
                  Cadastre seu primeiro produto para começar.
                </div>
              `}
            </div>
          </section>
        </div>

        <div class="tip-banner">
          <span class="tip-banner-icon">${icon('sparkles')}</span>
          <div class="tip-banner-text">
            <strong>Um catálogo diferente para cada cliente</strong>
            Selecione os produtos ideais, gere um link exclusivo e envie. Seu cliente escolhe e o pedido chega pronto no WhatsApp.
          </div>
          <button class="btn btn-gold btn-sm" type="button" data-action="new-catalog">${icon('link')} Criar catálogo</button>
        </div>
      `}
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Produtos
   -------------------------------------------------------------------------- */

function productCardMarkup(product) {
  const catalogCount = getCatalogProductCount(product.id);
  return `
    <article class="product-card">
      <div class="product-image">
        ${productImageMarkup(product)}
        <div class="product-actions">
          <button class="card-action" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}" aria-label="Editar ${escapeHtml(product.name)}">${icon('edit')}</button>
          <button class="card-action danger" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}" aria-label="Excluir ${escapeHtml(product.name)}">${icon('trash')}</button>
        </div>
      </div>
      <div class="product-body">
        <h3 class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description || 'Sem descrição')}</p>
        <div class="product-foot">
          <span class="product-price">${formatPrice(product.price)}</span>
          <span class="product-catalogs ${catalogCount ? '' : 'none'}">
            ${icon('link')} ${catalogCount ? `${catalogCount} catálogo${catalogCount > 1 ? 's' : ''}` : 'Sem catálogo'}
          </span>
        </div>
      </div>
    </article>
  `;
}

function productsResultsMarkup() {
  const filtered = getFilteredProducts();
  if (!filtered.length) {
    return `
      <div class="empty-state">
        <span class="empty-icon">${icon('search')}</span>
        <h2>Nenhum produto encontrado</h2>
        <p>Tente buscar por outro nome ou limpe a busca para ver todos os produtos.</p>
        <button class="btn btn-secondary" type="button" data-action="clear-product-search">Limpar busca</button>
      </div>
    `;
  }
  return `<div class="products-grid">${filtered.map(productCardMarkup).join('')}</div>`;
}

function productCountLabel() {
  const total = state.data ? state.data.products.length : 0;
  const filtered = getFilteredProducts().length;
  if (state.productSearch.trim()) return `${filtered} de ${total} produto${total === 1 ? '' : 's'}`;
  return `${total} produto${total === 1 ? '' : 's'} no catálogo`;
}

function updateProductsResults() {
  const results = document.getElementById('products-results');
  const count = document.getElementById('products-count');
  if (results) results.innerHTML = productsResultsMarkup();
  if (count) count.textContent = productCountLabel();
}

function renderProductsView() {
  const products = state.data.products;
  const hasProducts = products.length > 0;

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('box')} Catálogo</span>
          <h1>Produtos</h1>
          <p class="page-subtitle">Cadastre fotos, descrições e valores. Seus produtos ficam disponíveis para todos os catálogos.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" type="button" data-action="new-product">${icon('plus')} Novo produto</button>
        </div>
      </div>

      ${hasProducts ? `
        <div class="toolbar">
          <div class="search-field">
            ${icon('search')}
            <input id="product-search" type="search" placeholder="Buscar por nome ou descrição" value="${escapeHtml(state.productSearch)}" autocomplete="off">
          </div>
          <span class="toolbar-meta" id="products-count">${escapeHtml(productCountLabel())}</span>
        </div>
        <div id="products-results">${productsResultsMarkup()}</div>
      ` : `
        <div class="empty-state">
          <span class="empty-icon">${icon('box')}</span>
          <h2>Seu catálogo começa aqui</h2>
          <p>Adicione o primeiro produto com uma foto, descrição e valor. Depois é só selecionar os itens e criar um link para enviar aos clientes.</p>
          <button class="btn btn-primary" type="button" data-action="new-product">${icon('plus')} Cadastrar primeiro produto</button>
        </div>
      `}
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Modal de produto
   -------------------------------------------------------------------------- */

function priceInputValue(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2).replace('.', ',');
}

function openProductModal(product = null) {
  const isEditing = Boolean(product);
  const imageState = {
    url: product && product.image ? product.image : '',
    dataUrl: '',
    preview: product && product.image ? product.image : '',
  };

  const modal = openModal(`
    <div class="modal-header">
      <div>
        <h2>${isEditing ? 'Editar produto' : 'Novo produto'}</h2>
        <p>${isEditing ? 'Atualize os dados deste item do catálogo.' : 'Adicione um item ao catálogo da sua loja.'}</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <form id="product-form" class="modal-content-form">
      <div class="modal-body">
        <div class="product-form-layout">
          <div class="image-uploader">
            <div class="image-dropzone" id="product-dropzone" aria-busy="false"></div>
            <div class="image-actions">
              <button class="mini-btn" type="button" data-image-gallery>${icon('image')} Galeria</button>
              <button class="mini-btn" type="button" data-image-camera>${icon('camera')} Tirar foto</button>
              <button class="mini-btn danger image-remove" type="button" data-image-remove hidden>${icon('trash')} Remover</button>
            </div>
            <p class="image-hint">JPG, PNG ou WebP. A imagem é otimizada automaticamente.</p>
            <input id="product-image-input" type="file" accept="image/*" hidden>
          </div>

          <div class="product-form-fields">
            <p class="form-section-label">Informações do produto</p>
            <div class="form-grid cols-1">
              <div class="form-group">
                <label class="field-label" for="product-name">Nome do produto <span class="required-mark">*</span></label>
                <input class="text-input" id="product-name" name="name" type="text" maxlength="120" required data-autofocus value="${escapeHtml(product ? product.name : '')}" placeholder="Ex.: Camiseta linha premium">
              </div>
              <div class="form-group">
                <label class="field-label" for="product-price">Valor <span class="required-mark">*</span></label>
                <div class="input-with-prefix">
                  <span>R$</span>
                  <input class="text-input" id="product-price" name="price" type="text" inputmode="decimal" required value="${escapeHtml(product ? priceInputValue(product.price) : '')}" placeholder="0,00">
                </div>
              </div>
              <div class="form-group">
                <label class="field-label" for="product-description">Descrição</label>
                <textarea class="text-area" id="product-description" name="description" maxlength="1000" rows="4" placeholder="Conte os detalhes, materiais ou diferenciais deste produto.">${escapeHtml(product ? product.description : '')}</textarea>
              </div>
            </div>
            <p class="form-error" id="product-form-error" hidden></p>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="product-save">${icon('check')} ${isEditing ? 'Salvar alterações' : 'Adicionar produto'}</button>
      </div>
    </form>
  `);

  const form = modal.root.querySelector('#product-form');
  const dropzone = modal.root.querySelector('#product-dropzone');
  const removeButton = modal.root.querySelector('[data-image-remove]');
  const imageInput = modal.root.querySelector('#product-image-input');
  const nameInput = modal.root.querySelector('#product-name');
  const priceInput = modal.root.querySelector('#product-price');
  const descriptionInput = modal.root.querySelector('#product-description');
  const errorBox = modal.root.querySelector('#product-form-error');
  const saveButton = modal.root.querySelector('#product-save');
  let busy = false;

  function imageMarkup() {
    if (imageState.preview) {
      return `<img src="${escapeHtml(imageState.preview)}" alt="Prévia da foto do produto">`;
    }
    return `
      <div class="image-dropzone-empty">
        ${icon('image')}
        <strong>Adicione uma foto</strong>
        <span>Escolha na galeria ou tire uma foto agora</span>
      </div>
    `;
  }

  function paintImage() {
    dropzone.innerHTML = `${imageMarkup()}<span class="spinner spinner-dark upload-spinner${busy ? '' : ' is-hidden'}" aria-hidden="true"></span>`;
    dropzone.classList.toggle('is-busy', busy);
    removeButton.hidden = !imageState.preview;
  }

  function setBusy(value) {
    busy = value;
    dropzone.setAttribute('aria-busy', String(value));
    paintImage();
  }

  async function applyImageFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file, { maxSize: 1200, quality: 0.82 });
      imageState.dataUrl = compressed;
      imageState.preview = compressed;
      errorBox.hidden = true;
      paintImage();
    } catch (error) {
      showToast(error.message || 'Não foi possível usar esta imagem.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function showFormError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  modal.root.querySelector('[data-image-gallery]').addEventListener('click', () => imageInput.click());
  modal.root.querySelector('[data-image-camera]').addEventListener('click', () => {
    openCameraModal((file) => applyImageFile(file));
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    imageInput.value = '';
    if (file) applyImageFile(file);
  });

  removeButton.addEventListener('click', () => {
    imageState.url = '';
    imageState.dataUrl = '';
    imageState.preview = '';
    paintImage();
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (file) applyImageFile(file);
  });
  dropzone.addEventListener('click', () => {
    if (!imageState.preview && !busy) imageInput.click();
  });

  priceInput.addEventListener('input', () => {
    priceInput.setCustomValidity('');
    errorBox.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const name = nameInput.value.trim();
    const price = parsePrice(priceInput.value);
    const description = descriptionInput.value.trim();

    if (!name) {
      nameInput.focus();
      nameInput.reportValidity();
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      showFormError('Informe um valor válido, como 49,90.');
      priceInput.focus();
      priceInput.select();
      return;
    }

    setButtonLoading(saveButton, true, 'Salvando...');
    setBusy(true);
    let uploadedImage = null;
    let committed = false;
    try {
      let imageUrl = imageState.preview ? imageState.url : '';
      let imagePath = imageState.preview && product ? (product.imagePath || '') : '';

      if (imageState.dataUrl) {
        uploadedImage = await uploadImage(imageState.dataUrl, 'products');
        imageUrl = uploadedImage.url;
        imagePath = uploadedImage.path;
        imageState.url = uploadedImage.url;
        imageState.dataUrl = '';
        imageState.preview = uploadedImage.url;
      }

      const productRef = isEditing
        ? doc(productsCollection(), product.id)
        : doc(productsCollection());
      const now = new Date().toISOString();
      const batch = writeBatch(db);

      batch.set(productRef, {
        name,
        description,
        imageUrl,
        imagePath,
        createdAt: isEditing ? (product.createdAt || now) : now,
        updatedAt: now,
      });

      batch.set(doc(pricesCollection(), productRef.id), {
        price: Math.round(price * 100) / 100,
        updatedAt: now,
      });

      await batch.commit();
      committed = true;

      if (isEditing && product.imagePath && product.imagePath !== imagePath) {
        await removeImage(product.imagePath);
      }

      await refreshData();
      modal.close();
      renderView();
      showToast(isEditing ? 'Produto atualizado com sucesso.' : 'Produto adicionado ao catálogo.');
    } catch (error) {
      if (uploadedImage && !committed) {
        await removeImage(uploadedImage.path);
        imageState.url = isEditing ? (product.image || '') : '';
        imageState.dataUrl = '';
        imageState.preview = imageState.url;
        paintImage();
      }
      showFormError(firebaseErrorMessage(error, 'Não foi possível salvar o produto.'));
      showToast(firebaseErrorMessage(error, 'Não foi possível salvar o produto.'), 'error');
    } finally {
      setButtonLoading(saveButton, false);
      setBusy(false);
    }
  });

  paintImage();
}

async function deleteProduct(product) {
  const usedIn = getCatalogProductCount(product.id);
  const message = usedIn
    ? `"${product.name}" será removido da loja e também de ${usedIn} catálogo${usedIn > 1 ? 's' : ''} já criado${usedIn > 1 ? 's' : ''}. Esta ação não pode ser desfeita.`
    : `"${product.name}" será removido definitivamente do catálogo. Esta ação não pode ser desfeita.`;

  const confirmed = await confirmDialog({
    title: 'Excluir produto?',
    message,
    confirmLabel: 'Excluir produto',
  });
  if (!confirmed) return;

  try {
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.delete(doc(productsCollection(), product.id));
    batch.delete(doc(pricesCollection(), product.id));

    state.data.catalogs.forEach((catalog) => {
      if (!catalog.productIds.includes(product.id)) return;
      batch.update(doc(catalogsCollection(), catalog.id), {
        productIds: catalog.productIds.filter((id) => id !== product.id),
        updatedAt: now,
      });
    });

    await batch.commit();
    await removeImage(product.imagePath);
    await refreshData();
    renderView();
    showToast('Produto excluído com sucesso.');
  } catch (error) {
    showToast(firebaseErrorMessage(error, 'Não foi possível excluir o produto.'), 'error');
  }
}

/* --------------------------------------------------------------------------
   Catálogos
   -------------------------------------------------------------------------- */

function catalogThumbsMarkup(catalog) {
  const productMap = new Map(state.data.products.map((product) => [product.id, product]));
  const selected = catalog.productIds.map((id) => productMap.get(id)).filter(Boolean);
  if (!selected.length) return '';

  const visible = selected.slice(0, 4);
  const extra = selected.length - visible.length;
  return `
    <div class="catalog-thumbs">
      <div class="catalog-thumbs-stack">
        ${visible.map((product) => `
          <span class="catalog-thumb">${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : icon('image')}</span>
        `).join('')}
        ${extra > 0 ? `<span class="catalog-thumb-more">+${extra}</span>` : ''}
      </div>
      <span class="catalog-thumbs-label">${selected.length} ${selected.length === 1 ? 'produto selecionado' : 'produtos selecionados'}</span>
    </div>
  `;
}

function catalogCardMarkup(catalog) {
  const catalogUrl = getCatalogUrl(state.storeId, catalog.slug);
  return `
    <article class="catalog-card">
      <div class="catalog-head">
        <span class="catalog-icon">${icon('link')}</span>
        <div class="catalog-title-wrap">
          <h3 class="catalog-title">${escapeHtml(catalog.name)}</h3>
          <p class="catalog-meta">${catalog.productIds.length} ${catalog.productIds.length === 1 ? 'produto' : 'produtos'} <span>•</span> atualizado em ${escapeHtml(formatDate(catalog.updatedAt))}</p>
        </div>
      </div>
      ${catalogThumbsMarkup(catalog)}
      <div class="catalog-link">
        <span>${escapeHtml(catalogUrl.replace(/^https?:\/\//, ''))}</span>
        <button class="icon-btn" type="button" data-action="copy-link" data-slug="${escapeHtml(catalog.slug)}" aria-label="Copiar link de ${escapeHtml(catalog.name)}">${icon('copy')}</button>
      </div>
      <div class="catalog-foot">
        <a class="catalog-open" href="${escapeHtml(catalogUrl)}" target="_blank" rel="noopener">Ver catálogo ${icon('arrow-up-right')}</a>
        <div class="catalog-foot-actions">
          <button class="btn btn-sm catalog-edit-btn" type="button" data-action="edit-catalog" data-id="${escapeHtml(catalog.id)}">${icon('edit')} Editar</button>
          <button class="icon-btn icon-btn-danger" type="button" data-action="delete-catalog" data-id="${escapeHtml(catalog.id)}" aria-label="Excluir catálogo ${escapeHtml(catalog.name)}">${icon('trash')}</button>
        </div>
      </div>
    </article>
  `;
}

function renderCatalogsView() {
  const { products, catalogs } = state.data;
  const hasProducts = products.length > 0;

  let content = '';
  if (!hasProducts) {
    content = `
      <div class="empty-state">
        <span class="empty-icon">${icon('box')}</span>
        <h2>Cadastre produtos primeiro</h2>
        <p>Os catálogos são montados com os produtos da sua loja. Adicione pelo menos um produto para criar um link personalizado.</p>
        <a class="btn btn-primary" href="#/produtos">${icon('plus')} Cadastrar produtos</a>
      </div>
    `;
  } else if (!catalogs.length) {
    content = `
      <div class="empty-state">
        <span class="empty-icon">${icon('link')}</span>
        <h2>Crie o primeiro catálogo</h2>
        <p>Selecione alguns ou todos os produtos e gere um endereço exclusivo. Cada cliente pode receber uma seleção diferente, com o seu nome e o pedido direto no WhatsApp.</p>
        <button class="btn btn-primary" type="button" data-action="new-catalog">${icon('plus')} Criar primeiro catálogo</button>
      </div>
    `;
  } else {
    content = `
      <div class="catalogs-grid">
        ${catalogs.map(catalogCardMarkup).join('')}
        <button class="new-catalog-card" type="button" data-action="new-catalog">
          <span class="new-catalog-icon">${icon('plus')}</span>
          <strong>Criar novo catálogo</strong>
          <small>Monte uma seleção personalizada</small>
        </button>
      </div>
    `;
  }

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('link')} Links personalizados</span>
          <h1>Catálogos</h1>
          <p class="page-subtitle">Cada catálogo tem um endereço próprio. Envie para um cliente e ele verá apenas os produtos que você selecionou.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" type="button" data-action="new-catalog" ${hasProducts ? '' : 'disabled'}>${icon('plus')} Novo catálogo</button>
        </div>
      </div>
      ${content}
    </div>
  `;
}

async function copyCatalogLink(slug) {
  const link = getCatalogUrl(state.storeId, slug);
  const copied = await copyText(link);
  showToast(
    copied ? 'Link copiado para a área de transferência.' : 'Não foi possível copiar o link.',
    copied ? 'success' : 'error'
  );
}

async function deleteCatalog(catalog) {
  const confirmed = await confirmDialog({
    title: 'Excluir catálogo?',
    message: `O link "${catalog.name}" deixará de funcionar e o cliente não conseguirá mais acessar esta seleção. Os produtos continuam salvos na sua loja.`,
    confirmLabel: 'Excluir catálogo',
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(catalogsCollection(), catalog.id));
    await refreshData();
    renderView();
    showToast('Catálogo excluído.');
  } catch (error) {
    showToast(firebaseErrorMessage(error, 'Não foi possível excluir o catálogo.'), 'error');
  }
}

/* --------------------------------------------------------------------------
   Modal de catálogo
   -------------------------------------------------------------------------- */

function openCatalogModal(catalog = null) {
  const isEditing = Boolean(catalog);
  const existingIds = new Set(state.data.products.map((product) => product.id));
  const selected = new Set((catalog ? catalog.productIds : []).filter((id) => existingIds.has(id)));

  const modal = openModal(`
    <div class="modal-header">
      <div>
        <h2>${isEditing ? 'Editar catálogo' : 'Novo catálogo'}</h2>
        <p>${isEditing ? 'Ajuste o nome e os produtos deste link personalizado.' : 'Escolha os produtos que este cliente poderá ver e comprar.'}</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-modal-close aria-label="Fechar">${icon('x')}</button>
    </div>
    <form id="catalog-form" class="modal-content-form">
      <div class="modal-body">
        <div class="form-grid cols-1">
          <div class="form-group">
            <label class="field-label" for="catalog-name">Nome do catálogo <span class="required-mark">*</span></label>
            <input class="text-input" id="catalog-name" type="text" required maxlength="60" data-autofocus value="${escapeHtml(catalog ? catalog.name : '')}" placeholder="Ex.: João, Coleção verão, Cliente VIP">
            <p class="field-hint">Use o nome do cliente ou uma referência que ajude a identificar este link.</p>
          </div>
        </div>

        <p class="form-section-label">Produtos da seleção</p>
        <div class="selection-toolbar">
          <div class="search-field">
            ${icon('search')}
            <input id="catalog-product-search" type="search" placeholder="Buscar produto" autocomplete="off">
          </div>
          <span class="selection-count" id="catalog-selection-count">0 selecionados</span>
        </div>
        <div class="selection-actions">
          <button class="text-btn" type="button" id="catalog-select-all">Selecionar todos</button>
          <button class="text-btn muted" type="button" id="catalog-clear">Limpar seleção</button>
        </div>
        <div class="selection-list" id="catalog-selection-list"></div>
        <p class="form-error" id="catalog-form-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="catalog-save">
          ${icon('check')} ${isEditing ? 'Salvar alterações' : 'Criar catálogo'}
        </button>
      </div>
    </form>
  `, { className: 'modal-lg' });

  const form = modal.root.querySelector('#catalog-form');
  const nameInput = modal.root.querySelector('#catalog-name');
  const searchInput = modal.root.querySelector('#catalog-product-search');
  const list = modal.root.querySelector('#catalog-selection-list');
  const countLabel = modal.root.querySelector('#catalog-selection-count');
  const selectAllButton = modal.root.querySelector('#catalog-select-all');
  const clearButton = modal.root.querySelector('#catalog-clear');
  const saveButton = modal.root.querySelector('#catalog-save');
  const errorBox = modal.root.querySelector('#catalog-form-error');

  function filteredProducts() {
    const query = normalizeSearch(searchInput.value);
    return state.data.products.filter((product) => {
      if (!query) return true;
      return normalizeSearch(`${product.name} ${product.description || ''}`).includes(query);
    });
  }

  function selectionItemMarkup(product) {
    const isSelected = selected.has(product.id);
    return `
      <button class="selection-item${isSelected ? ' is-selected' : ''}" type="button" data-product-id="${escapeHtml(product.id)}" aria-pressed="${isSelected}">
        <span class="selection-item-image">
          ${product.image ? `<img src="${escapeHtml(product.image)}" alt="">` : icon('image')}
        </span>
        <span class="selection-item-info">
          <span class="selection-item-name">${escapeHtml(product.name)}</span>
          <span class="selection-item-price">${formatPrice(product.price)}</span>
        </span>
        <span class="selection-check">${icon('check')}</span>
      </button>
    `;
  }

  function renderSelection() {
    const filtered = filteredProducts();
    if (!filtered.length) {
      list.innerHTML = `
        <div class="selection-empty">
          <strong>Nenhum produto encontrado</strong>
          Tente buscar por outro nome.
        </div>
      `;
    } else {
      list.innerHTML = filtered.map(selectionItemMarkup).join('');
    }
    const total = selected.size;
    countLabel.textContent = `${total} selecionado${total === 1 ? '' : 's'}`;
    saveButton.disabled = total === 0;
    selectAllButton.textContent = searchInput.value.trim() ? 'Selecionar resultados' : 'Selecionar todos';
  }

  function showCatalogError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  list.addEventListener('click', (event) => {
    const item = event.target.closest('[data-product-id]');
    if (!item) return;
    const id = item.dataset.productId;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    errorBox.hidden = true;
    renderSelection();
  });

  searchInput.addEventListener('input', renderSelection);

  selectAllButton.addEventListener('click', () => {
    filteredProducts().forEach((product) => selected.add(product.id));
    errorBox.hidden = true;
    renderSelection();
  });

  clearButton.addEventListener('click', () => {
    selected.clear();
    errorBox.hidden = true;
    renderSelection();
  });

  nameInput.addEventListener('input', () => {
    errorBox.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.reportValidity();
      return;
    }
    if (!selected.size) {
      showCatalogError('Selecione pelo menos um produto para criar o catálogo.');
      return;
    }

    setButtonLoading(saveButton, true, isEditing ? 'Salvando...' : 'Criando...');
    try {
      const now = new Date().toISOString();
      const catalogId = isEditing
        ? catalog.id
        : `${slugifyCatalogName(name) || 'catalogo'}-${randomId().replace(/-/g, '').slice(0, 8)}`;

      await setDoc(doc(catalogsCollection(), catalogId), {
        name,
        productIds: [...selected],
        createdAt: isEditing ? (catalog.createdAt || now) : now,
        updatedAt: now,
      }, { merge: true });

      const link = getCatalogUrl(state.storeId, catalogId);
      await refreshData();
      modal.close();
      navigateToView('catalogs');
      showToast(isEditing ? 'Catálogo atualizado com sucesso.' : 'Catálogo criado com sucesso.');

      if (!isEditing) {
        window.setTimeout(() => openShareSuccessModal(name, link), 120);
      }
    } catch (error) {
      showCatalogError(firebaseErrorMessage(error, 'Não foi possível salvar o catálogo.'));
    } finally {
      setButtonLoading(saveButton, false);
    }
  });

  renderSelection();
}

/* --------------------------------------------------------------------------
   Configurações
   -------------------------------------------------------------------------- */

function renderSettingsView() {
  const { settings } = state.data;
  settingsLogoDraft = {
    url: settings.logo || '',
    path: settings.logoPath || '',
    dataUrl: '',
    preview: settings.logo || '',
  };

  return `
    <div class="view">
      <div class="page-header">
        <div class="page-heading">
          <span class="page-eyebrow">${icon('settings')} Preferências</span>
          <h1>Configurações</h1>
          <p class="page-subtitle">Personalize a identidade da loja, defina como os preços aparecem e configure o WhatsApp que receberá os pedidos.</p>
        </div>
      </div>

      <div class="settings-layout">
        <form id="settings-form">
          <div class="settings-form-stack">
            <section class="settings-card">
              <div class="settings-card-head">
                <div>
                  <h2>${icon('store')} Identidade da loja</h2>
                  <p>É o que seus clientes veem no topo de cada catálogo.</p>
                </div>
              </div>
              <div class="settings-body">
                <div class="brand-setting">
                  <div class="logo-preview" id="settings-logo-preview"></div>
                  <div class="brand-setting-copy">
                    <strong>Logo ou nome da loja</strong>
                    <p>Envie uma logo para dar ainda mais personalidade. Sem logo, o nome da loja aparece em destaque.</p>
                    <div class="brand-setting-actions">
                      <button class="mini-btn" type="button" data-action="logo-gallery">${icon('image')} Galeria</button>
                      <button class="mini-btn" type="button" data-action="logo-camera">${icon('camera')} Câmera</button>
                      <button class="mini-btn danger" type="button" data-action="logo-remove" ${settings.logo ? '' : 'hidden'}>${icon('trash')} Remover</button>
                    </div>
                  </div>
                </div>
                <input id="settings-logo-input" type="file" accept="image/*" hidden>
                <div class="form-group">
                  <label class="field-label" for="settings-store-name">Nome da loja <span class="required-mark">*</span></label>
                  <input class="text-input" id="settings-store-name" type="text" maxlength="80" required value="${escapeHtml(settings.storeName)}">
                  <p class="field-hint">Esse nome também aparece no painel e no rodapé do catálogo.</p>
                </div>
              </div>
            </section>

            <section class="settings-card">
              <div class="settings-card-head">
                <div>
                  <h2>${icon('tag')} Exibição de preços</h2>
                  <p>Controle global dos valores em todos os catálogos.</p>
                </div>
              </div>
              <div class="settings-body">
                <div class="settings-row">
                  <div class="settings-row-copy">
                    <strong>Exibir valores nos catálogos</strong>
                    <p>Quando ativado, os preços cadastrados aparecem em todos os produtos dos links enviados. Ao desativar, nenhum valor é exibido nem enviado na mensagem do WhatsApp.</p>
                  </div>
                  <label class="switch">
                    <input id="settings-show-prices" type="checkbox" ${settings.showPrices ? 'checked' : ''}>
                    <span class="switch-track"></span>
                    <span class="sr-only">Exibir valores nos catálogos</span>
                  </label>
                </div>
              </div>
            </section>

            <section class="settings-card">
              <div class="settings-card-head">
                <div>
                  <h2>${icon('whatsapp')} WhatsApp de pedidos</h2>
                  <p>Para onde as mensagens dos clientes serão enviadas.</p>
                </div>
              </div>
              <div class="settings-body">
                <div class="form-group">
                  <label class="field-label" for="settings-whatsapp">Número do WhatsApp</label>
                  <div class="input-with-icon">
                    ${icon('whatsapp')}
                    <input class="text-input" id="settings-whatsapp" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(settings.whatsapp ? formatWhatsapp(settings.whatsapp) : '')}" placeholder="Ex.: (11) 99999-9999">
                  </div>
                  <p class="field-hint">Você pode digitar com DDD. Para números do Brasil, o código +55 é adicionado automaticamente. O botão de compra fica indisponível sem um número válido.</p>
                  <div class="phone-preview">
                    ${icon('whatsapp')}
                    <span id="phone-preview-value"></span>
                  </div>
                </div>
              </div>
            </section>

            <div class="settings-actions">
              <span class="settings-saved" id="settings-saved">${icon('check')} Alterações salvas</span>
              <button class="btn btn-primary" type="submit" id="settings-save">${icon('check')} Salvar alterações</button>
            </div>
          </div>
        </form>

        ${renderAccountCard()}
      </div>
    </div>
  `;
}

function renderAccountCard() {
  const { auth: account } = state.data;
  const currentUser = auth.currentUser;
  const isGoogleAccount = Boolean(currentUser
    && Array.isArray(currentUser.providerData)
    && currentUser.providerData.some((provider) => provider && provider.providerId === 'google.com'));

  if (account.isSuperAdmin) {
    return `
      <section class="settings-card">
        <div class="settings-card-head">
          <div>
            <h2>${icon('users')} Super administrador</h2>
            <p>Acesso pelo Google ao portal de gestão.</p>
          </div>
          <span class="settings-badge">Super admin</span>
        </div>
        <div class="settings-body">
          <div class="security-note">
            ${icon('users')}
            <span>Conectado como <strong>${escapeHtml(account.email || 'super administrador')}</strong>. Você está gerenciando a loja <strong>${escapeHtml(state.data.settings.storeName)}</strong>.</span>
          </div>
          <div class="settings-actions">
            <a class="btn btn-secondary" href="super.html">${icon('grid')} Voltar ao portal</a>
          </div>
        </div>
      </section>
    `;
  }

  if (isGoogleAccount) {
    return `
      <section class="settings-card">
        <div class="settings-card-head">
          <div>
            <h2>${icon('users')} Conta Google</h2>
            <p>Acesso protegido pelo Google.</p>
          </div>
          <span class="settings-badge">Google</span>
        </div>
        <div class="settings-body">
          <div class="security-note">
            ${icon('users')}
            <span>Conectado como <strong>${escapeHtml(account.email || 'cliente')}</strong>. Você entra no painel clicando em <strong>Entrar com Google</strong> — não é preciso senha.</span>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>${icon('lock')} Conta de acesso</h2>
          <p>Acesso protegido pelo Firebase Authentication.</p>
        </div>
        <span class="settings-badge">Protegido</span>
      </div>
      <div class="settings-body">
        <div class="security-note">
          ${icon('users')}
          <span>Conectado como <strong>${escapeHtml(account.email || 'cliente')}</strong>. Para trocar a senha, informe a senha atual e defina uma nova.</span>
        </div>
        <form id="password-form">
          <div class="form-grid">
            <div class="form-group span-2">
              <label class="field-label" for="password-current">Senha atual</label>
              <input class="text-input" id="password-current" type="password" autocomplete="current-password" required placeholder="Digite a senha atual">
            </div>
            <div class="form-group">
              <label class="field-label" for="password-new">Nova senha</label>
              <input class="text-input" id="password-new" type="password" autocomplete="new-password" minlength="6" required placeholder="Mínimo de 6 caracteres">
            </div>
            <div class="form-group">
              <label class="field-label" for="password-confirm">Confirmar nova senha</label>
              <input class="text-input" id="password-confirm" type="password" autocomplete="new-password" minlength="6" required placeholder="Repita a nova senha">
            </div>
          </div>
          <p class="form-error" id="password-error" hidden></p>
          <div class="settings-actions">
            <button class="btn btn-secondary" type="button" id="password-reset">${icon('refresh')} Enviar link por e-mail</button>
            <button class="btn btn-primary" type="submit" id="password-save">Atualizar senha</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function bindSettingsView() {
  const settingsForm = document.getElementById('settings-form');
  const passwordForm = document.getElementById('password-form');
  const passwordResetButton = document.getElementById('password-reset');
  const logoInput = document.getElementById('settings-logo-input');
  const whatsappInput = document.getElementById('settings-whatsapp');

  if (settingsForm) settingsForm.addEventListener('submit', handleSettingsSave);
  if (passwordForm) passwordForm.addEventListener('submit', handlePasswordSave);
  if (passwordResetButton) passwordResetButton.addEventListener('click', handlePasswordReset);

  if (logoInput) {
    logoInput.addEventListener('change', () => {
      const file = logoInput.files && logoInput.files[0];
      logoInput.value = '';
      if (file) applySettingsLogoFile(file);
    });
  }

  if (whatsappInput) {
    whatsappInput.addEventListener('input', () => {
      whatsappInput.setCustomValidity('');
    });
  }

  updateSettingsLogoPreview();
  updatePhonePreview();
}

function updateSettingsLogoPreview() {
  const preview = document.getElementById('settings-logo-preview');
  if (!preview) return;
  if (settingsLogoDraft.preview) {
    preview.innerHTML = `<img src="${escapeHtml(settingsLogoDraft.preview)}" alt="Logo da loja">`;
  } else {
    const nameInput = document.getElementById('settings-store-name');
    preview.textContent = getInitials(nameInput ? nameInput.value : state.data.settings.storeName);
  }
}

function updatePhonePreview() {
  const input = document.getElementById('settings-whatsapp');
  const target = document.getElementById('phone-preview-value');
  if (!target) return;
  const formatted = formatWhatsapp(input ? input.value : '');
  if (formatted) {
    target.innerHTML = `Pedidos serão enviados para <strong>${escapeHtml(formatted)}</strong>`;
  } else {
    target.textContent = 'Nenhum WhatsApp configurado. O botão Comprar ficará indisponível.';
  }
}

async function applySettingsLogoFile(file) {
  try {
    const compressed = await compressImage(file, { maxSize: 512, quality: 0.9, keepAlpha: true });
    settingsLogoDraft.dataUrl = compressed;
    settingsLogoDraft.preview = compressed;
    updateSettingsLogoPreview();
    const removeButton = contentEl.querySelector('[data-action="logo-remove"]');
    if (removeButton) removeButton.hidden = false;
  } catch (error) {
    showToast(error.message || 'Não foi possível usar esta imagem.', 'error');
  }
}

function showSavedIndicator() {
  const indicator = document.getElementById('settings-saved');
  if (!indicator) return;
  indicator.classList.add('visible');
  if (savedIndicatorTimer) window.clearTimeout(savedIndicatorTimer);
  savedIndicatorTimer = window.setTimeout(() => indicator.classList.remove('visible'), 2800);
}

async function handleSettingsSave(event) {
  event.preventDefault();
  const nameInput = document.getElementById('settings-store-name');
  const whatsappInput = document.getElementById('settings-whatsapp');
  const showPricesInput = document.getElementById('settings-show-prices');
  const saveButton = document.getElementById('settings-save');
  if (!nameInput || !whatsappInput || !showPricesInput || !saveButton) return;

  const storeName = nameInput.value.trim();
  if (!storeName) {
    nameInput.focus();
    nameInput.reportValidity();
    return;
  }

  const rawDigits = whatsappInput.value.replace(/\D/g, '');
  if (rawDigits && (rawDigits.length < 10 || rawDigits.length > 15)) {
    whatsappInput.setCustomValidity('Informe um número válido, com DDD. Ex.: (11) 99999-9999.');
    whatsappInput.reportValidity();
    return;
  }
  whatsappInput.setCustomValidity('');

  setButtonLoading(saveButton, true, 'Salvando...');
  let uploadedLogo = null;
  let committed = false;
  try {
    let logoUrl = settingsLogoDraft.preview ? settingsLogoDraft.url : '';
    let logoPath = settingsLogoDraft.preview ? (settingsLogoDraft.path || '') : '';

    if (settingsLogoDraft.dataUrl) {
      uploadedLogo = await uploadImage(settingsLogoDraft.dataUrl, 'logo');
      logoUrl = uploadedLogo.url;
      logoPath = uploadedLogo.path;
    }

    const oldLogoPath = state.data.settings.logoPath || '';
    const now = new Date().toISOString();
    await setDoc(storeRef(), {
      name: storeName,
      whatsapp: normalizeWhatsapp(whatsappInput.value),
      showPrices: showPricesInput.checked,
      logoUrl,
      logoPath,
      updatedAt: now,
    }, { merge: true });
    committed = true;

    if (oldLogoPath && oldLogoPath !== logoPath) await removeImage(oldLogoPath);

    const payload = await refreshData();
    settingsLogoDraft = {
      url: payload.settings.logo || '',
      path: payload.settings.logoPath || '',
      dataUrl: '',
      preview: payload.settings.logo || '',
    };
    whatsappInput.value = payload.settings.whatsapp ? formatWhatsapp(payload.settings.whatsapp) : '';
    updateSettingsLogoPreview();
    updatePhonePreview();

    const removeButton = contentEl.querySelector('[data-action="logo-remove"]');
    if (removeButton) removeButton.hidden = !payload.settings.logo;

    showSavedIndicator();
    showToast('Configurações salvas com sucesso.');
  } catch (error) {
    if (uploadedLogo && !committed) await removeImage(uploadedLogo.path);
    showToast(firebaseErrorMessage(error, 'Não foi possível salvar as configurações.'), 'error');
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function handlePasswordSave(event) {
  event.preventDefault();
  if (state.data.auth.isSuperAdmin) return;
  const currentPasswordInput = document.getElementById('password-current');
  const newPasswordInput = document.getElementById('password-new');
  const confirmPasswordInput = document.getElementById('password-confirm');
  const errorBox = document.getElementById('password-error');
  const saveButton = document.getElementById('password-save');
  if (!currentPasswordInput || !newPasswordInput || !confirmPasswordInput || !errorBox || !saveButton) return;

  errorBox.hidden = true;
  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmation = confirmPasswordInput.value;

  if (newPassword.length < 6) {
    errorBox.textContent = 'A nova senha precisa ter pelo menos 6 caracteres.';
    errorBox.hidden = false;
    newPasswordInput.focus();
    return;
  }
  if (newPassword !== confirmation) {
    errorBox.textContent = 'A confirmação não corresponde à nova senha.';
    errorBox.hidden = false;
    confirmPasswordInput.focus();
    return;
  }

  const form = event.currentTarget;
  setButtonLoading(saveButton, true, 'Atualizando...');
  try {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Sua sessão expirou. Entre novamente.');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    form.reset();
    showToast('Senha atualizada com sucesso.');
  } catch (error) {
    errorBox.textContent = firebaseErrorMessage(error, 'Não foi possível atualizar a senha.');
    errorBox.hidden = false;
    currentPasswordInput.focus();
    currentPasswordInput.select();
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function handlePasswordReset() {
  if (state.data.auth.isSuperAdmin) return;
  const email = auth.currentUser && auth.currentUser.email;
  if (!email) {
    showToast('Não foi possível identificar o e-mail da conta.', 'error');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Enviamos um link de redefinição para ${email}.`, 'success', 6000);
  } catch (error) {
    showToast(firebaseErrorMessage(error, 'Não foi possível enviar o link de redefinição.'), 'error');
  }
}

/* --------------------------------------------------------------------------
   Ações do painel
   -------------------------------------------------------------------------- */

async function handleContentClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement || !contentEl.contains(actionElement)) return;

  const action = actionElement.dataset.action;
  const id = actionElement.dataset.id;
  event.preventDefault();

  if (action === 'new-product') {
    openProductModal();
    return;
  }

  if (action === 'new-catalog') {
    if (!state.data.products.length) {
      showToast('Cadastre pelo menos um produto antes de criar um catálogo.', 'error');
      return;
    }
    openCatalogModal();
    return;
  }

  if (action === 'edit-product') {
    const product = state.data.products.find((item) => item.id === id);
    if (product) openProductModal(product);
    return;
  }

  if (action === 'delete-product') {
    const product = state.data.products.find((item) => item.id === id);
    if (product) await deleteProduct(product);
    return;
  }

  if (action === 'edit-catalog') {
    const catalog = state.data.catalogs.find((item) => item.id === id);
    if (catalog) openCatalogModal(catalog);
    return;
  }

  if (action === 'delete-catalog') {
    const catalog = state.data.catalogs.find((item) => item.id === id);
    if (catalog) await deleteCatalog(catalog);
    return;
  }

  if (action === 'copy-link') {
    if (actionElement.dataset.slug) await copyCatalogLink(actionElement.dataset.slug);
    return;
  }

  if (action === 'clear-product-search') {
    state.productSearch = '';
    const searchInput = document.getElementById('product-search');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    updateProductsResults();
    return;
  }

  if (action === 'logo-gallery') {
    const logoInput = document.getElementById('settings-logo-input');
    if (logoInput) logoInput.click();
    return;
  }

  if (action === 'logo-camera') {
    openCameraModal((file) => applySettingsLogoFile(file));
    return;
  }

  if (action === 'logo-remove') {
    settingsLogoDraft.url = '';
    settingsLogoDraft.path = '';
    settingsLogoDraft.dataUrl = '';
    settingsLogoDraft.preview = '';
    updateSettingsLogoPreview();
    actionElement.hidden = true;
  }
}
