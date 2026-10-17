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
  '#placed', '#depots', '#station-endpoints', '#preview', '#place-tool', '#track-tool', '#depot-tool', '#tool-bar', '#settings-toggle', '#active-config', '#map-mode', '#map-focus-control', '#map-focus', '#floor-level', '#car-count',
  '#depot-panel', '#depot-heading', '#depot-info', '#depot-vehicle', '#depot-buy', '#depot-status', '#depot-owned', '#depot-close', '#depot-angle', '#depot-angle-value', '#depot-guidance', '#depot-service', '#depot-dispatch', '#depot-return', '#depot-speed',
  '#train-layer', '#fleet-tool', '#fleet-panel', '#fleet-close', '#vehicle-model', '#vehicle-route', '#vehicle-speed',
  '#route-tool', '#route-manager', '#route-close', '#route-edit-target', '#route-name', '#route-code', '#route-save', '#route-manager-status', '#route-list', '#service-tool', '#service-manager', '#service-close', '#service-edit-target', '#service-name', '#service-route', '#service-stops', '#service-save', '#service-status', '#service-list',
  '#fleet-preview', '#vehicle-hero', '#vehicle-illustration-caption', '#fleet-stats', '#fleet-description', '#vehicle-run', '#vehicle-stop', '#vehicle-emergency', '#vehicle-status', '#train-hud',
  '#hint', '#map-data', '#map-credit', '#station-editor', '#selected-station-info',
  '#station-name', '#station-interchange', '#station-angle', '#station-angle-value', '#station-demand',
  '#station-route', '#station-route-number', '#station-route-save', '#station-route-list', '#station-route-status',
  '#demand-overview', '#deselect-station', '#zoom-in', '#zoom-out', '#follow-train',
  '#track-editor', '#track-origin', '#track-route', '#track-destination', '#build-track', '#track-validation',
  '#connection-dialog', '#connection-question', '#connection-detail', '#connection-confirm', '#connection-cancel',
  '#interchange-dialog', '#interchange-question', '#interchange-detail', '#interchange-confirm', '#interchange-cancel'
];
const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
nodes['#track-origin'].tagName = 'select';
nodes['#vehicle-route'].tagName = 'select';
nodes['#map-mode'].value = 'kariya';
nodes['#map-focus'].value = 'kariya';
nodes['#floor-level'].value = '-1';
nodes['#car-count'].value = '10';
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#depot-vehicle'].value = 'meitetsu2200';
nodes['#vehicle-speed'].value = '5';
nodes['#fleet-panel'].hidden = true;
const board = nodes['#board'];
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /html, body\s*\{\s*touch-action:\s*manipulation;\s*\}/,
  'browser double-tap zoom must be disabled without disabling accessible pinch zoom');
assert.match(html, /#board\s*\{[^}]*touch-action:\s*none;/,
  'board keeps custom two-finger map zoom');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const windowMock = new Element();
const frameCallbacks = new Map();
let frameSequence = 1;
const scriptWithHooks = script.replace('      loadPopulationData();',
  '      window.vehicleTestHooks = { ROLLING_STOCK, currentAcceleration, advanceVehicle, positions, depots, services, buildDepotJourney, selectDepot, depotRun: () => depotRun, trackedTrain, vehiclePointAt };\n      loadPopulationData();');
vm.runInNewContext(scriptWithHooks, {
  document: { querySelector: key => nodes[key], createElement: name => new Element(name), createElementNS: () => new Element() },
  window: windowMock, Math, Map,
  requestAnimationFrame: callback => { const id = frameSequence++; frameCallbacks.set(id, callback); return id; },
  cancelAnimationFrame: id => frameCallbacks.delete(id),
  fetch: async () => ({ ok: true, json: async () => ({ populationYear: 2025, cells: [] }) })
});

function advanceFrames(count, millisecondsPerFrame = 50) {
  for (let index = 0; index < count && frameCallbacks.size; index++) {
    const [id, callback] = frameCallbacks.entries().next().value;
    frameCallbacks.delete(id);
    callback(index * millisecondsPerFrame);
  }
}

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
function assertTrackingCentered(label) {
  const [x, y, width, height] = board.attributes.viewBox.split(' ').map(Number);
  const train = windowMock.vehicleTestHooks.trackedTrain();
  const center = windowMock.vehicleTestHooks.vehiclePointAt(train.route, train.centerMeters);
  assert.ok(Math.abs(x + width / 2 - center.x) < 1e-6, `${label}: camera follows train center X`);
  assert.ok(Math.abs(y + height / 2 - center.y) < 1e-6, `${label}: camera follows train center Y`);
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
function checkCrossovers(section, ends) {
  const crossovers = section.children.slice(2);
  assert.equal(crossovers.length, ends.length, 'X crossovers appear only at connected station ends');
  assert.deepEqual(crossovers.map(group => group.attributes['data-crossover-end']), ends);
  for (const crossover of crossovers) {
    assert.equal(crossover.attributes.class, 'scissors-crossover');
    assert.equal(crossover.children.length, 2, 'an X consists of two crossing rail paths');
    const a = pathPoints(crossover.children[0].attributes.d);
    const b = pathPoints(crossover.children[1].attributes.d);
    assert.equal(a.length, 25);
    assert.equal(b.length, 25);
    assert.ok(Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y) > .2, 'X begins on different rails');
    assert.ok(Math.hypot(a.at(-1).x - b.at(-1).x, a.at(-1).y - b.at(-1).y) > .2,
      'X finishes on different rails');
    assert.ok(Math.hypot(a[12].x - b[12].x, a[12].y - b[12].y) < 1e-6,
      'both crossover paths intersect at the same center point');
  }
}
function commit() { nodes['#build-track'].dispatch('click'); }

