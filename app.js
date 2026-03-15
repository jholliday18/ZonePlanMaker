 /* ZonePlan UI interactions */
const app = document.querySelector('.app');
const canvas = document.getElementById('canvas');
const svg = document.getElementById('drawingSvg');
const gridToggle = document.getElementById('gridToggle');
const zoomLabel = document.querySelector('.zoom-label');
const floorplanInput = document.getElementById('floorplanInput');

const properties = {
  wrapper: document.getElementById('properties'),
  empty: document.querySelector('.properties__empty'),
  zoneName: document.getElementById('zoneName'),
  zoneNumber: document.getElementById('zoneNumber'),
  zoneColor: document.getElementById('zoneColor'),
  zoneLabelColor: document.getElementById('zoneLabelColor'),
  opacity: document.getElementById('opacity'),
  opacityValue: document.getElementById('opacityValue'),
  stroke: document.getElementById('stroke'),
  strokeValue: document.getElementById('strokeValue'),
  lock: document.getElementById('lockToggle'),
  duplicate: document.getElementById('duplicateBtn'),
};

const state = {
  theme: 'light',
  zoom: 1,
  pan: { x: 0, y: 0 },
  isPanning: false,
  panStart: null,
  selectedTool: 'select',
  isCanvasFocused: false,
  floorplan: null,
  activeSymbol: null,
  selection: null,
  dragging: null,
  drawing: null,
  polygonPoints: [],
  history: [],
  redo: [],
  editingHandle: null,
  defaultColors: ['#0066cc', '#6600cc', '#cc0066', '#cc6600', '#00cc66', '#0066cc', '#cc0066', '#6600cc'],
  colorIndex: 0,
};

window.addEventListener('error', (event) => {
  console.error('ZonePlan runtime error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('ZonePlan unhandled rejection:', event.reason);
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyTransform() {
  canvas.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
}

function setZoom(value) {
  state.zoom = clamp(value, 0.4, 2.5);
  const percent = Math.round(state.zoom * 100);
  zoomLabel.textContent = `${percent}%`;
  applyTransform();
  if (state.selection && state.selection.dataset.type === 'zone') {
    updateEditHandles(state.selection);
  }
}

function setPan(x, y) {
  state.pan.x = x;
  state.pan.y = y;
  applyTransform();
}

function updateToolSelection(tool) {
  state.selectedTool = tool;
  state.drawing = null;
  state.polygonPoints = [];
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.tool === tool ? 'true' : 'false');
  });

  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

function updateGridVisibility(enabled) {
  canvas.dataset.grid = enabled ? 'true' : 'false';
}

function pushHistory() {
  const snapshot = svg.innerHTML;
  state.history.push(snapshot);
  if (state.history.length > 60) state.history.shift();
  state.redo = [];
}

function undo() {
  if (!state.history.length) return;
  const current = svg.innerHTML;
  state.redo.push(current);
  const last = state.history.pop();
  svg.innerHTML = last;
  attachShapeListeners();
  clearSelection();
}

function redo() {
  if (!state.redo.length) return;
  const next = state.redo.pop();
  pushHistory();
  svg.innerHTML = next;
  attachShapeListeners();
  clearSelection();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left - state.pan.x) / state.zoom;
  const y = (event.clientY - rect.top - state.pan.y) / state.zoom;
  return { x, y };
}

function createSvgElement(tag, attrs = {}) {
  const elem = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => elem.setAttribute(key, value));
  return elem;
}

function updateZoneText(group) {
  const shape = group.querySelector('rect, polygon, polyline');
  const text = group.querySelector('text');
  if (!shape || !text) return;

  let cx, cy;
  if (shape.tagName === 'rect') {
    const x = parseFloat(shape.getAttribute('x')) || 0;
    const y = parseFloat(shape.getAttribute('y')) || 0;
    const width = parseFloat(shape.getAttribute('width')) || 0;
    const height = parseFloat(shape.getAttribute('height')) || 0;
    cx = x + width / 2;
    cy = y + height / 2;
  } else if (shape.tagName === 'polygon' || shape.tagName === 'polyline') {
    const pointsStr = shape.getAttribute('points');
    if (!pointsStr) return;
    const points = pointsStr.split(' ').map(p => {
      const [x, y] = p.split(',');
      return { x: parseFloat(x), y: parseFloat(y) };
    });
    cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  }

  text.setAttribute('x', cx);
  text.setAttribute('y', cy);
}

