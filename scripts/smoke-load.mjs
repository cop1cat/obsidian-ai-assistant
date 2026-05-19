// Smoke test: load the production bundle the same way Obsidian does
// (CommonJS require with `obsidian` resolved to a mock module).
import { createRequire } from "module";
import Module from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(projectRoot, "main.js");

// --- Mock the `obsidian` module ---
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._calls = [];
  }
  async loadData() { return null; }
  async saveData() {}
  addRibbonIcon(icon, title, cb) { this._calls.push(["ribbon", icon, title]); return {}; }
  addCommand(c) { this._calls.push(["command", c.id]); }
  addSettingTab(t) { this._calls.push(["settingTab", t?.constructor?.name]); }
  registerView(type, factory) { this._calls.push(["registerView", type]); this._viewFactory = factory; }
  registerEvent() {}
}
class ItemView {
  constructor(leaf) { this.leaf = leaf; this.contentEl = makeEl(); }
  registerEvent() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = makeEl(); } }
class Setting {
  constructor(c) { this.c = c; }
  setName() { return this; }
  setDesc() { return this; }
  addText(cb) { cb({ setPlaceholder: () => ({ setValue: () => ({ onChange: () => ({}) }) }), setValue: () => ({ onChange: () => ({}) }) }); return this; }
  addToggle(cb) { cb({ setValue: () => ({ onChange: () => ({}) }) }); return this; }
  addTextArea(cb) { cb({ setValue: () => ({ onChange: () => ({}) }), inputEl: { rows: 0, style: {} } }); return this; }
  addButton(cb) { cb({ setButtonText: () => ({ onClick: () => ({}) }) }); return this; }
  addExtraButton(cb) { cb({ setIcon: () => ({ setTooltip: () => ({ onClick: () => ({}) }) }) }); return this; }
}
class TFile {}
class TFolder {}
class WorkspaceLeaf {}
class Component {}
class Notice {}
class Modal {
  constructor(app) { this.app = app; this.contentEl = makeEl(); this.modalEl = makeEl(); }
  open() {}
  close() {}
}
class Menu {
  addItem() { return this; }
  addSeparator() { return this; }
  showAtMouseEvent() {}
}
const MarkdownRenderer = { render: async () => {} };
function normalizePath(p) { return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, ""); }
function getAllTags() { return []; }
function setIcon() {}

function makeEl() {
  const el = {
    children: [],
    classes: new Set(),
    empty() { this.children = []; },
    addClass(c) { this.classes.add(c); },
    setText() {},
    createDiv(o) { return makeEl(); },
    createSpan() { return makeEl(); },
    createEl(tag) { return makeEl(); },
    setAttribute() {},
    addEventListener() {},
  };
  return el;
}

const obsidianMock = {
  Plugin, ItemView, PluginSettingTab, Setting,
  TFile, TFolder, WorkspaceLeaf, Component, Notice, Modal, Menu,
  MarkdownRenderer, normalizePath, getAllTags, setIcon,
};

// Intercept require("obsidian") inside the bundle.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "obsidian") return "obsidian-mock";
  return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "obsidian" || request === "obsidian-mock") return obsidianMock;
  return originalLoad.call(this, request, parent, ...rest);
};

// --- Load the bundle ---
const require = createRequire(import.meta.url);
const code = fs.readFileSync(bundlePath, "utf8");
console.log(`[smoke] bundle size: ${(code.length / 1024).toFixed(1)} KB`);

const mod = require(bundlePath);
const PluginClass = mod.default || mod;
console.log(`[smoke] export type: ${typeof PluginClass}, name: ${PluginClass?.name}`);
if (typeof PluginClass !== "function") throw new Error("Plugin default export is not a class");

// --- Instantiate and call onload ---
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const fakeApp = {
  workspace: {
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    revealLeaf: () => {},
    on: () => ({}),
    getActiveFile: () => null,
  },
  vault: {
    getRoot: () => ({ children: [] }),
    getAbstractFileByPath: () => null,
    getMarkdownFiles: () => [],
    cachedRead: async () => "",
    read: async () => "",
    adapter: {},
  },
  metadataCache: {
    getFileCache: () => null,
    getFirstLinkpathDest: () => null,
  },
};
const plugin = new PluginClass(fakeApp, manifest);
await plugin.onload();
console.log(`[smoke] onload OK. Registrations:`, plugin._calls);

// Open settings tab to exercise that codepath.
const tab = plugin._calls.find((c) => c[0] === "settingTab");
console.log(`[smoke] settings tab class: ${tab?.[1]}`);

console.log("[smoke] ✅ plugin loaded successfully");
