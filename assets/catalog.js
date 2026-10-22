/* ==========================================================================
   MyStore — catálogo público
   ========================================================================== */

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { db, firebaseConfigured } from './firebase.js';

const state = {
  storeSlug: '',
  slug: '',
  legacy: false,
  data: null,
  selection: new Map(),
};

const els = {
  boot: document.getElementById('catalog-boot'),
  app: document.getElementById('catalog-app'),
  error: document.getElementById('catalog-error'),
  errorTitle: document.getElementById('error-title'),
  errorMessage: document.getElementById('error-message'),
  brand: document.getElementById('shop-brand'),
  footerBrand: document.getElementById('footer-brand'),
  hero: document.getElementById('catalog-hero'),
  heroSubtitle: document.getElementById('hero-subtitle'),
  heroArt: document.getElementById('hero-art'),
  products: document.getElementById('public-products'),
  productCount: document.getElementById('products-count'),
  empty: document.getElementById('catalog-empty'),
  cartBar: document.getElementById('cart-bar'),
  cartBadge: document.getElementById('cart-badge'),
  cartTitle: document.getElementById('cart-title'),
  cartTotal: document.getElementById('cart-total'),
  buyButton: document.getElementById('buy-button'),
  toast: document.getElementById('catalog-toast'),
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let toastTimer = null;

function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => replacements[char]);
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="assets/icons.svg#i-${name}"></use></svg>`;
}

function formatPrice(value) {
  if (value == null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return currencyFormatter.format(number);
}

function normalizeSlug(value) {
  const candidate = String(value == null ? '' : value).trim();
  return /^[a-zA-Z0-9-]{1,120}$/.test(candidate) ? candidate : '';
}

// Formatos aceitos:
//   /c/{loja}/{catalogo}                  -> link bonito (Firebase Hosting)
//   /catalog.html?loja={loja}&c={catalogo} -> hospedagem estática sem rewrite
//   /c/{catalogo}                         -> links antigos de loja única
function getRoute() {
  const params = new URLSearchParams(window.location.search);
  const queryCatalog = normalizeSlug(params.get('c'));
  const queryStore = normalizeSlug(params.get('loja'));

  if (queryCatalog) {
    return { storeSlug: queryStore, catalogSlug: queryCatalog, legacy: !queryStore };
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[2]) {
    return {
      storeSlug: normalizeSlug(decodeURIComponent(parts[1])),
      catalogSlug: normalizeSlug(decodeURIComponent(parts[2])),
      legacy: false,
    };
  }
  if (parts[0] === 'c' && parts[1]) {
    return { storeSlug: '', catalogSlug: normalizeSlug(decodeURIComponent(parts[1])), legacy: true };
  }
  return { storeSlug: '', catalogSlug: '', legacy: false };
}

function storageKey() {
  return `mystore:selection:${state.storeSlug || 'loja'}:${state.slug}`;
}

function loadSelection() {
  state.selection.clear();
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const validIds = new Set(state.data.products.map((product) => product.id));
    parsed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return;
      const id = String(entry[0]);
      const qty = Math.floor(Number(entry[1]));
      if (validIds.has(id) && qty > 0) state.selection.set(id, Math.min(qty, 99));
    });
  } catch {}
}

function saveSelection() {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify([...state.selection]));
  } catch {}
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible'), 3200);
}

function showError(message, title = 'Não encontramos este catálogo.') {
  els.boot.classList.add('is-hidden');
  els.app.classList.add('is-hidden');
  els.error.classList.remove('is-hidden');
  els.errorTitle.textContent = title;
  els.errorMessage.textContent = message || 'O link pode ter sido removido ou está incompleto. Entre em contato com a loja para receber uma nova seleção.';
  document.title = 'Catálogo indisponível';
}

function renderBrand(store) {
  if (store.logo) {
    els.brand.innerHTML = `<img class="shop-brand-logo" src="${escapeHtml(store.logo)}" alt="${escapeHtml(store.name)}">`;
    els.footerBrand.innerHTML = `<img class="footer-brand-logo" src="${escapeHtml(store.logo)}" alt="${escapeHtml(store.name)}">`;
  } else {
    els.brand.innerHTML = `<span class="shop-brand-name">${escapeHtml(store.name)}<span class="shop-brand-dot">.</span></span>`;
    els.footerBrand.innerHTML = `<span>${escapeHtml(store.name)}<span class="footer-brand-dot">.</span></span>`;
  }
}

function renderHero() {
  const { store, catalog, products } = state.data;
  if (catalog.name) {
    els.heroSubtitle.innerHTML = `Uma seleção especial preparada para <strong>${escapeHtml(catalog.name)}</strong>. Escolha seus favoritos e envie o pedido direto pelo WhatsApp.`;
  } else {
    els.heroSubtitle.textContent = 'Uma seleção especial dos nossos produtos, escolhida para você. Selecione seus favoritos e envie o pedido direto pelo WhatsApp.';
  }

  const images = products.filter((product) => product.image).slice(0, 2);
  if (!images.length) {
    els.heroArt.classList.add('is-hidden');
    els.heroArt.innerHTML = '';
    els.hero.classList.remove('has-art');
    return;
  }

  els.hero.classList.add('has-art');
  els.heroArt.classList.remove('is-hidden');
  els.heroArt.classList.toggle('single', images.length === 1);
  els.heroArt.innerHTML = `
    ${images.map((product, index) => `
      <div class="hero-photo hero-photo-${index === 0 ? 'a' : 'b'}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="eager">
      </div>
    `).join('')}
    <span class="hero-float">
      <span class="hero-float-icon">${icon('whatsapp')}</span>
      Pedido via WhatsApp
    </span>
    <span class="hero-spark spark-one">${icon('sparkles')}</span>
    <span class="hero-spark spark-two">${icon('sparkles')}</span>
  `;
  document.title = `${store.name} — Catálogo exclusivo`;
}

function productMarkup(product) {
  const qty = state.selection.get(product.id) || 0;
  const showPrice = state.data.store.showPrices
    && product.price != null
    && Number.isFinite(Number(product.price));
  return `
    <article class="catalog-product${qty > 0 ? ' is-selected' : ''}" data-product-id="${escapeHtml(product.id)}">
      <div class="product-visual">
        ${product.image
          ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">`
          : `<div class="product-placeholder">${icon('image')}<span>Foto em breve</span></div>`}
        <span class="select-indicator">${icon('check')}</span>
      </div>
      <div class="product-content">
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description || '')}</p>
        <div class="product-footer">
          ${showPrice ? `<span class="product-price">${formatPrice(product.price)}</span>` : '<span></span>'}
          ${qty > 0 ? `
            <div class="quantity-stepper" aria-label="Quantidade de ${escapeHtml(product.name)}">
              <button type="button" data-step="decrease" aria-label="Remover uma unidade">${icon('minus')}</button>
              <span aria-live="polite">${qty}</span>
              <button type="button" data-step="increase" aria-label="Adicionar uma unidade">${icon('plus')}</button>
            </div>
          ` : `
            <button class="select-product" type="button" data-step="increase">${icon('plus')} Selecionar</button>
          `}
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const products = state.data.products;
  els.productCount.textContent = `${products.length} ${products.length === 1 ? 'produto' : 'produtos'}`;
  if (!products.length) {
    els.products.innerHTML = '';
    els.products.classList.add('is-hidden');
    els.empty.classList.remove('is-hidden');
    return;
  }
  els.empty.classList.add('is-hidden');
  els.products.classList.remove('is-hidden');
  els.products.innerHTML = products.map(productMarkup).join('');
}

