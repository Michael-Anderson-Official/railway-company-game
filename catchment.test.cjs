const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.classList = { toggle() {} };
    this.textContent = '';
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  replaceChildren(...children) { this.children = children; for (const child of children) child.parentNode = this; }
  append(child) { child.parentNode = this; this.children.push(child); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatch(name, payload = {}) { this.listeners[name]?.({ preventDefault() {}, ...payload }); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() {
    const board = this;
    return {
      x: 0, y: 0,
      matrixTransform() {
        const [x, y, width, height] = board.attributes.viewBox.split(' ').map(Number);
        return { x: x + this.x * width / 400, y: y + this.y * height / 600 };
      }
    };
  }
  closest(selector) {
    const key = selector.slice(1, -1);
    for (let target = this; target; target = target.parentNode) {
      if (target.getAttribute(key) !== null) return target;
    }
    return null;
  }
}

const nodes = Object.fromEntries([
  '#board', '#map-tiles', '#map-markers', '#catchment-rings', '#tracks', '#waypoint-layer', '#track-preview', '#placed', '#depots', '#station-endpoints', '#preview',
  '#depot-tool', '#depot-panel', '#depot-heading', '#depot-info', '#depot-vehicle', '#depot-buy', '#depot-status', '#depot-owned', '#depot-close', '#depot-angle', '#depot-angle-value', '#depot-guidance', '#depot-route', '#depot-service', '#depot-direction', '#depot-dispatch', '#depot-return', '#depot-speed',
  '#place-tool', '#track-tool', '#tool-bar', '#settings-toggle', '#active-config', '#map-mode', '#map-focus-control', '#map-focus', '#floor-level', '#car-count', '#hint', '#map-data', '#map-credit',
  '#train-layer', '#fleet-tool', '#fleet-panel', '#fleet-close', '#vehicle-model', '#vehicle-route', '#vehicle-speed',
  '#route-tool', '#route-manager', '#route-close', '#route-edit-target', '#route-name', '#route-code', '#route-save', '#route-manager-status', '#auto-route-warnings', '#route-list', '#waypoint-section', '#waypoint-pick', '#waypoint-undo', '#waypoint-clear', '#waypoint-status', '#service-tool', '#service-manager', '#service-close', '#service-edit-target', '#service-name', '#service-route', '#service-stops', '#service-save', '#service-status', '#service-list',
  '#fleet-preview', '#vehicle-hero', '#vehicle-illustration-caption', '#fleet-stats', '#fleet-description', '#vehicle-run', '#vehicle-stop', '#vehicle-emergency', '#vehicle-status', '#train-hud',
  '#station-editor', '#selected-station-info', '#station-angle', '#station-angle-value',
  '#station-delete-request', '#station-delete-confirm', '#station-delete-message', '#station-delete-confirm-button', '#station-delete-cancel',
  '#station-name', '#station-interchange', '#deselect-station', '#zoom-in', '#zoom-out', '#follow-train', '#demand-overview', '#station-demand',
  '#station-route', '#station-route-number', '#station-route-save', '#station-route-list', '#station-route-status',
  '#track-editor', '#track-origin', '#track-route', '#track-destination', '#build-track', '#track-validation',
  '#connection-dialog', '#connection-question', '#connection-detail', '#connection-confirm', '#connection-cancel',
  '#interchange-dialog', '#interchange-question', '#interchange-detail', '#interchange-confirm', '#interchange-cancel'
].map(key => [key, new Element()]));
const board = nodes['#board'];
nodes['#map-mode'].value = 'kariya';
nodes['#map-focus'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#vehicle-speed'].value = '5';
nodes['#fleet-panel'].hidden = true;
const samples = [
  [0, 100], [500, 200], [700, 300], [880, 400]
].map(([metersEast, population]) => [
  137.012 + metersEast / (6378137 * Math.PI / 180 * Math.cos(35.004 * Math.PI / 180)),
  35.004, population, 0, 0
]);
const window = new Element();
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(source, {
  document: { querySelector: key => nodes[key], createElement: () => new Element(), createElementNS: () => new Element() },
  window, Math, Map,
  fetch: async url => ({ ok: true, json: async () => ({ populationYear: 2025,
    cells: url.includes('kariya') ? samples : [] }) })
});

function clickCanvas(x, y) {
  board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 11, button: 0,
    clientX: x, clientY: y, target: board });
  board.dispatch('pointerup', { pointerType: 'mouse', pointerId: 11, button: 0,
    clientX: x, clientY: y, target: board });
}

