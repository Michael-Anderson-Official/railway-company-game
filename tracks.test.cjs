const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tagName = '') {
    this.tagName = tagName;
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
  replaceChildren(...children) {
    this.children = children;
    for (const child of children) child.parentNode = this;
    if (this.tagName === 'select') this.value = children[0]?.value || '';
  }
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
  '#demand-overview', '#deselect-station', '#zoom-in', '#zoom-out',
  '#track-editor', '#track-origin', '#track-length', '#track-angle', '#build-track', '#track-validation'
];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes['#track-origin'].tagName = 'select';
nodes['#map-mode'].value = 'kariya';
nodes['#car-count'].value = '10';
nodes['#track-length'].value = '500';
nodes['#track-angle'].value = '0';
const board = nodes['#board'];
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(script, {
  document: { querySelector: key => nodes[key], createElement: name => new Element(name), createElementNS: () => new Element() },
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
function setTrack(length, angle) {
  nodes['#track-length'].value = String(length);
  nodes['#track-angle'].value = String(angle);
  nodes['#track-angle'].dispatch('input');
}
function pathPoints(path) {
  const values = (typeof path === 'string' ? path : path.attributes.d).matchAll(/[ML] ([\d.eE+-]+) ([\d.eE+-]+)/g);
  return [...values].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}
function endpointGap(group, last = false) {
  const a = pathPoints(group.children[0].attributes.d);
  const b = pathPoints(group.children[1].attributes.d);
  const i = last ? a.length - 1 : 0;
  return Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
}
function commit() { nodes['#build-track'].dispatch('click'); }

assert.equal(routes().length, 0);
nodes['#place-tool'].dispatch('click');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'true');
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'false');
assert.equal(nodes['#track-tool'].attributes['aria-pressed'], 'true');
assert.equal(nodes['#build-track'].disabled, true, 'cannot build without a station');

// Freehand gestures no longer construct track, including a single-finger drag.
touch('pointerdown', 1, 100, 150);
touch('pointerup', 1, 100, 150);
assert.equal(routes().length, 0);
touch('pointerdown', 2, 100, 150);
touch('pointermove', 2, 140, 150);
touch('pointermove', 2, 180, 175);
touch('pointerup', 2, 230, 200);
assert.equal(preview().length, 0);
assert.equal(routes().length, 0);
assert.equal(nodes['#placed'].children.length, 0, 'drag cannot add a station either');

// Place a station on the Kariya map and select its left rail end.
nodes['#place-tool'].dispatch('click');
mouse('pointerdown', 200, 300);
mouse('pointerup', 200, 300);
assert.equal(nodes['#placed'].children.length, 1);
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#track-editor'].hidden, false);
assert.equal(nodes['#track-origin'].children.length, 2);
assert.equal(nodes['#track-origin'].value, 'station:1:-1');
assert.equal(Number(nodes['#track-angle'].value), 180);
assert.equal(nodes['#build-track'].disabled, false);
assert.equal(preview().length, 1);
assert.equal(preview()[0].children.length, 2);

// A sharp 90-degree curve in 120m violates the 160m minimum radius.
setTrack(120, 90);
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /最小曲線半径160m/);
commit();
assert.equal(routes().length, 0);
setTrack(500, 180);
assert.equal(nodes['#build-track'].disabled, false);
commit();
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 2);
assert.match(routes()[0].children[0].attributes.d, /^M /);
assert.match(routes()[0].children[1].attributes.d, /^M /);

// At the station the two rails match the station's 12m spacing, then taper to 4m.
const expectedMetersToSvg = 256 * 2 ** 13 * .9 / (2 * Math.PI * 6378137 * Math.cos(35.004 * Math.PI / 180));
assert.ok(Math.abs(endpointGap(routes()[0]) - 12 * expectedMetersToSvg) < .005);
assert.ok(Math.abs(endpointGap(routes()[0], true) - 6) < .001, 'overview preserves visible rails');
for (let i = 0; i < 4; i++) nodes['#zoom-in'].dispatch('click');
assert.ok(Math.abs(endpointGap(routes()[0], true) - 4 * expectedMetersToSvg) < .005, 'detail uses 4 actual meters');
for (let i = 0; i < 4; i++) nodes['#zoom-out'].dispatch('click');

// After construction only the free tip can extend this segment, without an implicit turnout.
assert.equal(nodes['#track-origin'].children.length, 2, 'opposite station end + free section tip');
assert.equal(nodes['#track-origin'].value, 'section:1');
assert.equal(Number(nodes['#track-angle'].value), 180);
setTrack(500, 180);
const before = pathPoints(routes()[0].children[0].attributes.d).at(-1);
commit();
assert.equal(routes().length, 2);
const after = pathPoints(routes()[1].children[0].attributes.d)[0];
assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .01, 'continuation joins exactly');

// An attempted U-turn or collision is refused; station connections cannot be broken by movement.
setTrack(20, 0);
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /90°/);
assert.equal(nodes['#station-angle'].disabled, true, 'connected stations are rotation-locked');
const stationTransform = nodes['#placed'].children[0].attributes.transform;
const station = nodes['#placed'].children[0];
const target = { closest: () => station, getAttribute: key => station.getAttribute(key) };
board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 9, clientX: 200, clientY: 300, button: 0, target, preventDefault() {} });
mouse('pointermove', 250, 330);
mouse('pointerup', 250, 330);
assert.equal(nodes['#placed'].children[0].attributes.transform, stationTransform);

// Pinching must still zoom and must not construct rails.
const previousWidth = Number(board.attributes.viewBox.split(' ')[2]);
touch('pointerdown', 3, 110, 300);
touch('pointermove', 3, 150, 300);
touch('pointerdown', 4, 280, 300);
touch('pointermove', 4, 330, 300);
assert.ok(Number(board.attributes.viewBox.split(' ')[2]) < previousWidth);
touch('pointerup', 3, 150, 300);
touch('pointerup', 4, 330, 300);
assert.equal(routes().length, 2, 'pinch must not lay another track');

// Map and blank mode have independent routes; blank also requires a station.
nodes['#map-mode'].value = 'blank';
nodes['#map-mode'].dispatch('change');
assert.equal(routes().length, 0);
assert.equal(nodes['#build-track'].disabled, true);
nodes['#place-tool'].dispatch('click');
mouse('pointerdown', 200, 200);
mouse('pointerup', 200, 200);
nodes['#track-tool'].dispatch('click');
setTrack(500, 180);
commit();
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 2);
nodes['#map-mode'].value = 'kariya';
nodes['#map-mode'].dispatch('change');
assert.equal(routes().length, 2, 'city route remains when toggling maps');

// Switching back to station placement disables the track panel.
nodes['#place-tool'].dispatch('click');
assert.equal(nodes['#track-tool'].attributes['aria-pressed'], 'false');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'true');
assert.equal(nodes['#track-editor'].hidden, true);
mouse('pointerdown', 200, 200);
mouse('pointerup', 200, 200);
assert.equal(nodes['#placed'].children.length, 2);
assert.equal(routes().length, 2);

console.log('Connected length/angle double tracks, radius safety, station locking, 4m scale, touch/pinch and map isolation OK');