assert.equal(routes().length, 0);
assert.match(nodes['#active-config'].textContent, /地下1階.*10両.*3市の地図/);
nodes['#settings-toggle'].dispatch('click');
assert.equal(nodes['#settings-toggle'].getAttribute('aria-expanded'), 'true', 'settings can be opened');
nodes['#place-tool'].dispatch('click');
assert.equal(nodes['#settings-toggle'].getAttribute('aria-expanded'), 'false', 'choosing a tool closes settings');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'true');
assert.match(html, /@media\(max-width: 1180px\)[\s\S]*?\.tool \{\s*position: fixed/, 'mobile dock floats over the map');
assert.match(html, /\.tool\.settings-open \.settings-fields \{ display: grid; \}/, 'mobile settings are collapsible');
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
assert.equal(nodes['#placed'].children[0].children[0].attributes.transform, 'rotate(90)', 'new stations start vertically');
nodes['#station-angle'].value = '0'; // The original free-end test uses an explicitly horizontal station.
nodes['#station-angle'].dispatch('input');
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#track-editor'].hidden, false);
assert.ok(!nodes['#placed'].children[0].children.some(child => child.attributes.class === 'rotation-grip'),
  'rotation handles do not obscure station-end taps during track construction');
assert.equal(nodes['#track-origin'].children.length, 2);
assert.equal(nodes['#track-origin'].value, 'station:1:-1');
assert.equal(nodes['#build-track'].disabled, true, 'a destination is required');
assert.equal(preview().length, 0);

const expectedMetersToSvg = 256 * 2 ** 13 * .9 / (2 * Math.PI * 6378137 * Math.cos(35.004 * Math.PI / 180));
const stationCenter = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const leftEnd = { x: Number(stationCenter[1]) - 120 * expectedMetersToSvg, y: Number(stationCenter[2]) };

// A tap on the opposite side of a station automatically chooses the usable open end.
tapTarget(Number(stationCenter[1]) + 1500 * expectedMetersToSvg, leftEnd.y);
assert.equal(nodes['#track-origin'].value, 'station:1:1');
assert.equal(nodes['#build-track'].disabled, false);
nodes['#track-origin'].value = 'station:1:-1';
nodes['#track-origin'].dispatch('change');
assert.equal(nodes['#build-track'].disabled, true);

// An automatic curve of 160m with a 30-degree bearing change is too sharp.
for (let i = 0; i < 2; i++) nodes['#zoom-in'].dispatch('click');
tapTarget(leftEnd.x - 160 * Math.cos(Math.PI / 6) * expectedMetersToSvg,
  leftEnd.y - 160 * Math.sin(Math.PI / 6) * expectedMetersToSvg);
assert.equal(nodes['#build-track'].disabled, true);
assert.match(nodes['#track-validation'].textContent, /最小曲線半径160m/);
commit();
assert.equal(routes().length, 0);
for (let i = 0; i < 2; i++) nodes['#zoom-out'].dispatch('click');

// A map tap computes the route, displays a two-track preview and builds exactly to the tap.
const chosenEnd = { x: leftEnd.x - 600 * expectedMetersToSvg, y: leftEnd.y };
for (let i = 0; i < 2; i++) nodes['#zoom-in'].dispatch('click');
tapTarget(chosenEnd.x, chosenEnd.y, 13);
assert.equal(nodes['#build-track'].disabled, false);
assert.equal(preview().length, 1);
assert.equal(preview()[0].children.length, 3, 'two rails and the target marker');
assert.match(nodes['#track-destination'].textContent, /約600m/);
for (let i = 0; i < 2; i++) nodes['#zoom-out'].dispatch('click');
commit();
assert.equal(routes().length, 1);
assert.equal(routes()[0].children.length, 3);
checkCrossovers(routes()[0], ['source']);
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
checkCrossovers(routes()[1], []);
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
nodes['#station-angle'].value = '0';
nodes['#station-angle'].dispatch('input');
nodes['#track-tool'].dispatch('click');
const blankCenter = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const blankEnd = { x: Number(blankCenter[1]) - 164, y: Number(blankCenter[2]) };
tapTarget(blankEnd.x - 500, blankEnd.y);
assert.equal(nodes['#build-track'].disabled, false);
commit();
assert.equal(routes().length, 1);
checkCrossovers(routes()[0], ['source']);
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
nodes['#station-angle'].value = '0';
nodes['#station-angle'].dispatch('input');
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#track-origin'].children.length, 2, 'B2 offers only B2 station endpoints');
const b2Center = nodes['#placed'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
tapTarget(Number(b2Center[1]) - 850 * expectedMetersToSvg, Number(b2Center[2]));
assert.equal(nodes['#build-track'].disabled, false, 'B1 line at the same level XY does not block B2');
commit();
assert.equal(routes().length, 1);
checkCrossovers(routes()[0], ['source']);
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

// Station-end taps automatically choose the exact terminal and require confirmation.
nodes['#floor-level'].value = '-3';
nodes['#floor-level'].dispatch('change');
nodes['#place-tool'].dispatch('click');
mouseTap(200, 160);
mouseTap(200, 420);
assert.equal(nodes['#placed'].children.length, 2);
assert.ok(nodes['#placed'].children.every(station => station.children[0].attributes.transform === 'rotate(90)'));
const stationTargetName = nodes['#placed'].children[1].attributes['aria-label'].split('／')[0];
nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#station-endpoints'].children.length, 4);
assert.match(nodes['#track-origin'].children[0].textContent, /上り側/);
assert.match(nodes['#track-origin'].children[1].textContent, /下り側/);
const targetMarker = nodes['#station-endpoints'].children[2].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const targetPoint = { x: Number(targetMarker[1]), y: Number(targetMarker[2]) };
nodes['#track-origin'].value = `station:${nodes['#placed'].children[0].getAttribute('data-station-id')}:1`;
tapTarget(targetPoint.x, targetPoint.y, 31);
assert.equal(nodes['#connection-dialog'].hidden, false);
assert.equal(nodes['#connection-question'].textContent, `${stationTargetName}の上り側に接続しますか？`);
assert.equal(nodes['#build-track'].disabled, false);
assert.equal(preview().length, 1);
nodes['#connection-cancel'].dispatch('click');
assert.equal(nodes['#connection-dialog'].hidden, true);
assert.equal(routes().length, 0, 'cancel must not build rails');
tapTarget(targetPoint.x, targetPoint.y, 32);
nodes['#connection-confirm'].dispatch('click');
assert.equal(nodes['#connection-dialog'].hidden, true);
assert.equal(routes().length, 1);
checkCrossovers(routes()[0], ['source', 'destination']);
assert.ok(Math.abs(endpointGap(routes()[0]) - 12 * expectedMetersToSvg) < .005, 'source joins 12m spaced station rails');
assert.ok(Math.abs(endpointGap(routes()[0], true) - 12 * expectedMetersToSvg) < .005, 'destination joins 12m spaced station rails');
const destinationCenterMatch = nodes['#placed'].children[1].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
const actualStationEntry = { x: Number(destinationCenterMatch[1]), y: Number(destinationCenterMatch[2]) - 120 * expectedMetersToSvg };
assert.ok(Math.hypot(terminalCenter(routes()[0]).x - actualStationEntry.x,
  terminalCenter(routes()[0]).y - actualStationEntry.y) < .01, 'both tracks terminate precisely at the target station entrance');
assert.equal(nodes['#track-origin'].children.length, 2, 'both ends connected and route tip is closed');
assert.equal(nodes['#station-endpoints'].children[2].children[0].attributes.class, 'station-endpoint occupied');
assert.equal(nodes['#build-track'].disabled, true);
tapTarget(targetPoint.x, targetPoint.y, 33);
assert.equal(nodes['#connection-dialog'].hidden, true, 'already occupied target cannot be confirmed again');
assert.match(nodes['#track-validation'].textContent, /既に線路が接続/);

nodes['#floor-level'].value = '-4';
nodes['#floor-level'].dispatch('change');
assert.equal(routes().length, 0, 'a connection on B3 never appears on B4');

// Offset stations produce a curved route while joining both station tangents.
nodes['#place-tool'].dispatch('click');
mouseTap(155, 170);
mouseTap(245, 420);
nodes['#track-tool'].dispatch('click');
nodes['#track-origin'].value = `station:${nodes['#placed'].children[0].getAttribute('data-station-id')}:1`;
const offsetMarker = nodes['#station-endpoints'].children[2].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
tapTarget(Number(offsetMarker[1]), Number(offsetMarker[2]));
assert.equal(nodes['#connection-dialog'].hidden, false, nodes['#track-validation'].textContent);
nodes['#connection-confirm'].dispatch('click');
assert.equal(routes().length, 1);
checkCrossovers(routes()[0], ['source', 'destination']);
const railA = pathPoints(routes()[0].children[0].attributes.d);
const railB = pathPoints(routes()[0].children[1].attributes.d);
const mid = index => ({ x: (railA[index].x + railB[index].x) / 2, y: (railA[index].y + railB[index].y) / 2 });
const beginning = mid(0);
const ending = mid(railA.length - 1);
assert.ok(Math.abs(ending.x - beginning.x) > 40, 'the curve reaches the laterally offset station');
assert.ok(Math.abs(mid(1).x - beginning.x) < .05, 'the route leaves the origin on its vertical tangent');
assert.ok(Math.abs(mid(railA.length - 2).x - ending.x) < .05, 'the route enters the destination on its vertical tangent');
assert.ok(Math.abs(endpointGap(routes()[0], true) - 12 * expectedMetersToSvg) < .005);

// Real vehicle specifications drive the actual simulation, rather than just display labels.
const { ROLLING_STOCK, currentAcceleration, advanceVehicle } = windowMock.vehicleTestHooks;
assert.equal(ROLLING_STOCK.meitetsu2200.cars, 6);
assert.equal(ROLLING_STOCK.meitetsu2200.maxServiceKmh, 120);
assert.equal(ROLLING_STOCK.meitetsu2200.accelerationKmhps, 2.3);
assert.equal(ROLLING_STOCK.meitetsu2200.serviceDecelerationKmhps, 3.5);
assert.equal(ROLLING_STOCK.meitetsu2200.gaugeMm, 1067);
assert.equal(ROLLING_STOCK.keio5000.cars, 10);
assert.equal(ROLLING_STOCK.keio5000.maxServiceKmh, 110);
assert.equal(ROLLING_STOCK.keio5000.accelerationKmhps, 3.3);
assert.equal(ROLLING_STOCK.keio5000.serviceDecelerationKmhps, 4.0);
assert.equal(ROLLING_STOCK.keio5000.gaugeMm, 1372);
for (const vehicle of Object.values(ROLLING_STOCK)) {
  assert.equal(vehicle.cars * vehicle.carLengthMeters, vehicle.cars * 20);
  assert.equal(currentAcceleration(vehicle, 0) * 3.6, vehicle.accelerationKmhps);
  assert.ok(currentAcceleration(vehicle, 100 / 3.6) < currentAcceleration(vehicle, 0),
    'high speed traction tapers below the published starting acceleration');
  const state = { speedMps: 0, frontMeters: 220, elapsedSeconds: 0,
    maxObservedKmh: 0, emergency: false, finished: false };
  for (let i = 0; i < 4000 && !state.finished; i++) advanceVehicle(vehicle, state, .1, 2000);
  assert.ok(state.finished, `${vehicle.name} reaches its simulated destination`);
  assert.equal(state.speedMps, 0, 'service braking stops the vehicle');
  assert.ok(state.frontMeters <= 2000, 'no stop point overrun');
  assert.ok(state.maxObservedKmh <= vehicle.maxServiceKmh + 1e-8, 'actual running speed respects service maximum');
}
nodes['#fleet-tool'].dispatch('click');
assert.equal(nodes['#follow-train'].disabled, true, 'tracking is unavailable without a train');
assert.equal(nodes['#fleet-panel'].hidden, false, 'rolling stock catalog opens');
assert.equal(nodes['#vehicle-route'].children.length, 1, 'station-connected route is selectable');
assert.equal(nodes['#fleet-preview'].children.length, 6, 'Meitetsu six-car preview');
assert.equal(nodes['#vehicle-hero'].children[0].attributes.viewBox, '0 0 444 128', 'Meitetsu has an enlarged side-elevation drawing');
assert.match(nodes['#vehicle-illustration-caption'].textContent, /名鉄2200系/);
nodes['#vehicle-run'].dispatch('click');
assert.equal(nodes['#train-layer'].children.length, 6, 'six real-length cars appear on constructed track');
assert.equal(nodes['#follow-train'].disabled, false, 'tracking becomes available during a test run');
const initialTrackingWidth = Number(board.attributes.viewBox.split(' ')[2]);
nodes['#follow-train'].dispatch('click');
assert.equal(nodes['#follow-train'].attributes['aria-pressed'], 'true', 'tracking can be enabled');
assertTrackingCentered('test departure');
assert.equal(nodes['#train-layer'].children[0].attributes.class, 'rolling-stock-car');
assert.ok(nodes['#train-layer'].children[0].children.some(child => /train-roof/.test(child.attributes.class || '')),
  'Meitetsu running train renders rooftop details');
advanceFrames(40);
assertTrackingCentered('test moving');
assert.equal(Number(board.attributes.viewBox.split(' ')[2]), initialTrackingWidth,
  'tracking does not automatically zoom');
mouse('pointerdown', 245, 265);
mouse('pointermove', 285, 280);
mouse('pointerup', 285, 280);
assert.equal(nodes['#follow-train'].attributes['aria-pressed'], 'false', 'manual drag cancels tracking');
nodes['#follow-train'].dispatch('click');
assertTrackingCentered('tracking resumes');
touch('pointerdown', 301, 140, 180);
touch('pointerdown', 302, 260, 180);
assert.equal(nodes['#follow-train'].attributes['aria-pressed'], 'false', 'two-finger pinch cancels tracking');
touch('pointerup', 302, 260, 180);
touch('pointerup', 301, 140, 180);
nodes['#follow-train'].dispatch('click');
assertTrackingCentered('tracking after pinch');
assert.match(nodes['#vehicle-status'].textContent, /名鉄2200系/);
assert.equal(nodes['#vehicle-run'].disabled, true, 'only one train trial runs at once');
nodes['#vehicle-emergency'].dispatch('click');
assert.match(nodes['#vehicle-status'].textContent, /非常制動中/);
advanceFrames(80);
assert.equal(nodes['#vehicle-run'].disabled, false, 'emergency stop returns controls');
nodes['#vehicle-stop'].dispatch('click');
assert.equal(nodes['#train-layer'].children.length, 0, 'reset clears the train without removing rails');
assert.equal(nodes['#follow-train'].disabled, true, 'reset disables tracking');
nodes['#vehicle-model'].value = 'keio5000';
nodes['#vehicle-model'].dispatch('change');
assert.equal(nodes['#fleet-preview'].children.length, 10, 'Keio ten-car preview');
assert.match(nodes['#vehicle-illustration-caption'].textContent, /京王5000系/);
nodes['#vehicle-run'].dispatch('click');
assert.equal(nodes['#train-layer'].children.length, 10, 'ten actual vehicle bodies are drawn');
assert.ok(nodes['#train-layer'].children[0].children.some(child => child.attributes.class === 'train-roof-keio' || child.attributes.class === 'train-roof train-roof-keio'),
  'Keio running train has a distinct silver roof');
advanceFrames(1200);
assert.equal(nodes['#vehicle-run'].disabled, false, `Keio train completes automatic service stop: ${nodes['#vehicle-status'].textContent}`);
assert.match(nodes['#vehicle-status'].textContent, /停止/);
nodes['#vehicle-stop'].dispatch('click');
assert.equal(routes().length, 1, 'test drive never destroys track sections');

// A 200m ten-car unit cannot depart from the 120m platform built for six cars.
nodes['#floor-level'].value = '-5';
nodes['#floor-level'].dispatch('change');
nodes['#car-count'].value = '6';
nodes['#car-count'].dispatch('change');
nodes['#place-tool'].dispatch('click');
mouseTap(200, 420);
nodes['#track-tool'].dispatch('click');
mouseTap(200, 100);
assert.equal(nodes['#build-track'].disabled, false, 'six-car station can originate a double track');
commit();
nodes['#fleet-tool'].dispatch('click');
nodes['#vehicle-model'].value = 'keio5000';
nodes['#vehicle-model'].dispatch('change');
nodes['#vehicle-run'].dispatch('click');
assert.match(nodes['#vehicle-status'].textContent, /200m以上のホームが必要/);
assert.equal(nodes['#train-layer'].children.length, 0, 'overlong train is refused before rendering');
nodes['#vehicle-model'].value = 'meitetsu2200';
nodes['#vehicle-model'].dispatch('change');
nodes['#vehicle-run'].dispatch('click');
assert.equal(nodes['#train-layer'].children.length, 6, 'six-car train fits the 120m platform');
nodes['#vehicle-stop'].dispatch('click');

// 1-track depots are placed independently of station and track tools.
const routesBeforeDepot = routes().length;
const stationsBeforeDepot = nodes['#placed'].children.length;
nodes['#depot-tool'].dispatch('click');
assert.equal(nodes['#depot-tool'].attributes['aria-pressed'], 'true');
assert.equal(nodes['#place-tool'].attributes['aria-pressed'], 'false');
assert.equal(nodes['#track-tool'].attributes['aria-pressed'], 'false');
mouseTap(110, 210);
assert.equal(nodes['#depots'].children.length, 1, 'depot builds a separate mapped object');
assert.equal(routes().length, routesBeforeDepot, 'depot construction does not create unrelated mainline tracks');
assert.equal(nodes['#placed'].children.length, stationsBeforeDepot, 'depot does not become a passenger station');
assert.equal(nodes['#depot-panel'].hidden, false, 'purchase sheet appears after building a depot');
assert.match(nodes['#depot-info'].textContent, /留置線1線・6両対応（有効長120m）/);
const depotOne = nodes['#depots'].children[0];
assert.equal(depotOne.children[0].children.filter(child => child.attributes.class === 'depot-rail').length, 1,
  'the depot has exactly one storage track');
assert.equal(depotOne.children[0].attributes.transform, 'rotate(90)', 'depot is vertical like stations');
nodes['#depot-vehicle'].value = 'keio5000';
nodes['#depot-vehicle'].dispatch('change');
assert.equal(nodes['#depot-buy'].disabled, true, 'six-car siding forbids a ten-car purchase');
assert.match(nodes['#depot-status'].textContent, /10両編成は6両対応/);
nodes['#depot-buy'].dispatch('click');
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes['data-depot-car']).length, 0,
  'the length constraint is also enforced in the purchase handler');
