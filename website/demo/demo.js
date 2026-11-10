/* Standalone Ustadi counter demo — no server, no persistence, sample data only. */

const $ = (selector) => document.querySelector(selector);
const kes = (cents) => `KSh ${(Number(cents || 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const initialProducts = [
  { id: "d-unga", name: "Unga 2kg", sku: "UNGA-2", price: 18000, cost: 15500, stock: 24, low: 6 },
  { id: "d-milk", name: "Milk 500ml", sku: "MILK-5", price: 6500, cost: 5200, stock: 18, low: 6 },
  { id: "d-sugar", name: "Sugar 1kg", sku: "SUGAR-1", price: 16000, cost: 14000, stock: 12, low: 5 },
  { id: "d-oil", name: "Cooking oil 1L", sku: "OIL-1", price: 32000, cost: 28500, stock: 8, low: 4 },
  { id: "d-soap", name: "Soap bar", sku: "SOAP-1", price: 8500, cost: 6800, stock: 30, low: 8 },
  { id: "d-bread", name: "Bread", sku: "BREAD-1", price: 7000, cost: 5500, stock: 12, low: 8 },
  { id: "d-eggs", name: "Eggs tray", sku: "EGGS-30", price: 42000, cost: 37000, stock: 4, low: 5 }
];

let products = initialProducts.map((product) => ({ ...product }));
let cart = new Map();
let sales = [];
let method = "cash";
let search = "";
let category = "all";
let toastTimer = null;

function toast(message) {
  const el = $("#demo-toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function renderProducts() {
  const filtered = products.filter((product) => {
    if (search && !`${product.name} ${product.sku}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (category === "low" && product.stock > product.low) return false;
    return true;
  });
  $("#demo-products").innerHTML = filtered.map((product) => {
    const low = product.stock <= product.low;
    return `
      <button class="product-card ${low ? "is-low" : ""}" data-add="${product.id}" type="button">
        <span class="product-top">
          <span><span class="product-name">${product.name}</span><span class="product-sku">${product.sku}</span></span>
          <span class="stock-badge ${low ? "is-low" : ""}">${product.stock} left</span>
        </span>
        <span class="product-price">${kes(product.price)}</span>
      </button>`;
  }).join("") || `<p class="empty">No products match that search.</p>`;
}

function add(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  const qty = cart.get(id) ?? 0;
  if (qty >= product.stock) {
    toast(`Only ${product.stock} ${product.name} left.`);
    return;
  }
  cart.set(id, qty + 1);
  renderCart();
}

function subtotal() {
  let total = 0;
  for (const [id, qty] of cart) {
    const product = products.find((item) => item.id === id);
    if (product) total += product.price * qty;
  }
  return total;
}

function discount() {
  const value = Number($("#demo-discount").value || 0);
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
}

function total() { return Math.max(0, subtotal() - discount()); }

function renderCart() {
  const lines = [...cart.entries()];
  $("#demo-empty").hidden = lines.length > 0;
  $("#demo-cart-count").textContent = `${lines.reduce((sum, [, qty]) => sum + qty, 0)} items`;
  $("#demo-cart").innerHTML = lines.map(([id, qty]) => {
    const product = products.find((item) => item.id === id);
    if (!product) return "";
    return `
      <div class="cart-line">
        <div><div class="cart-line-name">${product.name}</div><div class="cart-line-meta">${kes(product.price)} × ${qty}</div></div>
        <div class="cart-line-actions">
          <button class="qty-btn" data-dec="${id}" type="button">−</button>
          <span class="cart-line-total">${qty}</span>
          <button class="qty-btn" data-inc="${id}" type="button">+</button>
          <button class="qty-btn" data-remove="${id}" type="button">×</button>
        </div>
      </div>`;
  }).join("");
  $("#demo-subtotal").textContent = kes(subtotal());
  $("#demo-total").textContent = kes(total());
  $("#demo-checkout").disabled = lines.length === 0;
}

