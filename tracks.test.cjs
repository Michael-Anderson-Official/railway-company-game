const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  dispatch(name, options = {}) { this.listeners[name]?.({ preventDefault() {}, ...options }); }
  append(child) { child.parentNode = this; this.children.push(child); }
  replaceChildren(...children) { this.children = children; for (const child of children) child.parentNode = this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
  getScreenCTM() { return { inverse() { return {}; } }; }
  createSVGPoint() {
    const board = this;
    return { x: 0, y: 0, matrixTransform() {
      const [x, y, w, h] = board.attributes.viewBox.split(' ').map(Number);
      return { x: x + this.x * w / 400, y: y + this.y * h / 600 };
    } };
  }
  closest(selector) {
    const key = selector.slice(1, -1);
    for (let node = this; node; node = node.parentNode) {
      if (node.getAttribute(key) !== null) return node;
    }
    return null;
  }
  setPointerCapture() {}
}

const ids = [
  '#board', '#map-tiles', '#map-markers', '#catchment-rings', '#tracks', '#track-preview',
  '#placed', '#preview', '#place-tool', '#track-tool', '#map-mode', '#car-count',
  '#hint', '#map-data', '#map-credit', '#station-editor', '#selected-station-info',
  '#station-name', '#station-angle', '#station-angle-value', '#station-demand',
  '#demand-overview', '#deselect-station', '#zoom-in', '#zoom-out'
];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes['#map-mode'].value = 'kariya';
nodes['#car-count'].value = '10';
const board = nodes['#board'];
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(script, {
  document: { querySelector: key => nodes[key], createElementNS: () => new Element() },
  window: new Element(), Math, Map,
  fetch: async () => ({ ok: true, json: async () => ({ populationYear: 2025, cells: [] }) })
});

function pointer(type, name, id, x, y) {
  board.dispatch(name, { pointerType: type, pointerId: id, clientX: x, clientY: y,
    button: 0, target: board });
}
function touch(name, id, x, y) { pointer('touch', name, id, x, y); }
function mouse(name, x, y) { pointer('mouse', name, 90, x, y); }
function routes() { return nodes['#tracks'].children; }
function preview() { return nodes['#track-preview'].children; }

assert.equal(routes().length, 0);
nodes['#place-tool'].dispatch('click');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'true');
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'false');
assert.equal(nodes['#track-tool'].attributes['aria-pressed'], 'true');

// A single tap is not a track. Finger dragging previews and then stores exactly two rails.
touch('pointerdown', 1, 100, 150);
touch('pointerup', 1, 100, 150);
assert.equal(routes().length, 0);
touch('pointerdown', 2, 100, 150);
touch('pointermove', 2, 140, 150);
touch('pointermove', 2, 180, 175);
assert.equal(preview().length, 1);
assert.equal(preview()[0].children.length, 2, 'the in-progress stroke has two tracks');
touch('pointerup', 2, 230, 200);
assert.equal(preview().length, 0);
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 2);
assert.match(routes()[0].children[0].attributes.d, /^M /);
assert.match(routes()[0].children[1].attributes.d, /^M /);
assert.equal(nodes['#placed'].children.length, 0, 'track drag must not place a station');

// Two rails remain visible at regional scale; detailed zoom restores the true 4m gap.
const first = routes()[0].children.map(line => line.attributes.d.match(/^M ([\d.eE+-]+) ([\d.eE+-]+)/).slice(1).map(Number));
const spacing = Math.hypot(first[0][0] - first[1][0], first[0][1] - first[1][1]);
const expectedMetersToSvg = 256 * 2 ** 13 * .9 / (2 * Math.PI * 6378137 * Math.cos(35.004 * Math.PI / 180));
assert.ok(Math.abs(spacing - 6) < .001, 'two rails are visibly separated on the overview map');
for (let i = 0; i < 4; i++) nodes['#zoom-in'].dispatch('click');
const detailed = routes()[0].children.map(line => line.attributes.d.match(/^M ([\d.eE+-]+) ([\d.eE+-]+)/).slice(1).map(Number));
const detailedSpacing = Math.hypot(detailed[0][0] - detailed[1][0], detailed[0][1] - detailed[1][1]);
assert.ok(Math.abs(detailedSpacing - 4 * expectedMetersToSvg) < .001, 'detail scale uses four actual meters');
for (let i = 0; i < 4; i++) nodes['#zoom-out'].dispatch('click');

// Starting a pinch while drawing cancels the unfinished segment and still zooms.
const previousWidth = Number(board.attributes.viewBox.split(' ')[2]);
touch('pointerdown', 3, 110, 300);
touch('pointermove', 3, 150, 300);
touch('pointerdown', 4, 280, 300);
assert.equal(preview().length, 0);
touch('pointermove', 4, 330, 300);
assert.ok(Number(board.attributes.viewBox.split(' ')[2]) < previousWidth);
touch('pointerup', 3, 150, 300);
touch('pointerup', 4, 330, 300);
assert.equal(routes().length, 1, 'pinch must not lay another track');

// Map and blank mode have independent routes. Mouse freehand works in blank mode.
nodes['#map-mode'].value = 'blank';
nodes['#map-mode'].dispatch('change');
assert.equal(routes().length, 0);
mouse('pointerdown', 75, 125);
mouse('pointermove', 190, 145);
mouse('pointerup', 260, 185);
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 2);
nodes['#map-mode'].value = 'kariya';
nodes['#map-mode'].dispatch('change');
assert.equal(routes().length, 1, 'city route remains when toggling maps');

// Switching back to station placement turns off freehand drawing.
nodes['#place-tool'].dispatch('click');
assert.equal(nodes['#track-tool'].attributes['aria-pressed'], 'false');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'true');
mouse('pointerdown', 200, 200);
mouse('pointerup', 200, 200);
assert.equal(nodes['#placed'].children.length, 1);
assert.equal(routes().length, 1);

console.log('Freehand double tracks in city and blank modes, 4m scale, touch/mouse, pinch cancellation and tool switching OK');