async function run() {
  // Allow the two fetch/json promises to settle and update the UI.
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes['#demand-overview'].textContent, /駅を配置すると/);
  nodes['#place-tool'].dispatch('click');
  clickCanvas(200, 300); // MAP_CENTER in the center of the initial map.
  assert.equal(nodes['#station-name'].value, '新駅1');
  nodes['#station-name'].value = '刈谷中央';
  nodes['#station-name'].dispatch('input');
  assert.equal(nodes['#placed'].children[0].children[2].textContent, '刈谷中央');
  assert.match(nodes['#placed'].children[0].attributes['aria-label'], /刈谷中央/);
  assert.match(nodes['#station-demand'].textContent, /担当人口：600人/);
  assert.match(nodes['#station-demand'].textContent, /潜在利用人口：320人/);
  assert.match(nodes['#demand-overview'].textContent, /潜在利用人口 320人/);
  assert.equal(nodes['#catchment-rings'].children.filter(child => child.attributes.r).length, 3);
  const outerRadius = Number(nodes['#catchment-rings'].children[0].attributes.r);
  const mapUnitsPerMeter = 256 * 2 ** 13 * .9 /
    (2 * Math.PI * 6378137 * Math.cos(35.004 * Math.PI / 180));
  assert.ok(Math.abs(outerRadius / (800 * mapUnitsPerMeter) - 1) < 1e-8,
    '800m circle is drawn at the exact Web Mercator map scale');

  // Place a second station 500m to the east. Each cell population is assigned
  // to its nearest station exactly once; the combined reach can grow to 1,000.
  clickCanvas(200 + 500 * mapUnitsPerMeter * 400 / 480, 300);
  assert.equal(nodes['#station-name'].value, '新駅2');
  nodes['#station-name'].value = '新町';
  nodes['#station-name'].dispatch('input');
  assert.equal(nodes['#placed'].children[0].children[2].textContent, '刈谷中央', 'other stations retain their names');
  assert.equal(nodes['#placed'].children[1].children[2].textContent, '新町');
  assert.match(nodes['#demand-overview'].textContent, /設置駅2駅/);
  assert.match(nodes['#demand-overview'].textContent, /潜在利用人口 1,000人/);
  assert.match(nodes['#station-demand'].textContent, /担当人口：900人/);
  assert.equal(nodes['#catchment-rings'].children.filter(child => child.attributes.r).length, 4);

  // Moving a station outside the populated area must recompute both totals.
  const second = nodes['#placed'].children[1];
  const hit = second.children[0].children.at(-1);
  board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 12, button: 0,
    clientX: 224, clientY: 300, target: hit });
  board.dispatch('pointermove', { pointerType: 'mouse', pointerId: 12, button: 0,
    clientX: 390, clientY: 300, target: board });
  board.dispatch('pointerup', { pointerType: 'mouse', pointerId: 12, button: 0,
    clientX: 390, clientY: 300, target: board });
  assert.match(nodes['#demand-overview'].textContent, /潜在利用人口 320人/);

  // The editing floor changes visible catchment rings, but citywide station demand persists.
  nodes['#floor-level'].value = '-2';
  nodes['#floor-level'].dispatch('change');
  assert.equal(nodes['#placed'].children.length, 0);
  assert.equal(nodes['#catchment-rings'].children.length, 0);
  assert.match(nodes['#demand-overview'].textContent, /設置駅2駅・潜在利用人口 320人/);
  nodes['#floor-level'].value = '-1';
  nodes['#floor-level'].dispatch('change');
  assert.equal(nodes['#placed'].children.length, 2);
  assert.equal(nodes['#catchment-rings'].children.filter(child => child.attributes.r).length, 2);

  nodes['#map-mode'].value = 'blank';
  nodes['#map-mode'].dispatch('change');
  assert.equal(nodes['#catchment-rings'].children.length, 0);
  assert.equal(nodes['#station-demand'].hidden, true);
  clickCanvas(200, 300);
  assert.equal(nodes['#station-name'].value, '新駅3');
  nodes['#station-name'].value = 'テスト新駅';
  nodes['#station-name'].dispatch('input');
  assert.equal(nodes['#placed'].children[0].children[2].textContent, 'テスト新駅', 'names work in blank mode');
  nodes['#station-delete-request'].dispatch('click');
  assert.equal(nodes['#placed'].children.length, 1, 'station remains until removal is confirmed');
  nodes['#station-delete-confirm-button'].dispatch('click');
  assert.equal(nodes['#placed'].children.length, 0, 'station deletion also works on a blank canvas');
  assert.match(nodes['#demand-overview'].textContent, /設置駅2駅・潜在利用人口 320人/,
    'deleting a blank-map station leaves citywide catchment results unchanged');
  console.log('Station naming in both modes, 2025 population mesh, 400/600/800m weights, no double-counting and drag update OK');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