function renderBrief() {
  const salesTotal = sales.reduce((sum, sale) => sum + sale.total, 0);
  const cost = sales.reduce((sum, sale) => sum + sale.cost, 0);
  const items = sales.reduce((sum, sale) => sum + sale.qty, 0);
  const low = products.filter((product) => product.stock <= product.low);
  $("#demo-metrics").innerHTML = `
    <div class="metric"><div class="label">Sales today</div><div class="value">${kes(salesTotal)}</div></div>
    <div class="metric"><div class="label">Gross profit</div><div class="value good">${kes(salesTotal - cost)}</div></div>
    <div class="metric"><div class="label">Cash in</div><div class="value good">${kes(salesTotal)}</div></div>
    <div class="metric"><div class="label">Items sold</div><div class="value">${items}</div></div>
    <div class="metric"><div class="label">Low stock</div><div class="value ${low.length ? "warn" : ""}">${low.length}</div></div>`;
  $("#demo-brief-text").textContent = sales.length
    ? `Today: ${kes(salesTotal)} in sales across ${sales.length} sale${sales.length === 1 ? "" : "s"}. Gross profit ${kes(salesTotal - cost)}; ${items} item${items === 1 ? "" : "s"} sold. ${low.length ? `${low.length} product${low.length === 1 ? "" : "s"} at or below the low-stock line.` : "The shelf is healthy."}`
    : "No sales yet. Add a product to the cart and take the first sale.";
  $("#demo-low").innerHTML = low.length
    ? low.map((product) => `<div class="low-item"><strong>${product.name}</strong><span class="pill">${product.stock} left</span></div>`).join("")
    : `<p class="fine">Nothing urgent. The shelf is healthy.</p>`;
}

function checkout() {
  const lines = [...cart.entries()];
  if (lines.length === 0) return;
  const saleLines = [];
  let cost = 0;
  for (const [id, qty] of lines) {
    const product = products.find((item) => item.id === id);
    if (!product) continue;
    product.stock -= qty;
    saleLines.push({ name: product.name, qty, price: product.price });
    cost += product.cost * qty;
  }
  const sale = { lines: saleLines, total: total(), cost, qty: lines.reduce((sum, [, qty]) => sum + qty, 0), method };
  sales.push(sale);
  cart = new Map();
  $("#demo-discount").value = "0";
  renderProducts();
  renderCart();
  renderBrief();
  openReceipt(sale);
  toast(`Sale saved · ${kes(sale.total)}`);
}

function openReceipt(sale) {
  $("#receipt-body").innerHTML = `
    <div class="receipt-meta">Today · ${$("#demo-channel").value} · demo counter</div>
    ${sale.lines.map((line) => `<div class="receipt-line"><span>${line.qty} × ${line.name}</span><span>${kes(line.qty * line.price)}</span></div>`).join("")}
    <div class="receipt-total"><span>Total</span><span>${kes(sale.total)}</span></div>
    <div class="receipt-meta">${sale.method.toUpperCase()} · confirmed</div>`;
  $("#receipt-modal").hidden = false;
}

function closeReceipt() { $("#receipt-modal").hidden = true; }

function resetDemo() {
  products = initialProducts.map((product) => ({ ...product }));
  cart = new Map();
  sales = [];
  $("#demo-discount").value = "0";
  closeReceipt();
  renderProducts();
  renderCart();
  renderBrief();
  toast("Demo reset.");
}

$("#demo-products").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) add(button.dataset.add);
});
$("#demo-cart").addEventListener("click", (event) => {
  const inc = event.target.closest("[data-inc]");
  const dec = event.target.closest("[data-dec]");
  const remove = event.target.closest("[data-remove]");
  if (inc) {
    const product = products.find((item) => item.id === inc.dataset.inc);
    const qty = cart.get(inc.dataset.inc) ?? 0;
    if (product && qty < product.stock) cart.set(inc.dataset.inc, qty + 1);
    renderCart();
  }
  if (dec) {
    const qty = (cart.get(dec.dataset.dec) ?? 0) - 1;
    if (qty <= 0) cart.delete(dec.dataset.dec); else cart.set(dec.dataset.dec, qty);
    renderCart();
  }
  if (remove) { cart.delete(remove.dataset.remove); renderCart(); }
});
$("#demo-search").addEventListener("input", (event) => { search = event.target.value; renderProducts(); });
$("#demo-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-cat]");
  if (!chip) return;
  category = chip.dataset.cat;
  document.querySelectorAll("#demo-chips .chip").forEach((el) => el.classList.toggle("is-active", el === chip));
  renderProducts();
});
$("#demo-discount").addEventListener("input", renderCart);
$("#demo-clear").addEventListener("click", () => { cart = new Map(); $("#demo-discount").value = "0"; renderCart(); });
$("#demo-checkout").addEventListener("click", checkout);
$("#demo-reset").addEventListener("click", resetDemo);
document.querySelectorAll("[data-demo-method]").forEach((button) => button.addEventListener("click", () => {
  method = button.dataset.demoMethod;
  document.querySelectorAll("[data-demo-method]").forEach((el) => el.classList.toggle("is-active", el === button));
}));
$("#close-receipt").addEventListener("click", closeReceipt);
$("#new-sale").addEventListener("click", () => { closeReceipt(); });
$("#print-receipt").addEventListener("click", () => window.print());
$("#receipt-modal").addEventListener("click", (event) => { if (event.target === $("#receipt-modal")) closeReceipt(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeReceipt();
  if (event.key === "/" && !["INPUT", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $("#demo-search").focus();
  }
});

renderProducts();
renderCart();
renderBrief();