function createEditHandles(group) {
  removeEditHandles(group);
  const shape = group.querySelector('rect, polygon, polyline');
  if (!shape) return;

  if (shape.tagName === 'rect') {
    const x = parseFloat(shape.getAttribute('x')) || 0;
    const y = parseFloat(shape.getAttribute('y')) || 0;
    const width = parseFloat(shape.getAttribute('width')) || 0;
    const height = parseFloat(shape.getAttribute('height')) || 0;

    const handles = [
      { type: 'corner', pos: 'nw', hx: x, hy: y },
      { type: 'edge', pos: 'n', hx: x + width / 2, hy: y },
      { type: 'corner', pos: 'ne', hx: x + width, hy: y },
      { type: 'edge', pos: 'e', hx: x + width, hy: y + height / 2 },
      { type: 'corner', pos: 'se', hx: x + width, hy: y + height },
      { type: 'edge', pos: 's', hx: x + width / 2, hy: y + height },
      { type: 'corner', pos: 'sw', hx: x, hy: y + height },
      { type: 'edge', pos: 'w', hx: x, hy: y + height / 2 },
    ];

    handles.forEach(h => {
      const handle = createSvgElement('circle', {
        cx: h.hx,
        cy: h.hy,
        r: 5 / state.zoom,
        class: 'edit-handle',
        'data-handle-type': h.type,
        'data-handle-pos': h.pos,
      });
      handle.onmousedown = (event) => {
        event.stopPropagation();
        state.editingHandle = { element: handle, group: group, type: h.type, pos: h.pos };
      };
      group.appendChild(handle);
    });
  } else if (shape.tagName === 'polygon' || shape.tagName === 'polyline') {
    const pointsStr = shape.getAttribute('points');
    if (!pointsStr) return;
    const points = pointsStr.split(' ').map(p => {
      const [x, y] = p.split(',');
      return { x: parseFloat(x), y: parseFloat(y) };
    });

    points.forEach((p, i) => {
      const handle = createSvgElement('circle', {
        cx: p.x,
        cy: p.y,
        r: 5 / state.zoom,
        class: 'edit-handle',
        'data-handle-type': 'vertex',
        'data-vertex-index': i,
      });
      handle.onmousedown = (event) => {
        event.stopPropagation();
        state.editingHandle = { element: handle, group: group, type: 'vertex', index: i };
      };
      group.appendChild(handle);
    });
  }
}

function removeEditHandles(group) {
  group.querySelectorAll('.edit-handle').forEach(h => h.remove());
}

function updateEditHandles(group) {
  if (group.dataset.type !== 'zone') return;
  createEditHandles(group);
}

function createZoneShape(type, options = {}) {
  const group = createSvgElement('g', {
    'data-type': 'zone',
    'data-locked': options.locked ? 'true' : 'false',
    class: 'shape',
  });

  const shape = createSvgElement(type, {
    fill: type === 'polyline' ? 'none' : (options.fill || 'rgba(0, 102, 204, 0.26)'),
    'fill-opacity': type === 'polyline' ? 1 : (options.opacity ?? 0.9),
    stroke: (type === 'polygon' || type === 'polyline') ? 'black' : (options.stroke || 'rgba(0, 102, 204, 0.9)'),
    'stroke-width': options.strokeWidth ?? (type === 'polygon' || type === 'polyline' ? 5 : 3),
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });

  if (options.name) group.dataset.zoneName = options.name;
  if (options.number) group.dataset.zoneNumber = options.number;
  let zoneColor = options.color;
  if (!zoneColor) {
    zoneColor = state.defaultColors[state.colorIndex % state.defaultColors.length];
    state.colorIndex++;
  }
  shape.setAttribute('fill', zoneColor + '40');
  shape.setAttribute('stroke', zoneColor);
  group.dataset.zoneColor = zoneColor;

  const text = createSvgElement('text', {
    'text-anchor': 'middle',
    'font-size': 14,
    'font-family': 'Inter, system-ui, sans-serif',
    fill: '#000000',
    'pointer-events': 'none',
  });

  text.textContent = options.number ? `Zone ${options.number}` : 'Zone';

  group.append(shape, text);
  return group;
}