nodes['#depot-vehicle'].value = 'meitetsu2200';
nodes['#depot-vehicle'].dispatch('change');
nodes['#depot-buy'].dispatch('click');
assert.match(nodes['#depot-status'].textContent, /名鉄2200系 6両を購入登録/);
assert.equal(nodes['#depot-buy'].disabled, true, 'occupied one-track depot rejects another purchase');
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes['data-depot-car']).length, 6);
const depotOneCars = nodes['#depots'].children[0].children[0].children.filter(child => child.attributes['data-depot-car']);
assert.ok(Math.abs(Number(depotOneCars[0].attributes.height) / Number(nodes['#depots'].children[0].children[0].children[0].attributes.height) - 2.8 / 18) < 1e-8,
  'depot train roof is rendered at the real-world 2.8m width');
assert.ok(Math.abs(Number(depotOneCars[0].attributes.width) /
  Number(nodes['#depots'].children[0].children[0].children[0].attributes.width) - 19 / 129) < 1e-8,
  'car drawings use 20m pitch and one-meter coupler spacing on the real-scale map');
nodes['#depot-buy'].dispatch('click');
assert.match(nodes['#depot-owned'].textContent, /名鉄2200系：1編成/);

// On iPhone/touch, tapping an existing depot opens purchase rather than building another.
nodes['#depot-close'].dispatch('click');
const depotTarget = nodes['#depots'].children[0].children[0].children.at(-1);
board.dispatch('pointerdown', { pointerType: 'touch', pointerId: 200, clientX: 110, clientY: 210,
  button: 0, target: depotTarget, preventDefault() {} });
