/* Ustadi Counter — local-first POS UI */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = null;
let cart = [];
let orderLines = [];
let channel = "walk-in";
let method = "cash";
let search = "";
let category = "all";
let activeTab = "sell";
let toastTimer = null;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));

const kes = (cents) => `KSh ${(Number(cents || 0) / 100).toLocaleString("en-KE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

const dateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-KE", { weekday: "short" });

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function loadState(quiet = false) {
  try {
    state = await api("/api/state");
    renderAll();
    if (!quiet) $("#sync-status").textContent = "Synced · local";
  } catch (error) {
    if (!quiet) toast(error.message);
  }
}

function renderAll() {
  if (!state) return;
  $("#device-name").textContent = state.meta.deviceName;
  $("#today").textContent = new Date(state.serverTime).toLocaleDateString("en-KE", {
    weekday: "short", day: "numeric", month: "short"
  });
  $("#orders-count").textContent = state.projection.pendingOrders.length;
  $("#tabs-note").textContent = `${state.projection.sales.length} sales · ${state.projection.products.length} products · local ledger`;
  renderProducts();
  renderCart();
  renderOrders();
  renderStock();
  renderBrief();
  renderSync();
}

function setTab(name) {
  activeTab = name;
  $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `tab-${name}`));
}

/* ---------- products + cart ---------- */

function renderProducts() {
  if (!state) return;
  const products = state.projection.products.filter((product) => product.active);
  const topIds = new Set(state.projection.topProducts.map((item) => item.productId));
  let filtered = products;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q));
  }
  if (category === "low") filtered = filtered.filter((p) => p.stock <= p.lowStockAt);
  if (category === "fast") filtered = filtered.filter((p) => topIds.has(p.productId));

  $("#product-grid").innerHTML = filtered.map((product) => {
    const low = product.stock <= product.lowStockAt;
    return `
      <button class="product-card ${low ? "is-low" : ""}" data-add="${esc(product.productId)}" type="button">
        <span class="product-top">
          <span>
            <span class="product-name">${esc(product.name)}</span>
            <span class="product-sku">${esc(product.sku || "—")}</span>
          </span>
          <span class="stock-badge ${low ? "is-low" : ""}">${product.stock} left</span>
        </span>
        <span class="product-price">${kes(product.priceCents)}</span>
      </button>`;
  }).join("");
  $("#products-empty").hidden = filtered.length > 0 || products.length === 0;
}

function addToCart(productId) {
  const product = state.projection.products.find((item) => item.productId === productId);
  if (!product) return;
  const line = cart.find((item) => item.productId === productId);
  const inCart = line?.qty ?? 0;
  if (inCart >= product.stock) {
    toast(`Only ${product.stock} ${product.name} left.`);
    return;
  }
  if (line) line.qty += 1;
  else cart.push({ productId, qty: 1 });
  renderCart();
}

function cartSubtotal() {
  return cart.reduce((sum, line) => {
    const product = state.projection.products.find((item) => item.productId === line.productId);
    return sum + (product ? product.priceCents * line.qty : 0);
  }, 0);
}

function discountCents() {
  const value = Number($("#discount").value || 0);
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
}

function cartTotal() {
  return Math.max(0, cartSubtotal() - discountCents());
}

function renderCart() {
  if (!state) return;
  const container = $("#cart-lines");
  if (cart.length === 0) {
    container.innerHTML = "";
    $("#cart-empty").hidden = false;
    $("#cart-count").textContent = "0 items";
  } else {
    $("#cart-empty").hidden = true;
    container.innerHTML = cart.map((line) => {
      const product = state.projection.products.find((item) => item.productId === line.productId);
      if (!product) return "";
      return `
        <div class="cart-line">
          <div>
            <div class="cart-line-name">${esc(product.name)}</div>
            <div class="cart-line-meta">${kes(product.priceCents)} × ${line.qty}</div>
          </div>
          <div class="cart-line-actions">
            <button class="qty-btn" data-dec="${esc(line.productId)}" type="button">−</button>
            <span class="cart-line-total">${line.qty}</span>
            <button class="qty-btn" data-inc="${esc(line.productId)}" type="button">+</button>
            <button class="qty-btn" data-remove="${esc(line.productId)}" type="button">×</button>
          </div>
        </div>`;
    }).join("");
    $("#cart-count").textContent = `${cart.reduce((sum, line) => sum + line.qty, 0)} items`;
  }
  updateTotals();
}

function updateTotals() {
  $("#subtotal").textContent = kes(cartSubtotal());
  $("#total").textContent = kes(cartTotal());
  $("#checkout").disabled = cart.length === 0;
}

function clearCart() {
  cart = [];
  $("#discount").value = "0";
  $("#customer-name").value = "";
  $("#mpesa-ref").value = "";
  $("#mpesa-pending").checked = false;
  renderCart();
}

async function checkout() {
  if (cart.length === 0) return;
  const button = $("#checkout");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const body = {
      channel: $("#channel").value,
      lines: cart,
      method,
      status: method === "mpesa" && $("#mpesa-pending").checked ? "pending" : "confirmed",
      reference: $("#mpesa-ref").value.trim() || undefined,
      customerName: $("#customer-name").value.trim() || undefined,
      discountCents: discountCents()
    };
    state = await api("/api/sales", { method: "POST", body: JSON.stringify(body) });
    const sale = state.projection.sales[0];
    clearCart();
    renderAll();
    if (sale) openReceipt(sale);
    toast(`Sale saved · ${kes(sale?.totalCents ?? 0)}`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = "Complete sale →";
    button.disabled = cart.length === 0;
  }
}

/* ---------- receipt ---------- */

function openReceipt(sale) {
  if (!sale) return;
  $("#receipt-body").innerHTML = `
    <div class="receipt-meta">${esc(sale.businessDate)} · ${esc(sale.channel)} · ${esc(state.meta.deviceName)}</div>
    ${sale.lines.map((line) => `
      <div class="receipt-line">
        <span>${line.qty} × ${esc(line.name)}</span>
        <span>${kes(line.qty * line.unitPriceCents)}</span>
      </div>`).join("")}
    <div class="receipt-line"><span>Subtotal</span><span>${kes(sale.subtotalCents)}</span></div>
    ${sale.discountCents ? `<div class="receipt-line"><span>Discount</span><span>−${kes(sale.discountCents)}</span></div>` : ""}
    <div class="receipt-total"><span>Total</span><span>${kes(sale.totalCents)}</span></div>
    <div class="receipt-meta">${sale.payments.map((p) => `${esc(p.method.toUpperCase())} · ${p.status}${p.reference ? ` · ${esc(p.reference)}` : ""}`).join("<br>")}</div>
    <div class="receipt-meta">Receipt ${esc(sale.saleId)}</div>
  `;
  $("#receipt-modal").hidden = false;
}

function closeReceipt() {
  $("#receipt-modal").hidden = true;
}

/* ---------- orders ---------- */

function renderOrders() {
  if (!state) return;
  const orders = state.projection.orders;
  $("#orders-list").innerHTML = orders.length ? orders.map((order) => `
    <article class="order-card">
      <div>
        <span class="order-name">${esc(order.customerName || "Walk-in")}</span>
        <div class="order-meta">
          <span class="status ${esc(order.status)}">${esc(order.status)}</span>
          <span>${esc(order.channel)}</span>
          <span>${new Date(order.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</span>
        </div>
        <div class="order-lines-mini">${order.lines.map((line) => `${line.qty} × ${esc(line.name)}`).join(" · ")}</div>
        ${order.note ? `<p class="fine" style="margin-top:5px">${esc(order.note)}</p>` : ""}
      </div>
      <div class="order-side">
        <div class="order-total">${kes(order.totalCents)}</div>
        ${order.status !== "fulfilled" && order.status !== "cancelled" ? `
          <div class="order-actions">
            <select data-order-method="${esc(order.orderId)}" aria-label="Payment method">
              <option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="card">Card</option>
            </select>
            <button data-order-pay="${esc(order.orderId)}" type="button">Pay</button>
            <button data-order-fulfill="${esc(order.orderId)}" type="button">Fulfill</button>
          </div>` : ""}
      </div>
    </article>`).join("") : `<p class="empty">No orders yet. Log a WhatsApp or phone order to see it here.</p>`;

  const productOptions = state.projection.products.filter((p) => p.active)
    .map((p) => `<option value="${esc(p.productId)}">${esc(p.name)} · ${kes(p.priceCents)}</option>`).join("");
  const select = $("#order-product");
  if (select) select.innerHTML = productOptions || `<option value="">No products</option>`;
}

function addOrderLine() {
  const productId = $("#order-product").value;
  const qty = Number($("#order-qty").value || 1);
  const product = state?.projection.products.find((item) => item.productId === productId);
  if (!product || !Number.isInteger(qty) || qty <= 0) return;
  const existing = orderLines.find((line) => line.productId === productId);
  if (existing) existing.qty += qty;
  else orderLines.push({ productId, qty, name: product.name, priceCents: product.priceCents });
  renderOrderLines();
}

function renderOrderLines() {
  const total = orderLines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  $("#order-lines").innerHTML = orderLines.map((line) => `
    <div class="order-line"><span>${line.qty} × ${esc(line.name)}</span><span>${kes(line.priceCents * line.qty)}</span></div>`).join("");
  $("#order-total").textContent = kes(total);
  $("#create-order").disabled = orderLines.length === 0;
}

async function createOrder() {
  if (orderLines.length === 0) return;
  try {
    state = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        channel: $("#order-channel").value,
        customerName: $("#order-customer").value.trim() || "Walk-in",
        customerPhone: $("#order-phone").value.trim() || undefined,
        note: $("#order-note").value.trim() || undefined,
        lines: orderLines.map((line) => ({ productId: line.productId, qty: line.qty }))
      })
    });
    orderLines = [];
    $("#order-customer").value = "";
    $("#order-phone").value = "";
    $("#order-note").value = "";
    renderAll();
    toast("Order logged.");
  } catch (error) {
    toast(error.message);
  }
}

async function payOrder(orderId) {
  try {
    state = await api(`/api/orders/${encodeURIComponent(orderId)}/pay`, { method: "POST", body: "{}" });
    renderAll();
    toast("Order marked paid.");
  } catch (error) {
    toast(error.message);
  }
}

async function fulfillOrder(orderId) {
  const methodSelect = document.querySelector(`[data-order-method="${CSS.escape(orderId)}"]`);
  try {
    state = await api(`/api/orders/${encodeURIComponent(orderId)}/fulfill`, {
      method: "POST",
      body: JSON.stringify({ method: methodSelect?.value || "mpesa", status: "confirmed" })
    });
    renderAll();
    toast("Order fulfilled · sale added to the ledger.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- stock ---------- */

function renderStock() {
  if (!state) return;
  $("#stock-body").innerHTML = state.projection.products.map((product) => `
    <tr>
      <td><div class="stock-name">${esc(product.name)}</div></td>
      <td><span class="stock-sku">${esc(product.sku || "—")}</span></td>
      <td>${kes(product.priceCents)}</td>
      <td>${kes(product.costCents)}</td>
      <td><span class="stock-count ${product.stock <= product.lowStockAt ? "is-low" : ""}">${product.stock}</span></td>
      <td><div class="stock-adjust">
        <button data-stock="${esc(product.productId)}" data-delta="-1" type="button">−</button>
        <button data-stock="${esc(product.productId)}" data-delta="1" type="button">+</button>
      </div></td>
    </tr>`).join("") || `<tr><td colspan="6" class="fine">No products yet.</td></tr>`;
}

async function adjustStock(productId, delta) {
  try {
    state = await api("/api/stock", {
      method: "POST",
      body: JSON.stringify({ productId, delta, reason: "counter adjustment" })
    });
    renderAll();
  } catch (error) {
    toast(error.message);
  }
}

async function addProduct() {
  const price = Number($("#new-price").value || 0);
  const cost = Number($("#new-cost").value || 0);
  try {
    state = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: $("#new-name").value.trim(),
        sku: $("#new-sku").value.trim(),
        stock: Number($("#new-stock").value || 0),
        priceCents: Math.round(price * 100),
        costCents: Math.round(cost * 100),
        lowStockAt: Number($("#new-low").value || 5)
      })
    });
    $("#new-name").value = "";
    $("#new-sku").value = "";
    $("#new-stock").value = "0";
    $("#new-price").value = "0";
    $("#new-cost").value = "0";
    renderAll();
    toast("Product added.");
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- brief ---------- */

function renderBrief() {
  if (!state) return;
  const brief = state.brief;
  $("#brief-lede").textContent = brief.title;
  $("#brief-metrics").innerHTML = brief.metrics.map((metric) => `
    <div class="metric"><div class="label">${esc(metric.label)}</div><div class="value ${esc(metric.tone || "")}">${esc(metric.value)}</div></div>`).join("");
  $("#brief-text").textContent = brief.text;
  $("#brief-actions").innerHTML = brief.actions.map((action) => `<li>${esc(action)}</li>`).join("");

  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = dateKey(date);
    days.push({ key, label: shortDay(key), value: state.projection.days[key]?.salesCents ?? 0 });
  }
  const max = Math.max(1, ...days.map((day) => day.value));
  $("#brief-bars").innerHTML = days.map((day) => `
    <div class="bar" title="${day.key}: ${kes(day.value)}">
      <div class="bar-fill" style="height:${Math.max(2, (day.value / max) * 100)}%"></div>
      <div class="bar-label">${esc(day.label)}</div>
    </div>`).join("");

  $("#top-products").innerHTML = state.projection.topProducts.map((item) => `
    <li>${esc(item.name)} · ${item.qty} sold · ${kes(item.revenueCents)}</li>`).join("") || "<li>No sales yet.</li>";

  $("#low-stock").innerHTML = state.projection.lowStock.map((product) => `
    <div class="low-item"><strong>${esc(product.name)}</strong><span class="pill">${product.stock} left</span></div>`).join("") || `<p class="fine">Nothing urgent. The shelf is healthy.</p>`;

  $("#pending-orders").innerHTML = state.projection.pendingOrders.map((order) => `
    <div class="pending-item"><strong>${esc(order.customerName || "Walk-in")}</strong><span>${kes(order.totalCents)} · ${esc(order.status)}</span></div>`).join("") || `<p class="fine">No pending orders.</p>`;
}

function printBrief() {
  if (!state) return;
  const brief = state.brief;
  const windowRef = window.open("", "_blank", "width=720,height=900");
  if (!windowRef) {
    toast("Allow pop-ups to print the brief.");
    return;
  }
  windowRef.document.write(`<!doctype html><title>${esc(brief.title)}</title><body style="font-family:Georgia,serif;padding:32px;color:#10241d"><p style="font-family:monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase">Ustadi Counter</p><h1>${esc(brief.title)}</h1><p style="font-size:18px;line-height:1.6">${esc(brief.text)}</p><h2 style="margin-top:24px">What to do</h2><ul>${brief.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul><p style="margin-top:24px;font-family:monospace;font-size:10px;color:#676b62">Generated ${esc(brief.generatedAt)} · local ledger</p></body>`);
  windowRef.document.close();
  windowRef.focus();
  setTimeout(() => windowRef.print(), 250);
}

/* ---------- sync ---------- */

function renderSync() {
  if (!state) return;
  $("#sync-device").textContent = state.meta.deviceName;
  $("#sync-device-id").textContent = state.meta.deviceId;
  $("#pair-code").textContent = state.meta.pairingCode;
  const urls = state.meta.lanUrls?.length ? state.meta.lanUrls : [window.location.origin];
  $("#lan-urls").innerHTML = urls.map((url) => `<code>${esc(url)}</code>`).join("");
  $("#sync-vector").textContent = `vector ${JSON.stringify(state.vector)} · ${state.projection.sales.length} sales · ${state.projection.products.length} products`;
  $("#license-mode").textContent = state.license.mode === "licensed" ? "Licensed" : state.license.mode;
  $("#license-message").textContent = state.license.message;
  $("#license-expiry").textContent = state.license.expiresAt ? `Expires ${state.license.expiresAt.slice(0, 10)}` : "";
}

async function syncPeer() {
  const url = $("#peer-url").value.trim();
  const code = $("#peer-code").value.trim();
  if (!url || !code) {
    toast("Enter the peer address and pairing code.");
    return;
  }
  const button = $("#sync-peer");
  button.disabled = true;
  button.textContent = "Syncing…";
  $("#sync-result").textContent = "";
  try {
    const result = await api("/api/sync/peer", { method: "POST", body: JSON.stringify({ url, code }) });
    $("#sync-result").textContent = `Pulled ${result.pulled}; pushed ${result.pushed ?? 0}; accepted ${result.accepted}; skipped ${result.skipped}${result.gaps?.length ? ` · ${result.gaps.length} gap(s)` : ""}.`;
    state = result.state;
    renderAll();
    toast("Nearby sync complete.");
  } catch (error) {
    $("#sync-result").textContent = error.message;
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Sync now ⇄";
  }
}

/* ---------- events ---------- */

function connectEvents() {
  if (!window.EventSource) return;
  const source = new EventSource("/api/events");
  source.onopen = () => {
    $("#live-dot").style.background = "var(--mint)";
    $("#sync-status").textContent = "Live · local";
  };
  source.onerror = () => {
    $("#live-dot").style.background = "var(--coral)";
    $("#sync-status").textContent = "Offline · ledger local";
  };
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") loadState(true);
    } catch {
      // ignore malformed events
    }
  };
}

/* ---------- wiring ---------- */

document.addEventListener("DOMContentLoaded", () => {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));

  $("#product-search").addEventListener("input", (event) => {
    search = event.target.value;
    renderProducts();
  });
  $("#product-search").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      search = "";
      renderProducts();
    }
  });

  $("#category-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-cat]");
    if (!chip) return;
    category = chip.dataset.cat;
    $$("#category-chips .chip").forEach((el) => el.classList.toggle("is-active", el === chip));
    renderProducts();
  });

  $("#product-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-add]");
    if (card) addToCart(card.dataset.add);
  });

  $("#cart-lines").addEventListener("click", (event) => {
    const inc = event.target.closest("[data-inc]");
    const dec = event.target.closest("[data-dec]");
    const remove = event.target.closest("[data-remove]");
    if (inc) {
      const line = cart.find((item) => item.productId === inc.dataset.inc);
      const product = state.projection.products.find((item) => item.productId === inc.dataset.inc);
      if (line && product && line.qty < product.stock) line.qty += 1;
      renderCart();
    }
    if (dec) {
      const line = cart.find((item) => item.productId === dec.dataset.dec);
      if (line) line.qty -= 1;
      cart = cart.filter((item) => item.qty > 0);
      renderCart();
    }
    if (remove) {
      cart = cart.filter((item) => item.productId !== remove.dataset.remove);
      renderCart();
    }
  });

  $("#discount").addEventListener("input", updateTotals);
  $("#channel").addEventListener("change", (event) => { channel = event.target.value; });
  $("#clear-cart").addEventListener("click", clearCart);
  $("#checkout").addEventListener("click", checkout);

  $$(".pay-method").forEach((button) => button.addEventListener("click", () => {
    method = button.dataset.method;
    $$(".pay-method").forEach((el) => el.classList.toggle("is-active", el === button));
    $("#mpesa-fields").hidden = method !== "mpesa";
  }));

  $("#add-order-line").addEventListener("click", addOrderLine);
  $("#create-order").addEventListener("click", createOrder);
  $("#orders-list").addEventListener("click", (event) => {
    const pay = event.target.closest("[data-order-pay]");
    const fulfill = event.target.closest("[data-order-fulfill]");
    if (pay) payOrder(pay.dataset.orderPay);
    if (fulfill) fulfillOrder(fulfill.dataset.orderFulfill);
  });

  $("#add-product").addEventListener("click", addProduct);
  $("#stock-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock]");
    if (button) adjustStock(button.dataset.stock, Number(button.dataset.delta));
  });

  $("#print-brief").addEventListener("click", printBrief);
  $("#close-receipt").addEventListener("click", closeReceipt);
  $("#new-sale").addEventListener("click", () => { closeReceipt(); setTab("sell"); });
  $("#print-receipt").addEventListener("click", () => window.print());
  $("#receipt-modal").addEventListener("click", (event) => {
    if (event.target === $("#receipt-modal")) closeReceipt();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReceipt();
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT") {
      event.preventDefault();
      $("#product-search").focus();
    }
  });

  $("#copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#pair-code").textContent);
      toast("Pairing code copied.");
    } catch {
      toast("Copy failed; read the code aloud.");
    }
  });
  $("#sync-peer").addEventListener("click", syncPeer);

  loadState();
  connectEvents();
  renderOrderLines();
});