function getSelectedAttributes() {
  if (!state.selection) return {};
  const el = state.selection;
  const shape = el.querySelector('rect, polygon, polyline');
  const text = el.querySelector('text');
  return {
    name: el.dataset.zoneName || '',
    number: el.dataset.zoneNumber || '',
    color: el.dataset.zoneColor || '#0066cc',
    labelColor: text?.getAttribute('fill') || '#000000',
    opacity: Math.round((parseFloat(shape?.getAttribute('fill-opacity')) || 0.9) * 100),
    stroke: parseFloat(shape?.getAttribute('stroke-width')) || 2,
    locked: el.getAttribute('data-locked') === 'true',
  };
}

function updatePropertiesPanel() {
  if (!state.selection) {
    properties.empty.style.display = 'grid';
    properties.wrapper.querySelectorAll('.property, .btn--full').forEach((el) => el.classList.add('hidden'));
    return;
  }

  properties.empty.style.display = 'none';
  properties.wrapper.querySelectorAll('.property, .btn--full').forEach((el) => el.classList.remove('hidden'));

  const attr = getSelectedAttributes();
  properties.zoneName.value = attr.name;
  properties.zoneNumber.value = attr.number;
  properties.zoneColor.value = attr.color;
  properties.zoneLabelColor.value = attr.labelColor;
  properties.opacity.value = attr.opacity;
  properties.opacityValue.textContent = `${attr.opacity}%`;
  properties.stroke.value = attr.stroke;
  properties.strokeValue.textContent = `${attr.stroke} px`;
  properties.lock.setAttribute('aria-pressed', attr.locked ? 'true' : 'false');
}

function clearSelection() {
  if (state.selection) {
    state.selection.classList.remove('shape--selected');
    removeEditHandles(state.selection);
  }
  state.selection = null;
  updatePropertiesPanel();
}

function selectElement(el) {
  if (!el || el.getAttribute('data-locked') === 'true') return;
  clearSelection();
  state.selection = el;
  el.classList.add('shape--selected');
  if (el.dataset.type === 'zone') {
    createEditHandles(el);
  }
  updatePropertiesPanel();
}