board.dispatch('pointerup', { pointerType: 'touch', pointerId: 200, clientX: 110, clientY: 210,
  button: 0, target: depotTarget, preventDefault() {} });
assert.equal(nodes['#depot-panel'].hidden, false);
assert.equal(nodes['#depots'].children.length, 1, 'touch did not accidentally add a second depot');

// A second one-track depot can accommodate a ten-car Keio train.
nodes['#car-count'].value = '10';
nodes['#car-count'].dispatch('change');
mouseTap(300, 210);
assert.equal(nodes['#depots'].children.length, 2);
assert.match(nodes['#depot-info'].textContent, /10両対応（有効長200m）/);
nodes['#depot-vehicle'].value = 'keio5000';
nodes['#depot-vehicle'].dispatch('change');
nodes['#depot-buy'].dispatch('click');
assert.match(nodes['#depot-status'].textContent, /京王5000系（2代） 10両を購入登録/);
assert.equal(nodes['#depots'].children[1].children[0].children.filter(child => child.attributes['data-depot-car']).length, 10);
assert.match(nodes['#depot-owned'].textContent, /京王5000系（2代）：1編成/);

// Current-map/current-floor filtering is the same as for stations and tracks.
nodes['#floor-level'].value = '-4';
nodes['#floor-level'].dispatch('change');
assert.equal(nodes['#depots'].children.length, 0, 'B5 depots do not leak onto B4');
nodes['#floor-level'].value = '-5';
nodes['#floor-level'].dispatch('change');
assert.equal(nodes['#depots'].children.length, 2, 'purchased depot trains survive changing floors');
nodes['#map-mode'].value = 'blank';
nodes['#map-mode'].dispatch('change');
assert.equal(nodes['#depots'].children.length, 0, 'city depots stay out of the blank map');
nodes['#map-mode'].value = 'kariya';
nodes['#map-mode'].dispatch('change');
assert.equal(nodes['#depots'].children.length, 2);

