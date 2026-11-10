const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

app.setName("Ustadi Counter");

const appRoot = path.resolve(__dirname, "../..");
const port = Number(process.env.USTADI_PORT || 4173);
const dataDir = process.env.USTADI_DATA || path.join(app.getPath("userData"), "ledger");
let server = null;
let win = null;

function waitForServer(attempt = 0) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 800 }, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else if (attempt > 60) reject(new Error(`health returned ${res.statusCode}`));
      else setTimeout(() => waitForServer(attempt + 1).then(resolve, reject), 250);
    });
    req.on("error", () => {
      if (attempt > 60) reject(new Error("counter did not start"));
      else setTimeout(() => waitForServer(attempt + 1).then(resolve, reject), 250);
    });
    req.on("timeout", () => {
      req.destroy();
      if (attempt > 60) reject(new Error("counter health timed out"));
      else setTimeout(() => waitForServer(attempt + 1).then(resolve, reject), 250);
    });
  });
}

function startServer() {
  server = spawn(process.env.USTADI_NODE || "node", ["apps/counter/server.ts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      USTADI_DATA: dataDir,
      USTADI_PORT: String(port),
      USTADI_HOST: "127.0.0.1"
    },
    stdio: "inherit",
    windowsHide: true
  });
  server.on("exit", (code) => {
    if (code && win) dialog.showErrorBox("Ustadi Counter", `The local counter exited with code ${code}.`);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#f4efe4",
    title: "Ustadi Counter",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  startServer();
  try {
    await waitForServer();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox("Ustadi Counter", `Could not start the local counter.\n\n${error.message}\n\nNode 24 is required.`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (server) server.kill();
});
