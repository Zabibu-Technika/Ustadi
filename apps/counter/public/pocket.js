/* Ustadi Pocket — the owner's local-first companion */

const $ = (selector) => document.querySelector(selector);
const CACHE_KEY = "ustadi.pocket.state.v1";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));

const kes = (cents) => `KSh ${(Number(cents || 0) / 100).toLocaleString("en-KE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

function setStatus(text, live = true) {
  $("#pocket-status").textContent = text;
  $("#pocket-live-dot").style.background = live ? "var(--mint)" : "var(--coral)";
}

function render(state, offline = false) {
  const brief = state.brief;
  const date = new Date(state.serverTime);
  $("#pocket-title").textContent = `Habari. Here's ${state.meta.deviceName}.`;
  $("#pocket-sync").textContent = offline
    ? `Offline · showing the last local snapshot from ${new Date(state.serverTime).toLocaleString("en-KE")}.`
    : `Synced ${date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })} · local ledger.`;
  setStatus(offline ? "Offline · last snapshot" : "Live · local", !offline);

  $("#pocket-metrics").innerHTML = brief.metrics.map((metric) => `
    <div class="metric">
      <div class="label">${esc(metric.label)}</div>
      <div class="value ${esc(metric.tone || "")}">${esc(metric.value)}</div>
    </div>`).join("");

  $("#pocket-brief").textContent = brief.text;
  $("#pocket-actions").innerHTML = brief.actions.map((action) => `<li>${esc(action)}</li>`).join("");

  $("#pocket-low").innerHTML = state.projection.lowStock.length
    ? state.projection.lowStock.map((product) => `
      <div class="low-item"><strong>${esc(product.name)}</strong><span class="pill">${product.stock} left</span></div>`).join("")
    : `<p class="fine">Nothing urgent. The shelf is healthy.</p>`;

  $("#pocket-orders").innerHTML = state.projection.pendingOrders.length
    ? state.projection.pendingOrders.map((order) => `
      <div class="pending-item"><strong>${esc(order.customerName || "Walk-in")}</strong><span>${kes(order.totalCents)} · ${esc(order.status)}</span></div>`).join("")
    : `<p class="fine">No orders waiting.</p>`;
}

async function load() {
  setStatus("Reading the counter…");
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`Counter returned ${response.status}`);
    const state = await response.json();
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    render(state, false);
  } catch (error) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        render(JSON.parse(cached), true);
        setStatus("Offline · last snapshot", false);
      } catch {
        setStatus("Counter not reachable", false);
      }
    } else {
      setStatus("Counter not reachable", false);
      $("#pocket-brief").textContent = "Open the Ustadi Counter first, then bring this phone onto the same local network or hotspot.";
    }
  }
}

$("#pocket-refresh").addEventListener("click", load);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

load();
setInterval(load, 30000);