// Route names, two-letter codes, and unique station numbering work across the mobile UI.
nodes['#route-manager'].hidden = true;
nodes['#route-tool'].dispatch('click');
assert.equal(nodes['#route-manager'].hidden, false, 'route manager opens independently of placement tools');
nodes['#route-name'].value = '名鉄名古屋本線';
nodes['#route-code'].value = 'N';
nodes['#route-save'].dispatch('click');
assert.match(nodes['#route-manager-status'].textContent, /英字2文字/, 'invalid route code is rejected');
nodes['#route-code'].value = 'nh';
nodes['#route-save'].dispatch('click');
assert.match(nodes['#route-manager-status'].textContent, /名鉄名古屋本線（NH）を作成/);
assert.equal(nodes['#route-list'].children.length, 1);
assert.equal(nodes['#route-edit-target'].value, '1');
nodes['#route-edit-target'].value = '';
nodes['#route-edit-target'].dispatch('change');
nodes['#route-name'].value = '京王線';
nodes['#route-code'].value = 'NH';
nodes['#route-save'].dispatch('click');
assert.match(nodes['#route-manager-status'].textContent, /別の路線で使用中/, 'duplicate prefix is refused');
nodes['#route-code'].value = 'KO';
nodes['#route-save'].dispatch('click');
assert.equal(nodes['#route-list'].children.length, 2);
nodes['#route-close'].dispatch('click');
assert.equal(nodes['#route-manager'].hidden, true);