function updateSelectedElementFromProperties() {
  if (!state.selection) return;
  const el = state.selection;
  const shape = el.querySelector('rect, polygon, polyline');
  const text = el.querySelector('text');
  el.dataset.zoneName = properties.zoneName.value;
  el.dataset.zoneNumber = properties.zoneNumber.value;
  el.dataset.zoneColor = properties.zoneColor.value;
  shape.setAttribute('fill', `${properties.zoneColor.value}40`);
  shape.setAttribute('stroke', properties.zoneColor.value);
  shape.setAttribute('fill-opacity', Number(properties.opacity.value) / 100);
  shape.setAttribute('stroke-width', properties.stroke.value);
  el.setAttribute('data-locked', properties.lock.getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
  if (text) {
    text.textContent = properties.zoneNumber.value ? `Zone ${properties.zoneNumber.value}` : 'Zone';
    text.setAttribute('fill', properties.zoneLabelColor.value);
    updateZoneText(el);
  }
  if (el.dataset.type === 'zone') {
    updateEditHandles(el);
  }
}

function attachShapeListeners() {
  svg.querySelectorAll('.shape').forEach((shape) => {
    shape.onmousedown = (event) => {
      event.stopPropagation();
      if (state.selectedTool === 'delete') {
        if (shape.getAttribute('data-locked') !== 'true') {
          pushHistory();
          shape.remove();
          clearSelection();
        }
        return;
      }
      if (shape.getAttribute('data-locked') === 'true') return;
      selectElement(shape);

      if (state.selectedTool === 'select') {
        if (event.target.classList.contains('edit-handle')) return;
        const point = getCanvasPoint(event);
        state.dragging = {
          element: shape,
          start: point,
          baseTransform: shape.getAttribute('transform') || '',
        };
      }
    };
  });
}

function createSymbol(x, y) {
  const symbol = createSvgElement('g', {
    class: 'shape',
    'data-type': 'symbol',
    'data-locked': 'false',
    transform: `translate(${x}, ${y})`,
  });

  // NFPA 170 symbols
  const symbolElements = {
    SD: () => [
      createSvgElement('circle', { cx: 0, cy: 0, r: 12, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('circle', { cx: 0, cy: 0, r: 2, fill: 'black' })
    ],
    HD: () => [
      createSvgElement('circle', { cx: 0, cy: 0, r: 12, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-4 -4 L0 -6 L4 -4 L2 0 L-2 0 Z', fill: 'black' })
    ],
    FACP: () => [
      createSvgElement('rect', { x: -8, y: -8, width: 16, height: 16, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('line', { x1: -6, y1: -4, x2: 6, y2: -4, stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('line', { x1: -6, y1: 0, x2: 6, y2: 0, stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('line', { x1: -6, y1: 4, x2: 6, y2: 4, stroke: 'black', 'stroke-width': 1 })
    ],
    MCP: () => [
      createSvgElement('rect', { x: -6, y: -6, width: 12, height: 12, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('circle', { cx: 0, cy: 0, r: 3, fill: 'black' })
    ],
    EXIT: () => [
      createSvgElement('path', { d: 'M-9 9h18', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-7 9V-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-3 9v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M4 -7l-3 3 3 3', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-4 -7l3 3-3 3', stroke: 'black', 'stroke-width': 2 })
    ],
    EXTINGUISHER: () => [
      createSvgElement('rect', { x: -4, y: -8, width: 8, height: 16, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('rect', { x: -6, y: -6, width: 12, height: 4, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('line', { x1: -2, y1: -4, x2: 2, y2: -4, stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('line', { x1: 0, y1: -6, x2: 0, y2: -2, stroke: 'black', 'stroke-width': 2 })
    ],
    STR: () => [
      createSvgElement('path', { d: 'M-9 -9v18h18', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-6 -6h12', stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('path', { d: 'M-6 -3h12', stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('path', { d: 'M-6 0h12', stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('path', { d: 'M-6 3h12', stroke: 'black', 'stroke-width': 1 }),
      createSvgElement('path', { d: 'M-6 6h12', stroke: 'black', 'stroke-width': 1 })
    ],
    EMERGENCY: () => [
      createSvgElement('path', { d: 'M-9 9h18', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-7 9V-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-3 9v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M4 -7l-3 3 3 3', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('path', { d: 'M-4 -7l3 3-3 3', stroke: 'black', 'stroke-width': 2 }),
      createSvgElement('circle', { cx: 0, cy: 0, r: 1, fill: 'black' })
    ]
  };

  const elements = symbolElements[state.activeSymbol]?.() || [
    createSvgElement('circle', { cx: 0, cy: 0, r: 12, fill: 'none', stroke: 'black', 'stroke-width': 2 }),
    createSvgElement('text', { x: 0, y: 4, 'text-anchor': 'middle', 'font-size': 12, fill: 'black', 'font-family': 'Inter, system-ui, sans-serif', 'font-weight': 'bold' })
  ];

  if (state.activeSymbol && !symbolElements[state.activeSymbol]) {
    elements[1].textContent = state.activeSymbol;
  }

  symbol.append(...elements);
  return symbol;
}

function onCanvasPointerDown(event) {
  if (event.button === 1 || (state.selectedTool === 'select' && event.shiftKey)) {
    state.isPanning = true;
    canvas.classList.add('canvas--panning');
    state.panStart = { x: event.clientX - state.pan.x, y: event.clientY - state.pan.y };
    return;
  }

  if (event.button === 2 && state.selectedTool === 'polygon' && state.drawing) {
    event.preventDefault();
    selectElement(state.drawing.group || state.drawing.element);
    state.drawing = null;
    state.polygonPoints = [];
    return;
  }

  const point = getCanvasPoint(event);

  if (state.selectedTool === 'rectangle') {
    const rect = createZoneShape('rect');
    rect.setAttribute('x', point.x);
    rect.setAttribute('y', point.y);
    rect.setAttribute('width', 0);
    rect.setAttribute('height', 0);
    svg.appendChild(rect);
    state.drawing = { element: rect, start: point, type: 'rectangle' };
    pushHistory();
    attachShapeListeners();
  }

  if (state.selectedTool === 'draw') {
    const group = createZoneShape('polyline');
    const shape = group.querySelector('polyline');
    shape.setAttribute('points', `${point.x},${point.y}`);
    svg.appendChild(group);
    state.drawing = { group, shape, type: 'draw' };
    pushHistory();
    attachShapeListeners();
  }

  if (state.selectedTool === 'polygon') {
    if (!state.drawing) {
      const group = createZoneShape('polygon');
      const shape = group.querySelector('polygon');
      shape.setAttribute('points', `${point.x},${point.y} ${point.x},${point.y}`);
      svg.appendChild(group);
      state.drawing = { group, shape, type: 'polygon' };
      state.polygonPoints = [point];
      pushHistory();
      attachShapeListeners();
    } else {
      const start = state.polygonPoints[0];
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const distSq = dx * dx + dy * dy;
      const closeThreshold = 12 * 12; // 12px radius

      // if user clicks near the first vertex, close the polygon
      if (state.polygonPoints.length > 2 && distSq <= closeThreshold) {
        const pts = state.polygonPoints.map((p) => `${p.x},${p.y}`).join(' ');
        state.drawing.shape.setAttribute('points', pts);
        selectElement(state.drawing.group);
        state.drawing = null;
        state.polygonPoints = [];
        return;
      }

      state.polygonPoints.push(point);
      const pts = state.polygonPoints.map((p) => `${p.x},${p.y}`).join(' ');
      state.drawing.shape.setAttribute('points', pts);
    }
  }

  if (state.selectedTool === 'symbol' && state.activeSymbol) {
    const symbol = createSymbol(point.x, point.y);
    svg.appendChild(symbol);
    pushHistory();
    attachShapeListeners();
  }

  if (state.selectedTool === 'delete') {
    // deletion handled in shape click handler
  }
}

function onCanvasPointerMove(event) {
  if (state.isPanning) {
    const x = event.clientX - state.panStart.x;
    const y = event.clientY - state.panStart.y;
    setPan(x, y);
    return;
  }

  if (state.dragging) {
    const point = getCanvasPoint(event);
    const dx = point.x - state.dragging.start.x;
    const dy = point.y - state.dragging.start.y;
    state.dragging.element.setAttribute(
      'transform',
      `${state.dragging.baseTransform} translate(${dx},${dy})`
    );
    return;
  }

  if (state.editingHandle) {
    const point = getCanvasPoint(event);
    const handle = state.editingHandle;
    const shape = handle.group.querySelector('rect, polygon, polyline');
    if (shape.tagName === 'rect') {
      let x = parseFloat(shape.getAttribute('x')) || 0;
      let y = parseFloat(shape.getAttribute('y')) || 0;
      let width = parseFloat(shape.getAttribute('width')) || 0;
      let height = parseFloat(shape.getAttribute('height')) || 0;
      if (handle.type === 'corner') {
        if (handle.pos.includes('n')) y = Math.min(y + height, point.y);
        if (handle.pos.includes('s')) height = Math.max(0, point.y - y);
        if (handle.pos.includes('w')) x = Math.min(x + width, point.x);
        if (handle.pos.includes('e')) width = Math.max(0, point.x - x);
      } else if (handle.type === 'edge') {
        if (handle.pos === 'n') y = Math.min(y + height, point.y);
        else if (handle.pos === 's') height = Math.max(0, point.y - y);
        else if (handle.pos === 'w') x = Math.min(x + width, point.x);
        else if (handle.pos === 'e') width = Math.max(0, point.x - x);
      }
      shape.setAttribute('x', x);
      shape.setAttribute('y', y);
      shape.setAttribute('width', width);
      shape.setAttribute('height', height);
    } else if (shape.tagName === 'polygon' || shape.tagName === 'polyline') {
      const pointsStr = shape.getAttribute('points');
      if (!pointsStr) return;
      const points = pointsStr.split(' ').map(p => {
        const [x, y] = p.split(',');
        return { x: parseFloat(x), y: parseFloat(y) };
      });
      points[handle.index] = point;
      const pointsStrNew = points.map(p => `${p.x},${p.y}`).join(' ');
      shape.setAttribute('points', pointsStrNew);
    }
    updateZoneText(handle.group);
    updateEditHandles(handle.group);
    return;
  }

  if (!state.drawing) return;
  const point = getCanvasPoint(event);

  if (state.drawing.type === 'rectangle') {
    const { start, element } = state.drawing;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);
    element.querySelector('rect').setAttribute('x', x);
    element.querySelector('rect').setAttribute('y', y);
    element.querySelector('rect').setAttribute('width', width);
    element.querySelector('rect').setAttribute('height', height);
    updateZoneText(element);
  }

  if (state.drawing.type === 'draw') {
    const points = elementPoints(state.drawing.shape) + ` ${point.x},${point.y}`;
    state.drawing.shape.setAttribute('points', points);
  }

  if (state.drawing.type === 'polygon') {
    const pts = [...state.polygonPoints, point].map((p) => `${p.x},${p.y}`).join(' ');
    state.drawing.shape.setAttribute('points', pts);
    updateZoneText(state.drawing.group);
  }
}

function elementPoints(el) {
  return el.getAttribute('points') || '';
}

function onCanvasPointerUp() {
  if (state.isPanning) {
    state.isPanning = false;
    canvas.classList.remove('canvas--panning');
    return;
  }

  if (state.dragging) {
    state.dragging = null;
    return;
  }

  if (state.editingHandle) {
    state.editingHandle = null;
    return;
  }

  if (state.drawing) {
    if (state.drawing.type === 'draw' || state.drawing.type === 'rectangle') {
      selectElement(state.drawing.group || state.drawing.element);
      state.drawing = null;
    }
  }
}

function initHandlers() {

  document.querySelectorAll('[data-action="zoom-in"]').forEach((btn) => {
    btn.addEventListener('click', () => setZoom(state.zoom + 0.1));
  });

  document.querySelectorAll('[data-action="zoom-out"]').forEach((btn) => {
    btn.addEventListener('click', () => setZoom(state.zoom - 0.1));
  });

  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => updateToolSelection(btn.dataset.tool));
  });

  document.querySelectorAll('.symbol').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeSymbol = btn.dataset.symbol;
      updateToolSelection('symbol');
    });
  });

  gridToggle.addEventListener('input', (event) => {
    updateGridVisibility(event.target.checked);
  });

  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('contextmenu', (event) => {
    if (state.selectedTool === 'polygon' && state.drawing) {
      event.preventDefault();
    }
  });
  canvas.addEventListener('dblclick', (event) => {
    if (state.selectedTool === 'polygon' && state.drawing) {
      selectElement(state.drawing.group || state.drawing.element);
      state.drawing = null;
      state.polygonPoints = [];
    }
  });
  window.addEventListener('pointermove', onCanvasPointerMove);
  window.addEventListener('pointerup', onCanvasPointerUp);

  canvas.addEventListener('wheel', (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      setZoom(state.zoom + delta);
    }
  });

  document.querySelectorAll('[data-action="upload"]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!floorplanInput) {
        console.warn('Upload input not found');
        return;
      }
      floorplanInput.click();
    });
  });

  floorplanInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    state.floorplan = { file, url };

    const existingImage = canvas.querySelector('.canvas__image');
    if (existingImage) {
      existingImage.src = url;
    } else {
      const img = document.createElement('img');
      img.className = 'canvas__image';
      img.alt = 'Floorplan';
      img.src = url;
      canvas.prepend(img);
    }

    canvas.classList.add('canvas--has-floorplan');
  });

  document.querySelectorAll('[data-action="save"]').forEach((button) => {
    button.addEventListener('click', () => {
      const data = {
        floorplan: state.floorplan ? state.floorplan.file.name : null,
        svg: svg.innerHTML,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zoneplan.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  document.querySelectorAll('[data-action="export-png"]').forEach((button) => {
    button.addEventListener('click', () => {
      const rect = canvas.getBoundingClientRect();
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = rect.width;
      exportCanvas.height = rect.height;
      const ctx = exportCanvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#fff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      const floorImg = canvas.querySelector('.canvas__image');
      const drawSvg = () => {
        const wrapper = `<g transform="translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})">${svg.innerHTML}</g>`;
        const svgString = `<?xml version="1.0" encoding="UTF-8"?>` +
          `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">` +
          wrapper +
          `</svg>`;

        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          URL.revokeObjectURL(url);
          exportCanvas.toBlob((blob) => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'zoneplan.png';
            link.click();
          });
        };
        img.src = url;
      };

      if (floorImg) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          drawSvg();
        };
        img.src = floorImg.src;
      } else {
        drawSvg();
      }
    });
  });

  document.querySelectorAll('[data-action="export-pdf"]').forEach((button) => {
    button.addEventListener('click', () => {
      alert('Export to PDF: Functionality coming soon.');
    });
  });

  document.querySelectorAll('[data-action="undo"]').forEach((button) => {
    button.addEventListener('click', () => undo());
  });

  document.querySelectorAll('[data-action="redo"]').forEach((button) => {
    button.addEventListener('click', () => redo());
  });

  properties.zoneName.addEventListener('input', updateSelectedElementFromProperties);
  properties.zoneNumber.addEventListener('input', updateSelectedElementFromProperties);
  properties.zoneColor.addEventListener('input', updateSelectedElementFromProperties);
  properties.zoneLabelColor.addEventListener('input', updateSelectedElementFromProperties);
  properties.opacity.addEventListener('input', (event) => {
    properties.opacityValue.textContent = `${event.target.value}%`;
    updateSelectedElementFromProperties();
  });
  properties.stroke.addEventListener('input', (event) => {
    properties.strokeValue.textContent = `${event.target.value} px`;
    updateSelectedElementFromProperties();
  });

  properties.lock.addEventListener('click', () => {
    const pressed = properties.lock.getAttribute('aria-pressed') === 'true';
    properties.lock.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    updateSelectedElementFromProperties();
  });

  properties.duplicate.addEventListener('click', () => {
    if (!state.selection) return;
    const clone = state.selection.cloneNode(true);
    const offset = 12;

    const transform = clone.getAttribute('transform');
    if (transform) {
      clone.setAttribute('transform', `${transform} translate(${offset}, ${offset})`);
    } else {
      if (clone.hasAttribute('x')) {
        clone.setAttribute('x', Number(clone.getAttribute('x')) + offset);
        clone.setAttribute('y', Number(clone.getAttribute('y')) + offset);
      }
    }

    svg.appendChild(clone);
    pushHistory();
    attachShapeListeners();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.drawing = null;
      state.polygonPoints = [];
      clearSelection();
    }
  });

  attachShapeListeners();
}

function init() {
  try {
    setZoom(1);
    updateGridVisibility(false);
    updateToolSelection('select');
    initHandlers();
    updatePropertiesPanel();
    pushHistory();
  } catch (error) {
    console.error('ZonePlan initialization failed:', error);
  }
}

init();