function selectedItems() {
  if (!state.data) return [];
  return state.data.products
    .filter((product) => state.selection.has(product.id))
    .map((product) => ({ product, qty: state.selection.get(product.id) || 0 }))
    .filter((item) => item.qty > 0);
}

function updateCartBar() {
  const items = selectedItems();
  const count = items.reduce((total, item) => total + item.qty, 0);

  if (!count) {
    els.cartBar.hidden = true;
    document.body.classList.remove('has-cart');
    return;
  }

  const showPrices = state.data.store.showPrices;
  const total = items.reduce((sum, item) => sum + Number(item.product.price || 0) * item.qty, 0);
  els.cartBar.hidden = false;
  document.body.classList.add('has-cart');
  els.cartBadge.textContent = count > 99 ? '99+' : String(count);
  els.cartTitle.textContent = `${count} ${count === 1 ? 'item selecionado' : 'itens selecionados'}`;

  if (showPrices) {
    els.cartTotal.innerHTML = `Total <strong>${escapeHtml(formatPrice(total))}</strong>`;
  } else {
    els.cartTotal.textContent = 'Pedido enviado pelo WhatsApp';
  }

  const phone = String(state.data.store.whatsapp || '').replace(/\D/g, '');
  els.buyButton.disabled = !phone;
  els.buyButton.innerHTML = phone
    ? `${icon('whatsapp')} Comprar`
    : `${icon('whatsapp')} WhatsApp indisponível`;
}