nodes['#map-mode'].value = 'blank';
nodes['#map-mode'].dispatch('change');
nodes['#floor-level'].value = '-4';
nodes['#floor-level'].dispatch('change');
nodes['#place-tool'].dispatch('click');
mouseTap(150, 235);
const firstNewStation = nodes['#placed'].children.at(-1);
assert.ok(firstNewStation, 'first test station was placed');
const trackNumbers = firstNewStation.children[0].children.filter(child => child.attributes.class === 'station-track-number');
assert.deepEqual(trackNumbers.map(item => item.children.at(-1).textContent), ['1', '2'], 'station draws platform numbers 1 and 2');
assert.match(firstNewStation.attributes['aria-label'], /1番線 上り方面・2番線 下り方面/);
nodes['#station-route'].value = '1';
nodes['#station-route'].dispatch('change');
assert.equal(nodes['#station-route-number'].value, '1', 'first free number is suggested');
nodes['#station-route-save'].dispatch('click');
assert.match(nodes['#station-route-status'].textContent, /NH01/);
assert.match(nodes['#placed'].children.at(-1).attributes['aria-label'], /NH01/);

mouseTap(285, 435);
nodes['#station-route'].value = '1';
nodes['#station-route'].dispatch('change');
assert.equal(nodes['#station-route-number'].value, '2', 'next number is auto-suggested');
nodes['#station-route-number'].value = '1';
nodes['#station-route-save'].dispatch('click');
assert.match(nodes['#station-route-status'].textContent, /使用中/, 'same route cannot reuse a number');
nodes['#station-route-number'].value = '2';
nodes['#station-route-save'].dispatch('click');
assert.match(nodes['#station-route-status'].textContent, /NH02/);
nodes['#station-route'].value = '2';
nodes['#station-route'].dispatch('change');
nodes['#station-route-number'].value = '1';
nodes['#station-route-save'].dispatch('click');
assert.match(nodes['#placed'].children.at(-1).attributes['aria-label'], /NH02・KO01/, 'one station can have two route numbers');
assert.equal(nodes['#station-route-list'].children.length, 2);

nodes['#route-tool'].dispatch('click');
nodes['#route-edit-target'].value = '2';
nodes['#route-edit-target'].dispatch('change');
nodes['#route-name'].value = '京王新線';
nodes['#route-code'].value = 'KN';
nodes['#route-save'].dispatch('click');
assert.match(nodes['#route-list'].children[1].children[0].textContent, /KN/, 'a route prefix can be edited');
nodes['#route-close'].dispatch('click');
assert.match(nodes['#placed'].children.at(-1).attributes['aria-label'], /NH02・KN01/, 'renaming a route updates station numbering');

nodes['#track-tool'].dispatch('click');
assert.equal(nodes['#track-editor'].hidden, false);
nodes['#track-origin'].value = `station:${firstNewStation.attributes['data-station-id']}:1`;
nodes['#track-origin'].dispatch('change');
nodes['#track-route'].value = '1';
const countBeforeNamedTrack = routes().length;
mouseTap(150, 585);
assert.equal(nodes['#build-track'].disabled, false, nodes['#track-validation'].textContent);
commit();
assert.equal(routes().length, countBeforeNamedTrack + 1);
assert.ok(routes().at(-1).children.some(child => child.attributes.class === 'route-track-guide'),
  'a constructed track section displays its assigned route-colored guide');

