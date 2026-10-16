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
  '#placed', '#preview', '#place-tool', '#track-tool', '#map-mode', '#floor-level', '#car-count',
  '#hint', '#map-data', '#map-credit', '#station-editor', '#selected-station-info',
  '#station-name', '#station-angle', '#station-angle-value', '#station-demand',
  '#demand-overview', '#deselect-station', '#zoom-in', '#zoom-out',
  '#track-editor', '#track-origin', '#track-destination', '#build-track', '#track-validation'
];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes['#track-origin'].tagName = 'select';
nodes['#map-mode'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
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
function mouseTap(x, y) { mouse('pointerdown', x, y); mouse('pointerup', x, y); }
function screenFromCanvas(x, y) {
  const [startX, startY, width, height] = board.attributes.viewBox.split(' ').map(Number);
  return { x: (x - startX) * 400 / width, y: (y - startY) * 600 / height };
}
function tapTarget(x, y, touchId = null) {
  const p = screenFromCanvas(x, y);
  if (touchId !== null) {
    touch('pointerdown', touchId, p.x, p.y);
    touch('pointerup', touchId, p.x, p.y);
  } else mouseTap(p.x, p.y);
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
function terminalCenter(group) {
  const a = pathPoints(group.children[0].attributes.d).at(-1);
  const b = pathPoints(group.children[1].attributes.d).at(-1);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
assert.equal(nodes['#build-track'].disabled, true, 'a destination is required');
assert.equal(preview().length, 0);

const expectedMetersToSvg = 256 * 2 ** 13 * .9 / (2 * Math.PI * 6378137 * Math.cos(35.004 * Math.PI / 180));
const stationCenter = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const leftEnd = { x: Number(stationCenter[1]) - 120 * expectedMetersToSvg, y: Number(stationCenter[2]) };

// A tap on the opposite side of a station automatically chooses the usable open end.
tapTarget(Number(stationCenter[1]) + 900 * expectedMetersToSvg, leftEnd.y);
assert.equal(nodes['#track-origin'].value, 'station:1:1');
assert.equal(nodes['#build-track'].disabled, false);
nodes['#track-origin'].value = 'station:1:-1';
nodes['#track-origin'].dispatch('change');
assert.equal(nodes['#build-track'].disabled, true);

// An automatic curve of 160m with a 30-degree bearing change is too sharp.
tapTarget(leftEnd.x - 160 * Math.cos(Math.PI / 6) * expectedMetersToSvg,
  leftEnd.y - 160 * Math.sin(Math.PI / 6) * expectedMetersToSvg);
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /最小曲線半径160m/);
commit();
assert.equal(routes().length, 0);

// A map tap computes the route, displays a two-track preview and builds exactly to the tap.
const chosenEnd = { x: leftEnd.x - 600 * expectedMetersToSvg, y: leftEnd.y };
tapTarget(chosenEnd.x, chosenEnd.y, 13);
assert.equal(nodes['#build-track'].disabled, false);
assert.equal(preview().length, 1);
assert.equal(preview()[0].children.length, 3, 'two rails and the target marker');
assert.match(nodes['#track-destination'].textContent, /約600m/);
commit();
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 2);
assert.match(routes()[0].children[0].attributes.d, /^M /);
assert.match(routes()[0].children[1].attributes.d, /^M /);

// At the station the two rails match the station's 12m spacing, then taper to 4m.
assert.ok(Math.abs(endpointGap(routes()[0]) - 12 * expectedMetersToSvg) < .005);
assert.ok(Math.abs(endpointGap(routes()[0], true) - 6) < .001, 'overview preserves visible rails');
const terminal = terminalCenter(routes()[0]);
assert.ok(Math.hypot(terminal.x - chosenEnd.x, terminal.y - chosenEnd.y) < .01,
  'the committed centerline ends at the exact tapped point');
for (let i = 0; i < 4; i++) nodes['#zoom-in'].dispatch('click');
assert.ok(Math.abs(endpointGap(routes()[0], true) - 4 * expectedMetersToSvg) < .005, 'detail uses 4 actual meters');
for (let i = 0; i < 4; i++) nodes['#zoom-out'].dispatch('click');

// After construction only the free tip can extend this segment, without an implicit turnout.
assert.equal(nodes['#track-origin'].children.length, 2, 'opposite station end + free section tip');
assert.equal(nodes['#track-origin'].value, 'section:1');
assert.equal(nodes['#build-track'].disabled, true, 'another tap is required for continuation');
const nextEnd = { x: chosenEnd.x - 600 * expectedMetersToSvg, y: chosenEnd.y };
tapTarget(nextEnd.x, nextEnd.y);
assert.equal(nodes['#build-track'].disabled, false);
const before = pathPoints(routes()[0].children[0].attributes.d).at(-1);
commit();
assert.equal(routes().length, 2);
const after = pathPoints(routes()[1].children[0].attributes.d)[0];
assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .01, 'continuation joins exactly');