function refreshSelectionUI() {
  saveSelection();
  renderProducts();
  updateCartBar();
}

function buildOrderMessage() {
  const { store, catalog } = state.data;
  const items = selectedItems();
  const showPrices = store.showPrices;
  let message = `Olá! Vim pelo catálogo *${store.name}*${catalog.name ? ` (${catalog.name})` : ''} e quero fazer este pedido:\n\n`;

  items.forEach(({ product, qty }) => {
    message += `• *${qty}x ${product.name}*`;
    if (showPrices) message += ` — ${formatPrice(product.price * qty)}`;
    message += '\n';
  });

  if (showPrices) {
    const total = items.reduce((sum, item) => sum + Number(item.product.price || 0) * item.qty, 0);
    message += `\n*Total: ${formatPrice(total)}*\n`;
  }

  message += '\nAguardo a confirmação. Obrigado!';
  return message;
}

function bindPageEvents() {
  els.products.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    const card = button.closest('[data-product-id]');
    if (!card) return;
    const id = card.dataset.productId;
    const current = state.selection.get(id) || 0;
    const next = button.dataset.step === 'increase'
      ? Math.min(99, current + 1)
      : Math.max(0, current - 1);

    if (next === 0) state.selection.delete(id);
    else state.selection.set(id, next);
    refreshSelectionUI();
  });

  els.buyButton.addEventListener('click', () => {
    if (!state.selection.size) return;
    const phone = String(state.data.store.whatsapp || '').replace(/\D/g, '');
    if (!phone) {
      showToast('A loja ainda não configurou um WhatsApp para receber pedidos.');
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildOrderMessage())}`;
    const opened = window.open(url, '_blank');
    if (opened) {
      try { opened.opener = null; } catch {}
    } else {
      window.location.assign(url);
    }
  });
}

function renderPage() {
  renderBrand(state.data.store);
  renderHero();
  renderProducts();
  updateCartBar();
  document.title = `${state.data.store.name} — Catálogo exclusivo`;
  els.boot.classList.add('is-hidden');
  els.error.classList.add('is-hidden');
  els.app.classList.remove('is-hidden');
}

async function loadStoreProducts(storeSlug, catalog, showPrices, productIds) {
  const [productSnaps, priceSnaps] = await Promise.all([
    Promise.all(productIds.map((productId) => getDoc(doc(db, 'stores', storeSlug, 'products', productId)))),
    showPrices
      ? Promise.all(productIds.map((productId) => getDoc(doc(db, 'stores', storeSlug, 'productPrices', productId)).catch(() => null)))
      : Promise.resolve(productIds.map(() => null)),
  ]);

  return productIds
    .map((productId, index) => {
      const productSnap = productSnaps[index];
      if (!productSnap || !productSnap.exists()) return null;
      const product = productSnap.data();
      const priceSnap = priceSnaps[index];
      const price = priceSnap && priceSnap.exists() ? Number(priceSnap.data().price) : null;
      return {
        id: productId,
        name: product.name || '',
        description: product.description || '',
        image: product.imageUrl || '',
        price: showPrices && Number.isFinite(price) ? price : null,
      };
    })
    .filter(Boolean);
}

function finalizeCatalog(store, catalog, catalogSlug, products) {
  const effectiveShowPrices = store.showPrices
    && products.length > 0
    && products.every((product) => Number.isFinite(product.price));

  return {
    store: {
      name: store.name || 'Minha Loja',
      logo: store.logo || '',
      whatsapp: store.whatsapp || '',
      showPrices: effectiveShowPrices,
    },
    catalog: {
      name: catalog.name || '',
      slug: catalogSlug,
      updatedAt: catalog.updatedAt || '',
    },
    products: products.map((product) => ({
      ...product,
      price: effectiveShowPrices ? product.price : null,
    })),
  };
}

async function loadCatalogNew(storeSlug, catalogSlug) {
  const storeSnap = await getDoc(doc(db, 'stores', storeSlug));
  if (!storeSnap.exists()) {
    throw new Error('A loja deste link não foi encontrada. Peça um novo link para o responsável.');
  }
  const storeData = storeSnap.data() || {};
  if (storeData.status === 'paused') {
    throw new Error('Esta loja está temporariamente indisponível. Volte em breve ou fale com o responsável.');
  }

  const catalogSnap = await getDoc(doc(db, 'stores', storeSlug, 'catalogs', catalogSlug));
  if (!catalogSnap.exists()) {
    throw new Error('O link pode ter sido removido ou está incompleto. Entre em contato com a loja para receber uma nova seleção.');
  }

  const catalog = catalogSnap.data() || {};
  const productIds = Array.isArray(catalog.productIds) ? catalog.productIds.map(String) : [];
  const showPrices = storeData.showPrices !== false;
  const products = await loadStoreProducts(storeSlug, catalog, showPrices, productIds);

  return finalizeCatalog(
    {
      name: storeData.name || 'Minha Loja',
      logo: storeData.logoUrl || '',
      whatsapp: storeData.whatsapp || '',
      showPrices,
    },
    catalog,
    catalogSlug,
    products
  );
}

// Links antigos, de quando existia apenas uma loja no projeto.
async function loadCatalogLegacy(catalogSlug) {
  const [catalogSnap, settingsSnap] = await Promise.all([
    getDoc(doc(db, 'catalogs', catalogSlug)),
    getDoc(doc(db, 'store', 'config')),
  ]);

  if (!catalogSnap.exists()) {
    throw new Error('O link pode ter sido removido ou está incompleto. Entre em contato com a loja para receber uma nova seleção.');
  }

  const catalog = catalogSnap.data() || {};
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};
  const productIds = Array.isArray(catalog.productIds) ? catalog.productIds.map(String) : [];
  const showPrices = settings.showPrices !== false;

  const [productSnaps, priceSnaps] = await Promise.all([
    Promise.all(productIds.map((productId) => getDoc(doc(db, 'products', productId)))),
    showPrices
      ? Promise.all(productIds.map((productId) => getDoc(doc(db, 'productPrices', productId)).catch(() => null)))
      : Promise.resolve(productIds.map(() => null)),
  ]);

  const products = productIds
    .map((productId, index) => {
      const productSnap = productSnaps[index];
      if (!productSnap || !productSnap.exists()) return null;
      const product = productSnap.data();
      const priceSnap = priceSnaps[index];
      const price = priceSnap && priceSnap.exists() ? Number(priceSnap.data().price) : null;
      return {
        id: productId,
        name: product.name || '',
        description: product.description || '',
        image: product.imageUrl || '',
        price: showPrices && Number.isFinite(price) ? price : null,
      };
    })
    .filter(Boolean);

  return finalizeCatalog(
    {
      name: settings.storeName || 'Minha Loja',
      logo: settings.logoUrl || '',
      whatsapp: settings.whatsapp || '',
      showPrices,
    },
    catalog,
    catalogSlug,
    products
  );
}

async function init() {
  const route = getRoute();
  state.storeSlug = route.storeSlug || '';
  state.slug = route.catalogSlug;
  state.legacy = route.legacy;

  if (!firebaseConfigured) {
    showError('Este catálogo ainda não foi conectado ao Firebase. Avise a loja.', 'Catálogo não configurado.');
    return;
  }

  if (!state.slug || (!state.legacy && !state.storeSlug)) {
    showError('O endereço deste catálogo está incompleto. Peça um novo link para a loja.');
    return;
  }

  try {
    state.data = state.legacy
      ? await loadCatalogLegacy(state.slug)
      : await loadCatalogNew(state.storeSlug, state.slug);
    loadSelection();
    bindPageEvents();
    renderPage();
  } catch (error) {
    console.error(error);
    const code = String((error && error.code) || '');
    if (code === 'permission-denied') {
      showError('Este catálogo está indisponível no momento. Peça um novo link para a loja.', 'Catálogo indisponível.');
      return;
    }
    showError(error.message || 'Não foi possível carregar este catálogo.');
  }
}

init();