// A new blank floor can connect a two-track station to exactly one open depot throat.
nodes['#floor-level'].value = '-3';
nodes['#floor-level'].dispatch('change');
nodes['#car-count'].value = '2';
nodes['#car-count'].dispatch('change');
nodes['#place-tool'].dispatch('click');
mouseTap(200, 90);
const depotLinkStationId = nodes['#placed'].children[0].attributes['data-station-id'];
nodes['#depot-tool'].dispatch('click');
mouseTap(200, 530);
const linkedDepotId = nodes['#depots'].children[0].attributes['data-depot-id'];
assert.equal(nodes['#depot-angle'].value, '90');
assert.equal(nodes['#depots'].children[0].children[0].attributes.transform, 'rotate(90)');
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes.class === 'depot-buffer').length, 1,
  'head-end storage has a buffer stop only on the closed end');
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes.class === 'depot-rail').length, 1);

// The selected depot supports a continuous angle slider and a pointer-drag grip.
nodes['#depot-angle'].value = '270.5';
nodes['#depot-angle'].dispatch('input');
assert.equal(nodes['#depots'].children[0].children[0].attributes.transform, 'rotate(270.5)');
assert.equal(nodes['#depot-angle-value'].textContent, '270.5°');
const beforeDepotMove = nodes['#depots'].children[0].attributes.transform;
const depotBody = nodes['#depots'].children[0].children[0].children.find(child => child.attributes.class === 'depot-hit');
board.dispatch('pointerdown', { pointerType: 'touch', pointerId: 402, clientX: 200, clientY: 530, button: 0, target: depotBody, preventDefault() {} });
touch('pointermove', 402, 211, 530); // 11px stays a tap; it must not shift the building
assert.equal(nodes['#depots'].children[0].attributes.transform, beforeDepotMove);
touch('pointermove', 402, 230, 530);
touch('pointerup', 402, 230, 530);
assert.notEqual(nodes['#depots'].children[0].attributes.transform, beforeDepotMove, 'touch drag moves depot');
const movedDepotCenter = nodes['#depots'].children[0].attributes.transform;
const grip = nodes['#depots'].children[0].children.find(child => child.attributes.class === 'rotation-grip');
assert.ok(grip, 'selected depot has a purple free-rotation handle');
board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 407, clientX: 230, clientY: 490, button: 0, target: grip, preventDefault() {} });
board.dispatch('pointermove', { pointerType: 'mouse', pointerId: 407, clientX: 270, clientY: 530, target: board, preventDefault() {} });
board.dispatch('pointerup', { pointerType: 'mouse', pointerId: 407, clientX: 270, clientY: 530, target: board, preventDefault() {} });
assert.notEqual(nodes['#depot-angle-value'].textContent, '270.5°', 'grip rotates depot with pointer movement');
assert.equal(nodes['#depots'].children[0].attributes.transform, movedDepotCenter, 'rotation does not translate depot');
nodes['#depot-angle'].value = '270';
nodes['#depot-angle'].dispatch('input');

nodes['#track-tool'].dispatch('click');
const depotOriginKey = `depot:${linkedDepotId}`;
assert.ok(nodes['#track-origin'].children.some(option => option.value === depotOriginKey), 'depot throat is a selectable source');
assert.equal(nodes['#station-endpoints'].children.length, 3, 'one depot marker and two station markers');
nodes['#track-origin'].value = `station:${depotLinkStationId}:1`;
nodes['#track-origin'].dispatch('change');
const entranceMarker = nodes['#station-endpoints'].children[2].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
tapTarget(Number(entranceMarker[1]), Number(entranceMarker[2]));
assert.equal(nodes['#connection-dialog'].hidden, false, nodes['#track-validation'].textContent);
assert.equal(nodes['#connection-question'].textContent, `車両基地${linkedDepotId}の出入口に接続しますか？`);
assert.equal(nodes['#build-track'].disabled, false, nodes['#track-validation'].textContent);
nodes['#connection-confirm'].dispatch('click');
assert.equal(routes().length, 1, 'station and depot are joined on the same floor');
checkCrossovers(routes()[0], ['source']); // depot has a single-track turnout, not an X crossover
assert.ok(endpointGap(routes()[0], true) < 1e-7, 'two line tracks merge exactly onto the one depot rail');
assert.equal(nodes['#station-endpoints'].children[2].children[0].attributes.class, 'station-endpoint occupied');
assert.ok(!nodes['#track-origin'].children.some(option => option.value === depotOriginKey), 'used depot throat cannot start a second line');
tapTarget(Number(entranceMarker[1]), Number(entranceMarker[2]));
assert.equal(nodes['#connection-dialog'].hidden, true, 'occupied depot throat is not connectable twice');
assert.match(nodes['#track-validation'].textContent, /既に線路が接続/);
nodes['#track-tool'].dispatch('click');
// Track tool closes on construction, leaving the depot selectable with locked rotation and position.
const connectedDepotBody = nodes['#depots'].children[0].children[0].children.find(child => child.attributes.class === 'depot-hit');
board.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 411, clientX: 230, clientY: 530, button: 0, target: connectedDepotBody, preventDefault() {} });
const connectedTransform = nodes['#depots'].children[0].attributes.transform;
mouse('pointermove', 310, 550);
mouse('pointerup', 310, 550);
assert.equal(nodes['#depots'].children[0].attributes.transform, connectedTransform, 'connected depot cannot be dragged away');
assert.equal(nodes['#depot-angle'].disabled, true, 'connected depot rotation slider is locked');
assert.match(nodes['#depot-guidance'].textContent, /線路接続済み/);