// An attempted U-turn is refused; station connections cannot be broken by movement.
const now = terminalCenter(routes()[1]);
tapTarget(now.x + 500 * expectedMetersToSvg, now.y);
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /急旋回/);
nodes['#track-tool'].dispatch('click');
const stationTransform = nodes['#placed'].children[0].attributes.transform;
const station = nodes['#placed'].children[0];
const target = { closest: () => station, getAttribute: key => station.getAttribute(key) };
board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 9, clientX: 200, clientY: 300, button: 0, target, preventDefault() {} });
assert.equal(nodes['#station-angle'].disabled, true, 'connected stations are rotation-locked');
mouse('pointermove', 250, 330);
mouse('pointerup', 250, 330);
assert.equal(nodes['#placed'].children[0].attributes.transform, stationTransform);
nodes['#track-tool'].dispatch('click');

// An automatically suggested straight route cannot pass through another station.
nodes['#place-tool'].dispatch('click');
tapTarget(Number(stationCenter[1]) + 500 * expectedMetersToSvg, Number(stationCenter[2]));
assert.equal(nodes['#placed'].children.length, 2);
nodes['#track-tool'].dispatch('click');
nodes['#track-origin'].value = 'station:1:1';
nodes['#track-origin'].dispatch('change');
assert.equal(nodes['#track-origin'].value, 'station:1:1');
tapTarget(Number(stationCenter[1]) + 1300 * expectedMetersToSvg, Number(stationCenter[2]));
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /駅のホーム/);
assert.equal(routes().length, 2, 'a route through another station was not built');

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
const blankCenter = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const blankEnd = { x: Number(blankCenter[1]) - 164, y: Number(blankCenter[2]) };
tapTarget(blankEnd.x - 500, blankEnd.y);
assert.equal(nodes['#build-track'].disabled, false);
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
assert.equal(nodes['#placed'].children.length, 3);
assert.equal(routes().length, 2);

// Each underground floor has its own stations and tracks, including the same XY position.
nodes['#floor-level'].value = '-2';
nodes['#floor-level'].dispatch('change');
assert.equal(nodes['#placed'].children.length, 0, 'B2 does not display B1 stations');
assert.equal(routes().length, 0, 'B2 does not display B1 tracks');
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#build-track'].disabled, true, 'no rail endpoint exists on an empty floor');
nodes['#place-tool'].dispatch('click');
mouseTap(200, 300);
assert.equal(nodes['#placed'].children.length, 1);
assert.match(nodes['#placed'].children[0].attributes['aria-label'], /地下2階（-20m）/);
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#track-origin'].children.length, 2, 'B2 offers only B2 station endpoints');
const b2Center = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
tapTarget(Number(b2Center[1]) - 850 * expectedMetersToSvg, Number(b2Center[2]));
assert.equal(nodes['#build-track'].disabled, false, 'B1 line at the same level XY does not block B2');
commit();
assert.equal(routes().length, 1);
nodes['#floor-level'].value = '-1';
nodes['#floor-level'].dispatch('change');
assert.equal(routes().length, 2, 'B1 tracks remain after building B2');
assert.equal(nodes['#placed'].children.length, 3, 'B1 stations remain unchanged');
nodes['#floor-level'].value = '-2';
nodes['#floor-level'].dispatch('change');
assert.equal(routes().length, 1);
assert.equal(nodes['#placed'].children.length, 1);
for (const floor of ['-3', '-4', '-5', '0']) {
  nodes['#floor-level'].value = floor;
  nodes['#floor-level'].dispatch('change');
  assert.equal(routes().length, 0, `floor ${floor} starts with no routes`);
  assert.equal(nodes['#placed'].children.length, 0, `floor ${floor} starts with no stations`);
  assert.equal(nodes['#track-origin'].children.length, 0);
}
assert.match(html, /<option value="-5">地下5階（−50m）<\/option>/);
assert.match(html, /\.map-tiles \{ opacity: \.62; \}/);

console.log('Automatic tracks, safety, mobile gestures, map and six-floor isolation OK');