// A depot also works as a track origin, joining the station's upper end from below.
nodes['#floor-level'].value = '-2';
nodes['#floor-level'].dispatch('change');
nodes['#depot-tool'].dispatch('click');
mouseTap(200, 100);
const originDepotId = nodes['#depots'].children[0].attributes['data-depot-id'];
nodes['#place-tool'].dispatch('click');
mouseTap(200, 520);
nodes['#track-tool'].dispatch('click');
nodes['#track-origin'].value = `depot:${originDepotId}`;
nodes['#track-origin'].dispatch('change');
const stationEntrance = nodes['#station-endpoints'].children[0].attributes.transform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
tapTarget(Number(stationEntrance[1]), Number(stationEntrance[2]));
assert.equal(nodes['#build-track'].disabled, false, nodes['#track-validation'].textContent);
assert.match(nodes['#connection-question'].textContent, /上り側に接続しますか/);
nodes['#connection-confirm'].dispatch('click');
assert.equal(routes().length, 1);
assert.ok(endpointGap(routes()[0]) < 1e-7, 'origin depot throat has one rail');
checkCrossovers(routes()[0], ['destination']);

// Timetabled train types belong to a line and independently toggle every registered stopping point.
const model = windowMock.vehicleTestHooks;
const b2Station = model.positions.find(station => station.id === Number(nodes['#placed'].children[0].attributes['data-station-id']));
const b2Depot = model.depots.find(depot => depot.id === Number(originDepotId));
b2Station.carCount = 6;
b2Station.routeNumbers ||= {};
b2Station.routeNumbers[1] = 3;
b2Depot.carCount = 6;
nodes['#service-tool'].dispatch('click');
assert.equal(nodes['#service-manager'].hidden, false, 'service tab opens');
nodes['#service-name'].value = '急行';
nodes['#service-route'].value = '1';
nodes['#service-route'].dispatch('change');
assert.equal(nodes['#service-stops'].children.length, 3, 'selected line lists three numbered stations');
assert.equal(nodes['#service-stops'].children.filter(node => node.attributes['aria-pressed'] === 'true').length, 3);
nodes['#service-save'].dispatch('click');
assert.equal(model.services.length, 1, 'one named service is created');
assert.equal(model.services[0].stopIds.length, 3, 'all listed stations stop by default');
nodes['#service-edit-target'].value = '1';
nodes['#service-edit-target'].dispatch('change');
nodes['#service-stops'].children[0].dispatch('click');
nodes['#service-stops'].children[1].dispatch('click');
assert.equal(nodes['#service-stops'].children.filter(node => node.attributes['aria-pressed'] === 'true').length, 1);
nodes['#service-save'].dispatch('click');
assert.equal(model.services[0].stopIds.length, 1, 'editing a service stores its stop pattern');
assert.equal(model.services[0].stopIds[0], b2Station.id);
nodes['#service-close'].dispatch('click');

// An actual purchased consist leaves the single-track depot, stops at its route station,
// waits for a manual return instruction, and comes home without deleting the purchase.
model.selectDepot(b2Depot.id);
nodes['#depot-vehicle'].value = 'meitetsu2200';
nodes['#depot-vehicle'].dispatch('change');
nodes['#depot-buy'].dispatch('click');
assert.equal(b2Depot.vehicleId, 'meitetsu2200');
nodes['#depot-service'].value = '1';
nodes['#depot-service'].dispatch('change');
assert.equal(b2Depot.serviceId, 1, 'purchased set keeps its assigned train type');
const plan = model.buildDepotJourney(b2Depot, model.services[0]);
assert.ok(plan.route?.points?.length > 2, plan.error || 'depot-to-station geometry exists');
assert.equal(plan.outwardStops.length, 1);
nodes['#depot-speed'].value = '30';
nodes['#depot-dispatch'].dispatch('click');
assert.ok(model.depotRun(), nodes['#depot-status'].textContent);
assert.equal(nodes['#follow-train'].disabled, false, 'depot dispatch enables tracking');
nodes['#follow-train'].dispatch('click');
assertTrackingCentered('depot dispatch');
assert.equal(nodes['#depot-dispatch'].disabled, true, 'a second departure is impossible during operation');
assert.equal(nodes['#train-layer'].children.length, 6, 'outbound consist uses six animated car bodies');
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes['data-depot-car']).length, 0,
  'stationary duplicate is hidden while its unit travels');
advanceFrames(1500);
assertTrackingCentered('outbound train at terminus');
assert.equal(nodes['#depot-return'].disabled, false, `train arrived and awaits return: ${nodes['#depot-status'].textContent}`);
assert.match(nodes['#depot-status'].textContent, /折返し待機/);
nodes['#depot-return'].dispatch('click');
assert.equal(nodes['#depot-return'].disabled, true, 'return instruction is single use');
advanceFrames(10);
assertTrackingCentered('return trip');
advanceFrames(1500);
assert.equal(model.depotRun(), null, `train has returned into storage: ${nodes['#depot-status'].textContent}`);
assert.equal(nodes['#follow-train'].disabled, true, 'arrival into depot ends tracking');
assert.equal(b2Depot.vehicleId, 'meitetsu2200', 'arrival preserves owned vehicle');
assert.match(nodes['#depot-status'].textContent, /入庫しました/);
assert.equal(nodes['#depots'].children[0].children[0].children.filter(child => child.attributes['data-depot-car']).length, 6,
  'parked stock reappears only after arrival');

console.log('Tracks, route stops/type editing, purchased-unit depot departure and return, mobile depot move/rotation and lock OK');
