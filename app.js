(() => {
  'use strict';

  const STORAGE_KEY = 'mixit-templates-v1';
  const DB_NAME = 'mixit-studio';
  const DB_STORE = 'library';
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const RATIOS = {
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '9:16': { width: 1080, height: 1920 }
  };
  const BACKGROUNDS = [
    { id: 'transparent', name: '투명', mood: 'PNG 투명 배경', preview: 'linear-gradient(45deg,#deddd7 25%,transparent 25%),linear-gradient(-45deg,#deddd7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#deddd7 75%),linear-gradient(-45deg,transparent 75%,#deddd7 75%)' },
    { id: 'aurora', name: '오로라', mood: '선명한 그라데이션', preview: 'linear-gradient(135deg,#5864ff 0%,#923cff 52%,#ff745f 100%)' },
    { id: 'sunrise', name: '선라이즈', mood: '따뜻하고 밝게', preview: 'linear-gradient(135deg,#ff6559,#ffb83f 58%,#fff0b7)' },
    { id: 'ocean', name: '딥 오션', mood: '차분하고 깊게', preview: 'linear-gradient(135deg,#071946,#0b69a7 55%,#35d0ba)' },
    { id: 'mint', name: '프레시 민트', mood: '산뜻하고 경쾌하게', preview: 'linear-gradient(135deg,#c8f135,#71dbb8 55%,#ecffe0)' },
    { id: 'ink', name: '나이트 잉크', mood: '묵직한 다크 톤', preview: 'linear-gradient(135deg,#090b10,#252b38 60%,#4c5364)' },
    { id: 'paper', name: '크림 페이퍼', mood: '부드러운 종이 톤', preview: 'linear-gradient(135deg,#eee5d5,#fffdf6 60%,#dfd0b7)' },
    { id: 'berry', name: '베리 팝', mood: '강렬한 핑크 톤', preview: 'linear-gradient(135deg,#35004f,#9c2cff 50%,#ff4f8b)' },
    { id: 'citrus', name: '시트러스', mood: '톡 쏘는 컬러', preview: 'linear-gradient(135deg,#ff6a00,#ffc800 58%,#c8f135)' },
    { id: 'cobalt', name: '코발트', mood: '선명한 블루 톤', preview: 'linear-gradient(135deg,#161c97,#5563ff 55%,#91b6ff)' },
    { id: 'mono', name: '모노크롬', mood: '깔끔한 흑백 톤', preview: 'linear-gradient(135deg,#050505,#777 55%,#e8e8e8)' },
    { id: 'grid', name: '에디터 그리드', mood: '정돈된 그래픽', preview: 'linear-gradient(#deddd7 1px,transparent 1px),linear-gradient(90deg,#deddd7 1px,#f8f7f2 1px)' },
    { id: 'dots', name: '코랄 도트', mood: '장난스럽고 가볍게', preview: 'radial-gradient(circle,#ff745f 18%,transparent 20%)' }
  ];
  const DEFAULT_TEXT = {
    id: 'text-default', name: '문구 1', text: '오늘도\n내가 해냄', fontSize: 68, textColor: '#ffffff',
    x: 50, y: 77, textAlign: 'center', boxWidth: 60, boxHeight: 20
  };
  const DEFAULT_STATE = {
    ratio: '1:1', backgroundId: 'aurora', images: [], texts: [DEFAULT_TEXT]
  };

  let state = { ...DEFAULT_STATE, images: [], texts: [{ ...DEFAULT_TEXT }] };
  let templates = [];
  let selectedLayerId = null;
  let selectedTextId = DEFAULT_TEXT.id;
  let selectedElement = null;
  let editingTextId = null;
  let textToolActive = false;
  let inlineEditHistorySaved = false;
  let inlineResizeState = null;
  let activeTab = 'image';
  let dragState = null;
  let toastTimer;
  let imageCache = new Map();
  let elementClipboard = null;
  const undoStack = [];
  const redoStack = [];
  const HISTORY_LIMIT = 40;
  const dbPromise = openTemplateDb();

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d');

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openTemplateDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function loadTemplates() {
    const db = await dbPromise;
    if (db) {
      const stored = await new Promise(resolve => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(STORAGE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (Array.isArray(stored)) return stored.map(normalizeTemplate).filter(Boolean);
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeTemplate).filter(Boolean) : [];
    } catch (_) { return []; }
  }

  async function persistTemplates(nextTemplates) {
    const db = await dbPromise;
    if (db) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        transaction.objectStore(DB_STORE).put(nextTemplates, STORAGE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTemplates));
    }
    templates = nextTemplates;
  }

  function isFiniteRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function isValidLayer(layer) {
    return Boolean(layer && typeof layer === 'object' && !Array.isArray(layer)
      && typeof layer.id === 'string' && typeof layer.name === 'string'
      && typeof layer.dataUrl === 'string' && /^data:image\/(png|jpeg);base64,/i.test(layer.dataUrl)
      && isFiniteRange(layer.x, -20, 120) && isFiniteRange(layer.y, -20, 120)
      && isFiniteRange(layer.scale, 10, 240) && isFiniteRange(layer.rotation, -180, 180)
      && ((layer.width === undefined && layer.height === undefined)
        || (isFiniteRange(layer.width, 10, 240) && isFiniteRange(layer.height, 3, 1000)))
      && typeof layer.flipX === 'boolean' && typeof layer.flipY === 'boolean');
  }

  function isValidTextLayer(layer) {
    return Boolean(layer && typeof layer === 'object' && !Array.isArray(layer)
      && typeof layer.id === 'string' && typeof layer.name === 'string' && typeof layer.text === 'string'
      && layer.name.trim() && layer.name.length <= 30 && layer.text.length <= 120
      && /^#[0-9a-f]{6}$/i.test(layer.textColor) && ['left', 'center', 'right'].includes(layer.textAlign)
      && isFiniteRange(layer.fontSize, 16, 180) && isFiniteRange(layer.x, 5, 95) && isFiniteRange(layer.y, 5, 95)
      && isFiniteRange(layer.boxWidth, 15, 90) && isFiniteRange(layer.boxHeight, 8, 95));
  }

  function normalizeTemplate(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const requiredStrings = ['id', 'name', 'ratio', 'createdAt'];
    if (!requiredStrings.every(key => typeof item[key] === 'string')) return null;
    if (!RATIOS[item.ratio] || !item.name.trim() || item.name.length > 30) return null;

    let images;
    if (Array.isArray(item.images)) {
      if (!item.images.every(isValidLayer)) return null;
      images = item.images.map(layer => ({ ...layer }));
    } else if (item.imageData === null || item.imageData === undefined) {
      images = [];
    } else if (typeof item.imageData === 'string' && /^data:image\/(png|jpeg);base64,/i.test(item.imageData)) {
      images = [{
        id: `legacy-${item.id}`, name: item.imageName || '기존 이미지', dataUrl: item.imageData,
        x: 50 + (Number(item.imageX) || 0) * .35, y: 50 + (Number(item.imageY) || 0) * .35,
        scale: Math.max(10, Math.min(240, Number(item.imageZoom) || 100)), rotation: 0, flipX: false, flipY: false
      }];
    } else { return null; }

    let texts;
    if (Array.isArray(item.texts)) {
      if (!item.texts.every(isValidTextLayer)) return null;
      texts = item.texts.map(layer => ({ ...layer }));
    } else {
      const legacyWidth = item.textBoxWidth === undefined ? DEFAULT_TEXT.boxWidth : item.textBoxWidth;
      const legacyHeight = item.textBoxHeight === undefined ? DEFAULT_TEXT.boxHeight : item.textBoxHeight;
      const legacyText = {
        id: `legacy-text-${item.id}`, name: '문구 1', text: item.text, fontSize: item.fontSize,
        textColor: item.textColor, x: item.textX, y: item.textY, textAlign: item.textAlign,
        boxWidth: legacyWidth, boxHeight: legacyHeight
      };
      if (!isValidTextLayer(legacyText)) return null;
      texts = [legacyText];
    }

    const keys = [...images.map(layer => 'image:' + layer.id), ...texts.map(layer => 'text:' + layer.id)];
    if (item.layerOrder !== undefined && (!Array.isArray(item.layerOrder)
      || item.layerOrder.length !== keys.length || new Set(item.layerOrder).size !== keys.length
      || item.layerOrder.some(key => !keys.includes(key)))) return null;
    const layerOrder = item.layerOrder ? [...item.layerOrder] : keys;
    const thumbnail = typeof item.thumbnail === 'string' && /^data:image\/png;base64,/.test(item.thumbnail) ? item.thumbnail : null;
    const backgroundId = BACKGROUNDS.some(background => background.id === item.backgroundId) ? item.backgroundId : DEFAULT_STATE.backgroundId;
    return {
      id: item.id, name: item.name, ratio: item.ratio, backgroundId,
      createdAt: item.createdAt, images, texts, layerOrder, thumbnail
    };
  }

  function currentTemplate(name, id = makeId(), createdAt = new Date().toISOString()) {
    orderedElements();
    renderCanvas(false);
    const preview = document.createElement('canvas');
    preview.width = 160; preview.height = Math.round(160 * canvas.height / canvas.width);
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    const thumbnail = preview.toDataURL('image/png');
    renderCanvas();
    return { ...state, id, name: name.trim(), createdAt, thumbnail, layerOrder: [...state.layerOrder], images: state.images.map(layer => ({ ...layer })), texts: state.texts.map(layer => ({ ...layer })) };
  }

  // Back-to-front order is shared by images and text.
  function orderedElements(source = state) {
    const all = [...source.images.map(layer => ({ type: 'image', layer })),
      ...source.texts.map(layer => ({ type: 'text', layer }))];
    const key = item => item.type + ':' + item.layer.id;
    const order = source.layerOrder || [];
    const byKey = new Map(all.map(item => [key(item), item]));
    const result = order.filter(id => byKey.has(id)).map(id => byKey.get(id));
    const known = new Set(order);
    result.push(...all.filter(item => !known.has(key(item))));
    source.layerOrder = result.map(key);
    return result;
  }

  function moveElement(id, type, direction) {
    orderedElements();
    const key = type + ':' + id;
    const index = state.layerOrder.indexOf(key);
    const target = index + (direction === 'up' ? 1 : -1);
    if (index < 0 || target < 0 || target >= state.layerOrder.length) return;
    recordHistory();
    [state.layerOrder[index], state.layerOrder[target]] = [state.layerOrder[target], state.layerOrder[index]];
    if (type === 'text') selectText(id); else selectLayer(id);
  }

  function selectedLayer() {
    return state.images.find(layer => layer.id === selectedLayerId) || null;
  }

  function selectedText() {
    return state.texts.find(layer => layer.id === selectedTextId) || null;
  }

  function cloneState(source = state) {
    return { ...source, layerOrder: [...(source.layerOrder || [])], images: source.images.map(layer => ({ ...layer })), texts: source.texts.map(layer => ({ ...layer })) };
  }

  function snapshot() {
    return { state: cloneState(), selectedLayerId, selectedTextId, selectedElement, activeTab };
  }

  function recordHistory(entry = snapshot()) {
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  async function restoreSnapshot(entry) {
    try {
      await hydrateImages(entry.state.images);
      state = cloneState(entry.state);
      selectedLayerId = entry.selectedLayerId;
      selectedTextId = entry.selectedTextId;
      selectedElement = entry.selectedElement;
      switchTab(entry.activeTab);
      syncControls();
      renderLayers();
      setCanvasRatio();
    } catch (_) {
      showToast('이전 상태의 이미지를 복원하지 못했습니다.');
    }
  }

  async function undo() {
    if (!undoStack.length) { showToast('되돌릴 작업이 없습니다.'); return; }
    redoStack.push(snapshot());
    await restoreSnapshot(undoStack.pop());
    showToast('이전 작업으로 되돌렸습니다.');
  }

  async function redo() {
    if (!redoStack.length) { showToast('다시 실행할 작업이 없습니다.'); return; }
    undoStack.push(snapshot());
    await restoreSnapshot(redoStack.pop());
    showToast('작업을 다시 실행했습니다.');
  }

  function syncControls() {
    const text = selectedText();
    $('#textControls').disabled = !text;
    $('#fontSize').value = text?.fontSize || DEFAULT_TEXT.fontSize;
    $('#textColor').value = text?.textColor || DEFAULT_TEXT.textColor;
    $('#colorValue').textContent = (text?.textColor || DEFAULT_TEXT.textColor).toUpperCase();
    $('#textX').value = text?.x || DEFAULT_TEXT.x;
    $('#textY').value = text?.y || DEFAULT_TEXT.y;
    $$('.ratio-button').forEach(button => button.classList.toggle('active', button.dataset.ratio === state.ratio));
    $$('.align-button').forEach(button => button.classList.toggle('active', button.dataset.align === text?.textAlign));
    $('#textToolButton').setAttribute('aria-pressed', String(textToolActive));
    syncBackgroundOptions();
    syncLayerControls();
  }

  function syncLayerControls() {
    const layer = selectedLayer();
    $('#layerControls').disabled = !layer;
    $('#selectedLayerName').textContent = layer ? layer.name : '항목을 선택해주세요';
    if (!layer) return;
    $('#layerScale').value = layer.scale;
    $('#layerScaleValue').textContent = `${Math.round(layer.scale)}%`;
    $('#layerRotation').value = layer.rotation;
    $('#layerRotationValue').textContent = `${Math.round(layer.rotation)}°`;
    $('#layerX').value = layer.x;
    $('#layerY').value = layer.y;
    $('#flipHorizontalButton').classList.toggle('active', layer.flipX);
    $('#flipVerticalButton').classList.toggle('active', layer.flipY);
  }

  function switchTab(tab) {
    activeTab = tab;
    const isImage = tab === 'image';
    if (isImage) textToolActive = false;
    $('#imageTab').hidden = !isImage;
    $('#textTab').hidden = isImage;
    $('#imageTabButton').classList.toggle('active', isImage);
    $('#textTabButton').classList.toggle('active', !isImage);
    $('#imageTabButton').setAttribute('aria-selected', String(isImage));
    $('#textTabButton').setAttribute('aria-selected', String(!isImage));
    $(isImage ? '#imageTab' : '#textTab').append($('#contentInspector'));
    $('#contentListTitle').textContent = isImage ? '이미지 목록' : '텍스트 목록';
    $('#textToolButton').setAttribute('aria-pressed', String(textToolActive));
    renderLayers();
    renderCanvas();
  }

  function setCanvasRatio() {
    const size = RATIOS[state.ratio];
    canvas.width = size.width;
    canvas.height = size.height;
    $('#canvasWrap').style.aspectRatio = `${size.width} / ${size.height}`;
    $('#canvasSize').textContent = `${size.width} × ${size.height} px`;
    renderCanvas();
  }

  function drawBackground() {
    if (state.backgroundId === 'transparent') return;
    const palettes = {
      aurora: ['#5864ff', '#923cff', '#ff745f'], sunrise: ['#ff6559', '#ffb83f', '#fff0b7'],
      ocean: ['#071946', '#0b69a7', '#35d0ba'], mint: ['#c8f135', '#71dbb8', '#ecffe0'],
      ink: ['#090b10', '#252b38', '#4c5364'], paper: ['#eee5d5', '#fffdf6', '#dfd0b7'],
      berry: ['#35004f', '#9c2cff', '#ff4f8b'], citrus: ['#ff6a00', '#ffc800', '#c8f135'],
      cobalt: ['#161c97', '#5563ff', '#91b6ff'], mono: ['#050505', '#777777', '#e8e8e8']
    };
    const palette = palettes[state.backgroundId];
    if (palette) {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, palette[0]); gradient.addColorStop(.55, palette[1]); gradient.addColorStop(1, palette[2]);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = state.backgroundId === 'paper' ? .08 : .13;
      ctx.fillStyle = '#ffffff';
      const gap = canvas.width / 7;
      for (let x = -canvas.height; x < canvas.width + canvas.height; x += gap) {
        ctx.save(); ctx.translate(x, 0); ctx.rotate(-.35);
        ctx.fillRect(0, -200, gap * .32, canvas.height * 1.5); ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (state.backgroundId === 'grid') {
      ctx.fillStyle = '#f8f7f2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#d7d6cf'; ctx.lineWidth = Math.max(2, canvas.width / 540);
      const gap = canvas.width / 10;
      for (let x = 0; x <= canvas.width; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= canvas.height; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      return;
    }
    ctx.fillStyle = '#fff3e9'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff745f';
    const dotGap = canvas.width / 8;
    for (let y = dotGap / 2; y < canvas.height; y += dotGap) {
      for (let x = dotGap / 2; x < canvas.width; x += dotGap) {
        ctx.beginPath(); ctx.arc(x, y, dotGap * .16, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function layerDimensions(layer, image) {
    const width = canvas.width * (layer.width ?? layer.scale) / 100;
    const height = layer.height === undefined ? width * image.naturalHeight / image.naturalWidth : canvas.width * layer.height / 100;
    return { width, height };
  }

  function materializeLayerDimensions(layer, image = imageCache.get(layer.id)) {
    if (!image || (layer.width !== undefined && layer.height !== undefined)) return;
    layer.width = layer.scale;
    layer.height = layer.scale * image.naturalHeight / image.naturalWidth;
  }

  function setLayerScale(layer, value) {
    materializeLayerDimensions(layer);
    const ratio = value / layer.scale;
    layer.width *= ratio;
    layer.height *= ratio;
    layer.scale = value;
  }

  function drawLayer(layer) {
    const image = imageCache.get(layer.id);
    if (!image) return;
    const { width, height } = layerDimensions(layer, image);
    ctx.save();
    ctx.translate(canvas.width * layer.x / 100, canvas.height * layer.y / 100);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function drawLayerSelection(layer) {
    if (!layer) return;
    const image = imageCache.get(layer.id);
    if (!image) return;
    const { width, height } = layerDimensions(layer, image);
    ctx.save();
    ctx.translate(canvas.width * layer.x / 100, canvas.height * layer.y / 100);
    ctx.rotate(layer.rotation * Math.PI / 180);
    drawSelectionBox(-width / 2, -height / 2, width, height, resizeHandles(-width / 2, -height / 2, width, height));
    ctx.restore();
  }

  function graphemes(value) {
    if ('Segmenter' in Intl) return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)].map(part => part.segment);
    return Array.from(value);
  }

  function wrapTextParagraph(paragraph, maxWidth) {
    if (!paragraph) return [''];
    const lines = [];
    let line = '';
    graphemes(paragraph).forEach(character => {
      const candidate = line + character;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    });
    lines.push(line);
    return lines;
  }

  function textLayout(textLayer) {
    const responsiveSize = textLayer.fontSize * (canvas.width / 1080);
    const lineHeight = responsiveSize * 1.22;
    const padding = canvas.width / 90;
    const boxWidth = canvas.width * textLayer.boxWidth / 100;
    const contentWidth = Math.max(responsiveSize * .6, boxWidth - padding * 2);
    ctx.save();
    ctx.font = `800 ${responsiveSize}px 'Noto Sans KR', sans-serif`;
    const lines = textLayer.text.split('\n').flatMap(paragraph => wrapTextParagraph(paragraph, contentWidth));
    ctx.restore();
    const x = canvas.width * textLayer.x / 100;
    const centerY = canvas.height * textLayer.y / 100;
    const contentHeight = Math.max(lineHeight, lines.length * lineHeight) + padding * 2;
    const height = Math.max(contentHeight, canvas.height * textLayer.boxHeight / 100);
    const left = textLayer.textAlign === 'left' ? x : textLayer.textAlign === 'right' ? x - boxWidth : x - boxWidth / 2;
    const drawX = textLayer.textAlign === 'left' ? left + padding : textLayer.textAlign === 'right' ? left + boxWidth - padding : left + boxWidth / 2;
    return { responsiveSize, lineHeight, padding, boxWidth, contentWidth, contentHeight, lines, x, centerY, height, left, drawX, top: centerY - height / 2 };
  }

  function resizeHandles(left, top, width, height, size = Math.max(10, canvas.width / 90)) {
    const right = left + width;
    const bottom = top + height;
    const centerX = left + width / 2;
    return [
      { direction: 'nw', x: left, y: top, size },
      { direction: 'n', x: centerX, y: top, size },
      { direction: 'ne', x: right, y: top, size },
      { direction: 'e', x: right, y: top + height / 2, size },
      { direction: 'se', x: right, y: bottom, size },
      { direction: 's', x: centerX, y: bottom, size },
      { direction: 'sw', x: left, y: bottom, size },
      { direction: 'w', x: left, y: top + height / 2, size }
    ];
  }

  function textResizeHandles(layout) {
    return resizeHandles(layout.left, layout.top, layout.boxWidth, layout.height);
  }

  function drawTextLayer(textLayer) {
    if (!textLayer.text) return;
    const layout = textLayout(textLayer);
    const { responsiveSize, lineHeight, lines, drawX, centerY } = layout;
    ctx.save();
    ctx.font = `800 ${responsiveSize}px 'Noto Sans KR', sans-serif`;
    ctx.textAlign = textLayer.textAlign; ctx.textBaseline = 'middle';
    ctx.fillStyle = textLayer.textColor; ctx.strokeStyle = 'rgba(0,0,0,.42)';
    ctx.lineWidth = Math.max(3, responsiveSize * .075); ctx.lineJoin = 'round';
    lines.forEach((line, index) => {
      const y = centerY + (index - (lines.length - 1) / 2) * lineHeight;
      ctx.strokeText(line, drawX, y); ctx.fillText(line, drawX, y);
    });
    ctx.restore();
  }

  function drawTextSelection(textLayer) {
    if (!textLayer) return;
    const layout = textLayout(textLayer);
    ctx.save();
    drawSelectionBox(layout.left, layout.top, layout.boxWidth, layout.height, textResizeHandles(layout));
    ctx.restore();
  }

  function drawSelectionBox(left, top, width, height, handles) {
    ctx.strokeStyle = '#c8f135';
    ctx.lineWidth = Math.max(3, canvas.width / 270);
    ctx.setLineDash([canvas.width / 70, canvas.width / 110]);
    ctx.strokeRect(left, top, width, height);
    ctx.setLineDash([]);
    handles.forEach(handle => {
      ctx.fillStyle = '#c8f135';
      ctx.fillRect(handle.x - handle.size / 2, handle.y - handle.size / 2, handle.size, handle.size);
      ctx.strokeStyle = '#171815';
      ctx.lineWidth = Math.max(2, canvas.width / 540);
      ctx.strokeRect(handle.x - handle.size / 2, handle.y - handle.size / 2, handle.size, handle.size);
    });
  }

  function syncCanvasTextEditor() {
    const editorBox = $('#canvasTextEditorBox');
    const editor = $('#canvasTextEditor');
    const text = state.texts.find(layer => layer.id === editingTextId);
    if (!text) { editorBox.hidden = true; return; }
    const layout = textLayout(text);
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = $('#canvasWrap').getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return;
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const horizontalPadding = layout.padding * scaleX;
    const lineHeight = layout.lineHeight * scaleY;
    const textHeight = Math.max(lineHeight, layout.lines.length * lineHeight);
    const editorHeight = layout.height * scaleY;
    const verticalPadding = Math.max(layout.padding * scaleY, (editorHeight - textHeight) / 2);
    Object.assign(editorBox.style, {
      left: `${canvasRect.left - wrapRect.left + layout.left * scaleX}px`,
      top: `${canvasRect.top - wrapRect.top + layout.top * scaleY}px`,
      width: `${layout.boxWidth * scaleX}px`,
      height: `${editorHeight}px`
    });
    Object.assign(editor.style, {
      padding: `${verticalPadding}px ${horizontalPadding}px`,
      fontSize: `${layout.responsiveSize * scaleX}px`,
      lineHeight: `${lineHeight}px`,
      textAlign: text.textAlign,
      color: 'transparent',
      caretColor: text.textColor
    });
    editorBox.hidden = false;
  }

  function startInlineTextEditing(id, historyAlreadySaved = false) {
    const text = state.texts.find(layer => layer.id === id);
    if (!text) return;
    editingTextId = id; selectedTextId = id; selectedElement = 'text'; textToolActive = false;
    inlineEditHistorySaved = historyAlreadySaved;
    const editor = $('#canvasTextEditor');
    editor.value = text.text;
    syncControls(); renderLayers(); renderCanvas();
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
  }

  function finishInlineTextEditing(event) {
    if (!editingTextId) return;
    const id = editingTextId;
    editingTextId = null;
    inlineResizeState = null;
    $('#canvasTextEditorBox').hidden = true;
    const text = state.texts.find(layer => layer.id === id);
    if (text && !text.text) {
      selectedTextId = id;
      deleteSelectedText(false);
    }
    selectedElement = text?.text && event?.relatedTarget?.closest('.controls-panel') ? 'text' : null;
    syncControls(); renderLayers(); renderCanvas();
  }

  function activateTextTool() {
    if (editingTextId) $('#canvasTextEditor').blur();
    textToolActive = !textToolActive;
    selectedElement = null;
    syncControls(); renderLayers(); renderCanvas(); setResizeCursor();
  }

  function createTextAt(point) {
    recordHistory();
    const number = state.texts.length + 1;
    const x = Math.max(5, Math.min(80, point.x / canvas.width * 100));
    const boxHeight = DEFAULT_TEXT.boxHeight;
    const text = {
      ...DEFAULT_TEXT, id: makeId(), name: `문구 ${number}`, text: '', textAlign: 'left', x,
      y: Math.max(5, Math.min(95, point.y / canvas.height * 100 + boxHeight / 2)),
      boxWidth: Math.max(15, Math.min(40, 95 - x)), boxHeight
    };
    state.texts.push(text);
    startInlineTextEditing(text.id, true);
  }

  function renderCanvas(showGuides = true) {
    const hasText = activeTab === 'text' && selectedElement === 'text' && Boolean(selectedText());
    const hasImage = activeTab === 'image' && selectedElement === 'image' && Boolean(selectedLayer());
    $('#textControls').hidden = !hasText;
    $('#layerControls').hidden = !hasImage;
    $('#inspectorEmpty').hidden = hasText || hasImage;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    orderedElements().forEach(({ type, layer }) => type === 'image' ? drawLayer(layer) : drawTextLayer(layer));
    if (showGuides && selectedElement === 'image') drawLayerSelection(selectedLayer());
    if (showGuides && selectedElement === 'text') drawTextSelection(selectedText());
    syncCanvasTextEditor();
  }

  function renderBackgroundOptions() {
    const grid = $('#backgroundGrid');
    grid.innerHTML = BACKGROUNDS.map(background => `<button class="background-option" type="button" role="radio" data-background-id="${background.id}">
      <span class="background-swatch" aria-hidden="true"></span>
      <strong>${background.name}</strong><small>${background.mood}</small>
    </button>`).join('');
    grid.querySelectorAll('.background-option').forEach(button => {
      const background = BACKGROUNDS.find(item => item.id === button.dataset.backgroundId);
      const swatch = button.querySelector('.background-swatch');
      swatch.style.background = background.preview;
      if (background.id === 'transparent') {
        swatch.style.backgroundColor = '#f8f7f2';
        swatch.style.backgroundSize = '14px 14px';
        swatch.style.backgroundPosition = '0 0, 0 7px, 7px -7px, -7px 0';
      }
      if (background.id === 'grid') swatch.style.backgroundSize = '14px 14px';
      if (background.id === 'dots') swatch.style.backgroundSize = '18px 18px';
    });
    syncBackgroundOptions();
  }

  function syncBackgroundOptions() {
    $$('.background-option').forEach(button => {
      const active = button.dataset.backgroundId === state.backgroundId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
  }

  function selectBackground(id) {
    if (!BACKGROUNDS.some(background => background.id === id) || state.backgroundId === id) {
      $('#backgroundDialog').close();
      return;
    }
    recordHistory();
    state.backgroundId = id;
    syncBackgroundOptions();
    renderCanvas();
    $('#backgroundDialog').close();
    showToast(`${BACKGROUNDS.find(background => background.id === id).name} 배경을 적용했습니다.`);
  }

  function loadImageElement(dataUrl) {
    const image = new Image();
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl;
    });
  }

  async function sanitizeImageFile(file) {
    const originalDataUrl = await readAsDataURL(file);
    const decodedImage = await loadImageElement(originalDataUrl);
    const sanitizer = document.createElement('canvas');
    sanitizer.width = decodedImage.naturalWidth;
    sanitizer.height = decodedImage.naturalHeight;
    const sanitizerContext = sanitizer.getContext('2d');
    if (!sanitizerContext) throw new Error('이미지 처리 도구를 사용할 수 없습니다.');
    sanitizerContext.imageSmoothingEnabled = true;
    sanitizerContext.imageSmoothingQuality = 'high';
    sanitizerContext.drawImage(decodedImage, 0, 0, sanitizer.width, sanitizer.height);

    const sanitizedBlob = await new Promise((resolve, reject) => {
      sanitizer.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('이미지를 다시 인코딩하지 못했습니다.')),
        file.type,
        file.type === 'image/jpeg' ? .94 : undefined
      );
    });
    const dataUrl = await readAsDataURL(sanitizedBlob);
    const image = await loadImageElement(dataUrl);
    sanitizer.width = 1;
    sanitizer.height = 1;
    return { dataUrl, image };
  }

  async function hydrateImages(layers) {
    const nextCache = new Map();
    await Promise.all(layers.map(async layer => nextCache.set(layer.id, await loadImageElement(layer.dataUrl))));
    imageCache = nextCache;
  }

  async function handleImageFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const beforeAdd = snapshot();
    const message = $('#fileMessage');
    const validTypes = ['image/png', 'image/jpeg'];
    const additions = [];
    const rejected = [];
    for (const file of files) {
      if (!validTypes.includes(file.type)) { rejected.push(`${file.name}: PNG 또는 JPEG 파일이 아님`); continue; }
      if (file.size > MAX_FILE_SIZE) { rejected.push(`${file.name}: 15MB 초과`); continue; }
      try {
        const { dataUrl, image } = await sanitizeImageFile(file);
        const id = makeId();
        const offset = Math.min(state.images.length + additions.length, 4) * 3;
        const coverScale = Math.min(240, Math.max(100, (canvas.height / canvas.width) * (image.naturalWidth / image.naturalHeight) * 100));
        const layer = {
          id, name: file.name, dataUrl, x: 50 + offset, y: 50 + offset,
          scale: state.images.length + additions.length === 0 ? coverScale : 58,
          rotation: 0, flipX: false, flipY: false
        };
        layer.width = layer.scale;
        layer.height = layer.scale * image.naturalHeight / image.naturalWidth;
        additions.push(layer); imageCache.set(id, image);
      } catch (_) { rejected.push(`${file.name}: 손상되었거나 읽을 수 없습니다`); }
    }
    if (additions.length) {
      recordHistory(beforeAdd);
      state.images.push(...additions);
      selectedLayerId = additions.at(-1).id;
      selectedElement = 'image';
      renderLayers(); syncLayerControls(); renderCanvas(); switchTab(selectedElement || activeTab);
    }
    if (additions.length && !rejected.length) setMessage(message, `${additions.length}개 이미지의 메타데이터를 제거하고 추가했습니다.`, 'success');
    else if (additions.length) setMessage(message, `${additions.length}개 추가, ${rejected.length}개 거부: ${rejected.join(' · ')}`, 'error');
    else setMessage(message, `${rejected.join(' · ')}. 기존 작업은 그대로 유지됐습니다.`, 'error');
    $('#imageInput').value = '';
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  }

  function renderLayers() {
    const list = $('#layerList');
    const allItems = orderedElements().reverse();
    const items = allItems.filter(({ type }) => type === activeTab);
    $('#layerCount').textContent = items.length;
    if (!items.length) {
      const label = activeTab === 'image' ? '이미지' : '텍스트';
      list.innerHTML = `<div class="layer-empty">추가된 ${label}가 없어요.<br>위의 추가 버튼을 눌러주세요.</div>`;
      syncLayerControls(); return;
    }
    list.innerHTML = items.map(({ type, layer }) => {
      const isText = type === 'text';
      const label = isText ? (layer.text.split('\n')[0].trim() || layer.name) : layer.name;
      const active = selectedElement === type && layer.id === (isText ? selectedTextId : selectedLayerId);
      return `<article draggable="true" class="layer-item ${active ? 'active' : ''}" data-layer-id="${escapeHtml(layer.id)}" data-element-type="${type}">
        <button class="layer-select" type="button" data-layer-action="select" aria-pressed="${active}">
          ${isText ? '<span class="layer-thumb text-thumb" aria-hidden="true">T</span>' : `<img draggable="false" class="layer-thumb" src="${layer.dataUrl}" alt="">`}
          <span class="layer-copy"><strong>${escapeHtml(label)}</strong><small>${isText ? '문구' : '이미지'} · 드래그로 순서 변경</small></span>
        </button>
        <span class="layer-order">
          <button type="button" data-layer-action="up" aria-label="앞으로 가져오기" ${allItems[0].layer.id === layer.id ? 'disabled' : ''}>↑</button>
          <button type="button" data-layer-action="down" aria-label="뒤로 보내기" ${allItems[allItems.length - 1].layer.id === layer.id ? 'disabled' : ''}>↓</button>
        </span></article>`;
    }).join('');
    syncLayerControls();
  }

  function selectText(id) {
    if (!state.texts.some(layer => layer.id === id)) return;
    selectedTextId = id; selectedElement = 'text';
    switchTab(selectedElement || activeTab); syncControls(); renderLayers(); renderCanvas();
  }

  function moveText(id, direction) {
    moveElement(id, 'text', direction);
  }

  function selectLayer(id) {
    if (!state.images.some(layer => layer.id === id)) return;
    selectedLayerId = id;
    selectedElement = 'image';
    if (activeTab !== 'image') switchTab(selectedElement || activeTab);
    renderLayers(); renderCanvas();
  }

  function moveLayer(id, direction) {
    moveElement(id, 'image', direction);
  }

  function deleteSelectedLayer(confirmDelete = true, saveHistory = true) {
    const layer = selectedLayer();
    if (!layer || (confirmDelete && !confirm(`“${layer.name}” 이미지를 삭제할까요?`))) return;
    if (saveHistory) recordHistory();
    const index = state.images.findIndex(item => item.id === layer.id);
    state.images.splice(index, 1); imageCache.delete(layer.id);
    selectedLayerId = state.images[Math.min(index, state.images.length - 1)]?.id || null;
    renderLayers(); renderCanvas(); showToast('이미지 항목을 삭제했습니다.');
  }

  function updateSelectedLayer(key, value, saveHistory = true) {
    const layer = selectedLayer();
    if (!layer) return;
    if (saveHistory && layer[key] !== value) recordHistory();
    if (key === 'scale') setLayerScale(layer, value); else layer[key] = value;
    syncLayerControls(); renderLayers(); renderCanvas();
  }

  function updateSelectedText(key, value, saveHistory = true) {
    const text = selectedText();
    if (!text) return;
    if (saveHistory && text[key] !== value) recordHistory();
    text[key] = value; syncControls(); renderLayers(); renderCanvas();
  }

  function deleteSelectedText(saveHistory = true) {
    const text = selectedText();
    if (!text) return;
    if (saveHistory) recordHistory();
    const index = state.texts.findIndex(item => item.id === text.id);
    state.texts.splice(index, 1);
    selectedTextId = state.texts[Math.min(index, state.texts.length - 1)]?.id || null;
    selectedElement = selectedTextId ? 'text' : null;
    syncControls(); renderLayers(); renderCanvas();
  }

  function copySelected(showFeedback = true) {
    if (selectedElement === 'image') {
      const layer = selectedLayer();
      if (!layer) return false;
      elementClipboard = { type: 'image', layer: { ...layer }, image: imageCache.get(layer.id) };
      if (showFeedback) showToast('이미지를 복사했습니다.');
      return true;
    }
    if (selectedElement !== 'text') return false;
    const text = selectedText();
    if (!text) return false;
    elementClipboard = { type: 'text', layer: { ...text } };
    if (showFeedback) showToast('문구를 복사했습니다.');
    return true;
  }

  function cutSelected() {
    if (!copySelected(false)) return;
    recordHistory();
    if (selectedElement === 'image') {
      deleteSelectedLayer(false, false);
      showToast('이미지를 잘라냈습니다.');
    } else {
      deleteSelectedText(false);
      showToast('문구를 잘라냈습니다.');
    }
  }

  async function pasteSelected() {
    if (!elementClipboard) { showToast('복사한 항목이 없습니다.'); return; }
    recordHistory();
    if (elementClipboard.type === 'image') {
      const source = elementClipboard.layer;
      const id = makeId();
      const layer = { ...source, id, name: `${source.name} 복사본`, x: Math.min(120, source.x + 3), y: Math.min(120, source.y + 3) };
      let image = elementClipboard.image;
      if (!image) image = await loadImageElement(layer.dataUrl);
      state.images.push(layer);
      imageCache.set(id, image);
      selectedLayerId = id;
      selectedElement = 'image';
      switchTab(selectedElement || activeTab);
      renderLayers(); renderCanvas();
      showToast('이미지를 붙여넣었습니다.');
    } else {
      const source = elementClipboard.layer;
      const layer = { ...source, id: makeId(), name: `${source.name} 복사본`, x: Math.min(95, source.x + 3), y: Math.min(95, source.y + 3) };
      state.texts.push(layer); selectedTextId = layer.id; selectedElement = 'text';
      switchTab(selectedElement || activeTab);
      syncControls(); renderLayers(); renderCanvas();
      showToast('문구를 붙여넣었습니다.');
    }
  }

  function deleteSelectedElement() {
    if (selectedElement === 'image') {
      if (selectedLayer()) deleteSelectedLayer(false, true);
      return;
    }
    if (selectedElement !== 'text') return;
    if (!selectedText()) return;
    deleteSelectedText(true);
    showToast('문구를 삭제했습니다. Ctrl+Z로 복구할 수 있어요.');
  }

  function setMessage(element, text, type = '') {
    if (element.id === 'templateMessage' && type === 'success') {
      element.textContent = ''; element.className = 'status-message'; showToast(text); return;
    }
    element.textContent = text; element.className = `status-message ${type}`;
  }

  function showToast(text) {
    const toast = $('#toast'); toast.textContent = text; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function download(filename, href) {
    const anchor = document.createElement('a'); anchor.download = filename; anchor.href = href; anchor.click();
  }

  function downloadImage(type) {
    renderCanvas(false);
    const extension = type === 'image/png' ? 'png' : 'jpg';
    const firstText = state.texts.find(layer => layer.text.trim())?.text.split('\n')[0] || 'mixit';
    const safeName = firstText.replace(/[\\/:*?"<>|]/g, '').trim() || 'mixit';
    const dataUrl = canvas.toDataURL(type, .92);
    renderCanvas();
    download(`${safeName}-${state.ratio.replace(':', 'x')}.${extension}`, dataUrl);
    showToast(`${extension.toUpperCase()} 파일을 저장했습니다.`);
  }

  function renderTemplates() {
    const list = $('#templateList'); $('#templateCount').textContent = templates.length;
    if (!templates.length) {
      list.innerHTML = '<div class="template-empty">아직 저장된 템플릿이 없어요<br>첫 템플릿을 만들어보세요</div>'; return;
    }
    list.innerHTML = templates.map(item => `<article class="template-item" data-id="${escapeHtml(item.id)}">
      ${item.thumbnail ? `<img class="template-thumbnail" src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.name)} 미리보기">` : ''}
      <div><strong>${escapeHtml(item.name)}</strong><small>${item.ratio} · 이미지 ${item.images.length}개 · 문구 ${item.texts.length}개</small></div>
      <div class="template-actions"><button type="button" data-action="load">불러오기</button><button type="button" data-action="update" title="현재 작업으로 템플릿 업데이트">업데이트</button><button type="button" class="delete" data-action="delete" aria-label="${escapeHtml(item.name)} 삭제"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div>
    </article>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  async function loadTemplate(rawItem) {
    const item = normalizeTemplate(rawItem);
    if (!item) return;
    try { await hydrateImages(item.images); }
    catch (_) { setMessage($('#templateMessage'), '템플릿의 이미지 중 읽을 수 없는 항목이 있어 불러오지 않았습니다.', 'error'); return; }
    recordHistory();
    state = { ...DEFAULT_STATE, ...item, images: item.images.map(layer => ({ ...layer })), texts: item.texts.map(layer => ({ ...layer })) };
    selectedLayerId = state.images.at(-1)?.id || null;
    selectedTextId = state.texts.at(-1)?.id || null;
    selectedElement = null; editingTextId = null; textToolActive = false;
    $('#templateName').value = item.name;
    syncControls(); renderLayers(); setCanvasRatio();
    setMessage($('#templateMessage'), `“${item.name}” 템플릿을 불러왔습니다.`, 'success');
  }

  async function saveTemplate(event) {
    event.preventDefault();
    const name = $('#templateName').value.trim();
    if (!name) return;
    try {
      const item = currentTemplate(name); await persistTemplates([item, ...templates]); renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 저장했습니다.`, 'success');
    } catch (_) { setMessage($('#templateMessage'), '저장 공간이 부족해 템플릿을 저장하지 못했습니다. 큰 이미지를 줄인 뒤 다시 시도해주세요.', 'error'); }
  }

  async function updateTemplate(id) {
    const current = templates.find(item => item.id === id); if (!current) return;
    const name = $('#templateName').value.trim() || current.name;
    try {
      await persistTemplates(templates.map(item => item.id === id ? currentTemplate(name, id, current.createdAt) : item));
      $('#templateName').value = name; renderTemplates();
      setMessage($('#templateMessage'), `“${name}” 템플릿을 수정했습니다.`, 'success');
    } catch (_) { setMessage($('#templateMessage'), '저장 공간이 부족해 수정하지 못했습니다. 기존 템플릿은 유지됩니다.', 'error'); }
  }

  async function deleteTemplate(id) {
    const item = templates.find(template => template.id === id);
    if (!item || !confirm(`“${item.name}” 템플릿을 삭제할까요?`)) return;
    try {
      await persistTemplates(templates.filter(template => template.id !== id)); renderTemplates();
      setMessage($('#templateMessage'), '템플릿을 삭제했습니다.', 'success');
    } catch (_) { setMessage($('#templateMessage'), '템플릿을 삭제하지 못했습니다.', 'error'); }
  }

  function exportJson() {
    const payload = { format: 'mixit-templates', version: 2, exportedAt: new Date().toISOString(), templates };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    download(`mixit-templates-${new Date().toISOString().slice(0, 10)}.json`, blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setMessage($('#jsonMessage'), `${templates.length}개 템플릿을 내보냈습니다.`, 'success');
  }

  async function importJson(file) {
    const message = $('#jsonMessage');
    if (!file) return;
    if (!(file.type === 'application/json' || file.name.toLowerCase().endsWith('.json'))) {
      setMessage(message, 'JSON 파일만 가져올 수 있어요. 기존 템플릿은 유지됩니다.', 'error'); return;
    }
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (_) {
      setMessage(message, 'JSON 문법이 손상되어 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error');
      $('#jsonInput').value = ''; return;
    }
    const validEnvelope = parsed && parsed.format === 'mixit-templates' && [1, 2].includes(parsed.version) && Array.isArray(parsed.templates);
    const normalized = validEnvelope ? parsed.templates.map(normalizeTemplate) : [];
    if (!validEnvelope || normalized.some(item => !item)) {
      setMessage(message, '필수 항목이 없거나 형식이 올바르지 않아 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error');
      $('#jsonInput').value = ''; return;
    }
    try {
      await persistTemplates(normalized); renderTemplates();
      setMessage(message, `${templates.length}개 템플릿을 복원했습니다.`, 'success');
    } catch (_) { setMessage(message, '저장 공간이 부족해 복원하지 않았습니다. 기존 템플릿은 유지됩니다.', 'error'); }
    $('#jsonInput').value = '';
  }

  function resetWork() {
    recordHistory();
    state = { ...DEFAULT_STATE, images: [], texts: [{ ...DEFAULT_TEXT }] }; imageCache = new Map(); selectedLayerId = null; selectedTextId = DEFAULT_TEXT.id;
    selectedElement = null; editingTextId = null; textToolActive = false; inlineResizeState = null; $('#canvasTextEditorBox').hidden = true;
    $('#templateName').value = ''; setMessage($('#fileMessage'), ''); setMessage($('#templateMessage'), '');
    syncControls(); renderLayers(); setCanvasRatio(); switchTab('image'); selectedElement = null; renderCanvas(); showToast('새 작업을 시작합니다.');
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * canvas.width, y: (event.clientY - rect.top) / rect.height * canvas.height };
  }

  function hitTestLayer(point) {
    return [...state.images].reverse().find(layer => {
      const image = imageCache.get(layer.id); if (!image) return false;
      const { width, height } = layerDimensions(layer, image);
      const local = layerLocalPoint(point, layer);
      return Math.abs(local.x) <= width / 2 && Math.abs(local.y) <= height / 2;
    }) || null;
  }

  function layerLocalPoint(point, layer) {
    const dx = point.x - canvas.width * layer.x / 100;
    const dy = point.y - canvas.height * layer.y / 100;
    const angle = -layer.rotation * Math.PI / 180;
    return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
  }

  function hitTestImageResizeHandle(point) {
    const layer = selectedElement === 'image' ? selectedLayer() : null;
    const image = layer && imageCache.get(layer.id);
    if (!image) return null;
    const { width, height } = layerDimensions(layer, image);
    const local = layerLocalPoint(point, layer);
    return resizeHandles(-width / 2, -height / 2, width, height).find(handle => {
      const hitSize = handle.size * 1.6;
      return Math.abs(local.x - handle.x) <= hitSize / 2 && Math.abs(local.y - handle.y) <= hitSize / 2;
    }) || null;
  }

  function hitTestText(point) {
    return [...state.texts].reverse().find(text => {
      if (!text.text) return false;
      const layout = textLayout(text);
      return point.x >= layout.left && point.x <= layout.left + layout.boxWidth
        && point.y >= layout.top && point.y <= layout.top + layout.height;
    }) || null;
  }

  function hitTestTextResizeHandle(point) {
    const text = selectedElement === 'text' ? selectedText() : null;
    if (!text?.text) return null;
    return textResizeHandles(textLayout(text)).find(handle => {
      const hitSize = handle.size * 1.5;
      return Math.abs(point.x - handle.x) <= hitSize / 2 && Math.abs(point.y - handle.y) <= hitSize / 2;
    }) || null;
  }

  function setResizeCursor(direction = '', canMove = false) {
    const cursors = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
    canvas.style.cursor = cursors[direction] || (textToolActive ? 'text' : canMove ? (dragState ? 'grabbing' : 'grab') : 'default');
  }

  function resizeTextBox(text, direction, bounds, point) {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const minWidth = canvas.width * .15;
    const maxWidth = canvas.width * .9;
    const maxHeight = canvas.height * .95;
    let { left, right, top, bottom } = bounds;
    if (direction.includes('w')) left = clamp(point.x, right - maxWidth, right - minWidth);
    if (direction.includes('e')) right = clamp(point.x, left + minWidth, left + maxWidth);
    if (direction.includes('n')) top = clamp(point.y, bottom - maxHeight, bottom - bounds.minHeight);
    if (direction.includes('s')) bottom = clamp(point.y, top + bounds.minHeight, top + maxHeight);
    text.boxWidth = (right - left) / canvas.width * 100;
    text.boxHeight = (bottom - top) / canvas.height * 100;
    text.y = clamp((top + bottom) / 2 / canvas.height * 100, 5, 95);
    const anchorX = text.textAlign === 'left' ? left : text.textAlign === 'right' ? right : (left + right) / 2;
    text.x = clamp(anchorX / canvas.width * 100, 5, 95);
  }

  function beginInlineTextResize(event) {
    const handle = event.target.closest('[data-editor-resize]');
    const text = state.texts.find(layer => layer.id === editingTextId);
    if (!handle || !text) return;
    event.preventDefault();
    event.stopPropagation();
    const layout = textLayout(text);
    if (!inlineEditHistorySaved) { recordHistory(); inlineEditHistorySaved = true; }
    inlineResizeState = {
      pointerId: event.pointerId,
      direction: handle.dataset.editorResize,
      left: layout.left,
      right: layout.left + layout.boxWidth,
      top: layout.top,
      bottom: layout.top + layout.height,
      minHeight: Math.min(canvas.height * .95, layout.contentHeight)
    };
    handle.setPointerCapture?.(event.pointerId);
  }

  function moveInlineTextResize(event) {
    if (!inlineResizeState || event.pointerId !== inlineResizeState.pointerId) return;
    event.preventDefault();
    const text = state.texts.find(layer => layer.id === editingTextId);
    if (!text) return;
    resizeTextBox(text, inlineResizeState.direction, inlineResizeState, pointerPosition(event));
    syncControls(); renderLayers(); renderCanvas();
  }

  function endInlineTextResize(event) {
    if (!inlineResizeState || event.pointerId !== inlineResizeState.pointerId) return;
    event.preventDefault();
    inlineResizeState = null;
    $('#canvasTextEditor').focus({ preventScroll: true });
  }

  function beginCanvasDrag(event) {
    const point = pointerPosition(event);
    if (textToolActive) { createTextAt(point); return; }
    const beforeMove = snapshot();
    const textResizeHandle = hitTestTextResizeHandle(point);
    const imageResizeHandle = hitTestImageResizeHandle(point);
    if (textResizeHandle) {
      const text = selectedText();
      const layout = textLayout(text);
      dragState = {
        type: 'text-resize', direction: textResizeHandle.direction, beforeMove, historySaved: false,
        left: layout.left, right: layout.left + layout.boxWidth, top: layout.top, bottom: layout.top + layout.height,
        minHeight: Math.min(canvas.height * .95, layout.contentHeight)
      };
    } else if (imageResizeHandle) {
      const layer = selectedLayer();
      const image = imageCache.get(layer.id);
      materializeLayerDimensions(layer, image);
      const { width, height } = layerDimensions(layer, image);
      dragState = {
        type: 'image-resize', direction: imageResizeHandle.direction, beforeMove, historySaved: false,
        centerX: canvas.width * layer.x / 100, centerY: canvas.height * layer.y / 100,
        rotation: layer.rotation * Math.PI / 180, left: -width / 2, right: width / 2, top: -height / 2, bottom: height / 2
      };
    } else {
      const topHit = orderedElements().reverse().find(({ type, layer }) => {
        if (type === 'text') {
          if (!layer.text) return false;
          const box = textLayout(layer);
          return point.x >= box.left && point.x <= box.left + box.boxWidth && point.y >= box.top && point.y <= box.top + box.height;
        }
        const image = imageCache.get(layer.id);
        if (!image) return false;
        const size = layerDimensions(layer, image), local = layerLocalPoint(point, layer);
        return Math.abs(local.x) <= size.width / 2 && Math.abs(local.y) <= size.height / 2;
      });
      const textHit = topHit?.type === 'text' ? topHit.layer : null;
      if (textHit) {
        const editOnClick = selectedElement === 'text' && selectedTextId === textHit.id;
        selectText(textHit.id);
        dragState = { type: 'text', startX: point.x, startY: point.y, textX: textHit.x, textY: textHit.y, beforeMove, historySaved: false, editOnClick };
      } else {
        const imageHit = topHit?.type === 'image' ? topHit.layer : null;
        if (!imageHit) {
          selectedElement = null; renderLayers(); renderCanvas(); setResizeCursor(); return;
        }
        selectLayer(imageHit.id);
        dragState = { type: 'layer', startX: point.x, startY: point.y, layerX: imageHit.x, layerY: imageHit.y, beforeMove, historySaved: false };
      }
    }
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); $('#dragTip').classList.add('hidden');
    setResizeCursor(dragState.type.endsWith('resize') ? dragState.direction : '', ['text', 'layer'].includes(dragState.type));
    canvas.focus({ preventScroll: true });
  }

  function moveCanvasDrag(event) {
    const point = pointerPosition(event);
    if (!dragState) {
      const resizeHandle = hitTestTextResizeHandle(point) || hitTestImageResizeHandle(point);
      const canMove = Boolean(hitTestText(point) || hitTestLayer(point));
      setResizeCursor(resizeHandle?.direction, canMove);
      return;
    }
    if ((dragState.type === 'text' || dragState.type === 'layer') && !dragState.historySaved
      && Math.hypot(point.x - dragState.startX, point.y - dragState.startY) < canvas.width / 270) return;
    if (!dragState.historySaved) {
      recordHistory(dragState.beforeMove);
      dragState.historySaved = true;
    }
    if (dragState.type === 'text-resize') {
      const text = selectedText(); if (!text) return;
      resizeTextBox(text, dragState.direction, dragState, point);
    } else if (dragState.type === 'image-resize') {
      const layer = selectedLayer(); if (!layer) return;
      const dx = point.x - dragState.centerX;
      const dy = point.y - dragState.centerY;
      const localX = dx * Math.cos(-dragState.rotation) - dy * Math.sin(-dragState.rotation);
      const localY = dx * Math.sin(-dragState.rotation) + dy * Math.cos(-dragState.rotation);
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      let { left, right, top, bottom } = dragState;
      if (dragState.direction.includes('w')) left = clamp(localX, right - canvas.width * 2.4, right - canvas.width * .1);
      if (dragState.direction.includes('e')) right = clamp(localX, left + canvas.width * .1, left + canvas.width * 2.4);
      if (dragState.direction.includes('n')) top = clamp(localY, bottom - canvas.width * 10, bottom - canvas.width * .03);
      if (dragState.direction.includes('s')) bottom = clamp(localY, top + canvas.width * .03, top + canvas.width * 10);
      const localCenterX = (left + right) / 2;
      const localCenterY = (top + bottom) / 2;
      const worldOffsetX = localCenterX * Math.cos(dragState.rotation) - localCenterY * Math.sin(dragState.rotation);
      const worldOffsetY = localCenterX * Math.sin(dragState.rotation) + localCenterY * Math.cos(dragState.rotation);
      layer.x = clamp((dragState.centerX + worldOffsetX) / canvas.width * 100, -20, 120);
      layer.y = clamp((dragState.centerY + worldOffsetY) / canvas.height * 100, -20, 120);
      layer.width = (right - left) / canvas.width * 100;
      layer.height = (bottom - top) / canvas.width * 100;
      layer.scale = layer.width;
    } else if (dragState.type === 'text') {
      const text = selectedText(); if (!text) return;
      text.x = Math.max(5, Math.min(95, dragState.textX + (point.x - dragState.startX) / canvas.width * 100));
      text.y = Math.max(5, Math.min(95, dragState.textY + (point.y - dragState.startY) / canvas.height * 100));
    } else {
      const layer = selectedLayer(); if (!layer) return;
      layer.x = Math.max(-20, Math.min(120, dragState.layerX + (point.x - dragState.startX) / canvas.width * 100));
      layer.y = Math.max(-20, Math.min(120, dragState.layerY + (point.y - dragState.startY) / canvas.height * 100));
    }
    syncControls(); renderCanvas();
  }

  function endCanvasDrag() {
    const completedDrag = dragState;
    if (completedDrag) renderLayers();
    dragState = null; canvas.classList.remove('dragging'); setResizeCursor();
    if (completedDrag?.type === 'text' && !completedDrag.historySaved && completedDrag.editOnClick) startInlineTextEditing(selectedTextId);
  }

  function handleEditorShortcut(event) {
    if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (command && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (command && key === 'y') {
      event.preventDefault(); redo();
    } else if (command && key === 'c') {
      event.preventDefault(); copySelected();
    } else if (command && key === 'v') {
      event.preventDefault(); pasteSelected();
    } else if (command && key === 'x') {
      event.preventDefault(); cutSelected();
    } else if (event.key === 'Delete') {
      event.preventDefault(); deleteSelectedElement();
    }
  }

  function bindEvents() {
    $('#imageInput').addEventListener('change', event => handleImageFiles(event.target.files));
    const upload = $('#uploadZone');
    ['dragenter', 'dragover'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(name => upload.addEventListener(name, event => { event.preventDefault(); upload.classList.remove('dragover'); }));
    upload.addEventListener('drop', event => handleImageFiles(event.dataTransfer.files));
    $('#imageTabButton').addEventListener('click', () => switchTab('image'));
    $('#textTabButton').addEventListener('click', () => switchTab('text'));
    $('#textToolButton').addEventListener('click', activateTextTool);
    $('#canvasTextEditor').addEventListener('input', event => {
      const text = state.texts.find(layer => layer.id === editingTextId); if (!text) return;
      if (!inlineEditHistorySaved) { recordHistory(); inlineEditHistorySaved = true; }
      text.text = event.target.value; renderLayers(); renderCanvas();
    });
    $('#canvasTextEditor').addEventListener('blur', finishInlineTextEditing);
    $('#canvasTextEditor').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); } });
    const editorBox = $('#canvasTextEditorBox');
    editorBox.addEventListener('pointerdown', beginInlineTextResize);
    editorBox.addEventListener('pointermove', moveInlineTextResize);
    editorBox.addEventListener('pointerup', endInlineTextResize);
    editorBox.addEventListener('pointercancel', endInlineTextResize);
    $('#fontSize').addEventListener('input', event => updateSelectedText('fontSize', Math.max(16, Math.min(180, Number(event.target.value) || 16))));
    $('#textColor').addEventListener('input', event => updateSelectedText('textColor', event.target.value));
    [['textX', 'x'], ['textY', 'y']].forEach(([id, key]) => $(`#${id}`).addEventListener('input', event => updateSelectedText(key, Number(event.target.value))));
    $$('.align-button').forEach(button => button.addEventListener('click', () => updateSelectedText('textAlign', button.dataset.align)));
    $$('.ratio-button').forEach(button => button.addEventListener('click', () => { if (state.ratio !== button.dataset.ratio) recordHistory(); state.ratio = button.dataset.ratio; syncControls(); setCanvasRatio(); }));
    $('#backgroundButton').addEventListener('click', () => {
      const dialog = $('#backgroundDialog');
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('.background-option.active')?.focus();
    });
    $('#closeBackgroundDialog').addEventListener('click', () => $('#backgroundDialog').close());
    $('#backgroundDialog').addEventListener('click', event => { if (event.target === $('#backgroundDialog')) $('#backgroundDialog').close(); });
    $('#backgroundGrid').addEventListener('click', event => {
      const option = event.target.closest('[data-background-id]');
      if (option) selectBackground(option.dataset.backgroundId);
    });
    let draggedKey = null;
    const layerList = $('#layerList');
    const clearDrop = () => layerList.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    layerList.addEventListener('dragstart', event => {
      const row = event.target.closest('.layer-item');
      if (!row) return;
      draggedKey = row.dataset.elementType + ':' + row.dataset.layerId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedKey);
      row.classList.add('sorting');
    });
    layerList.addEventListener('dragover', event => {
      if (!draggedKey) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDrop();
      const row = event.target.closest('.layer-item');
      if (row) row.classList.add(event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'drop-before' : 'drop-after');
    });
    layerList.addEventListener('drop', event => {
      if (!draggedKey) return;
      event.preventDefault();
      const row = event.target.closest('.layer-item');
      if (row) {
        orderedElements();
        const display = [...state.layerOrder].reverse().filter(key => key !== draggedKey);
        const target = row.dataset.elementType + ':' + row.dataset.layerId;
        if (target !== draggedKey) {
          const index = display.indexOf(target) + (row.classList.contains('drop-after') ? 1 : 0);
          recordHistory();
          display.splice(index, 0, draggedKey);
          state.layerOrder = display.reverse();
          if (draggedKey.startsWith('text:')) selectText(draggedKey.slice(5));
          else selectLayer(draggedKey.slice(6));
        }
      }
      draggedKey = null; clearDrop(); renderLayers(); renderCanvas();
    });
    layerList.addEventListener('dragend', () => { draggedKey = null; clearDrop(); renderLayers(); });
    $('#layerList').addEventListener('click', event => {
      const button = event.target.closest('[data-layer-action]'); if (!button) return;
      const item = button.closest('.layer-item');
      const id = item.dataset.layerId;
      const isText = item.dataset.elementType === 'text';
      if (button.dataset.layerAction === 'select') isText ? selectText(id) : selectLayer(id);
      if (button.dataset.layerAction === 'up') isText ? moveText(id, 'up') : moveLayer(id, 'up');
      if (button.dataset.layerAction === 'down') isText ? moveText(id, 'down') : moveLayer(id, 'down');
    });
    $('#layerScale').addEventListener('input', event => updateSelectedLayer('scale', Number(event.target.value)));
    $('#layerRotation').addEventListener('input', event => updateSelectedLayer('rotation', Number(event.target.value)));
    $('#layerX').addEventListener('input', event => updateSelectedLayer('x', Number(event.target.value)));
    $('#layerY').addEventListener('input', event => updateSelectedLayer('y', Number(event.target.value)));
    $('#flipHorizontalButton').addEventListener('click', () => { const layer = selectedLayer(); if (layer) updateSelectedLayer('flipX', !layer.flipX); });
    $('#flipVerticalButton').addEventListener('click', () => { const layer = selectedLayer(); if (layer) updateSelectedLayer('flipY', !layer.flipY); });
    $('#deleteLayerButton').addEventListener('click', deleteSelectedLayer);
    $('#deleteTextButton').addEventListener('click', () => deleteSelectedText());
    $('#downloadPngButton').addEventListener('click', () => downloadImage('image/png'));
    $('#downloadJpegButton').addEventListener('click', () => downloadImage('image/jpeg'));
    $('#resetButton').addEventListener('click', resetWork);
    $('#templateForm').addEventListener('submit', saveTemplate);
    $('#templateList').addEventListener('click', event => {
      const button = event.target.closest('button[data-action]'); if (!button) return;
      const id = button.closest('.template-item').dataset.id;
      const item = templates.find(template => template.id === id);
      if (button.dataset.action === 'load') loadTemplate(item);
      if (button.dataset.action === 'update') updateTemplate(id);
      if (button.dataset.action === 'delete') deleteTemplate(id);
    });
    $('#exportJsonButton').addEventListener('click', exportJson);
    $('#jsonInput').addEventListener('change', event => importJson(event.target.files[0]));
    canvas.addEventListener('pointerdown', beginCanvasDrag);
    canvas.addEventListener('pointermove', moveCanvasDrag);
    canvas.addEventListener('pointerup', endCanvasDrag);
    canvas.addEventListener('pointercancel', endCanvasDrag);
    document.addEventListener('keydown', handleEditorShortcut);
    document.addEventListener('pointerdown', event => {
      if (event.target === canvas || event.target.closest?.('#canvasTextEditorBox, .controls-panel') || !selectedElement) return;
      selectedElement = null; setResizeCursor(); renderCanvas();
    });
    window.addEventListener('resize', syncCanvasTextEditor);
  }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: 'get_editor_state', title: '편집 상태 확인', description: '현재 비율, 문구, 이미지 항목과 선택 상태를 확인합니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({ ratio: state.ratio, backgroundId: state.backgroundId, textCount: state.texts.length, imageCount: state.images.length, selectedLayerId, selectedTextId, texts: state.texts.map(({ id, name, text, fontSize, textColor, x, y, textAlign, boxWidth, boxHeight }) => ({ id, name, text, fontSize, textColor, x, y, textAlign, boxWidth, boxHeight })), images: state.images.map(({ id, name, x, y, scale, width, height, rotation, flipX, flipY }) => ({ id, name, x, y, scale, width, height, rotation, flipX, flipY })), templateCount: templates.length })
      },
      {
        name: 'set_canvas_ratio', title: '캔버스 비율 변경', description: '캔버스 비율을 1:1, 4:5, 9:16 중 하나로 변경합니다.',
        inputSchema: { type: 'object', properties: { ratio: { type: 'string', enum: ['1:1', '4:5', '9:16'] } }, required: ['ratio'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: ({ ratio }) => { if (!RATIOS[ratio]) throw new Error('지원하지 않는 비율입니다.'); if (state.ratio !== ratio) recordHistory(); state.ratio = ratio; syncControls(); setCanvasRatio(); return { ratio, size: RATIOS[ratio] }; }
      },
      {
        name: 'set_card_background', title: '카드 배경 변경', description: '카드의 기본 배경을 제공되는 배경 중 하나로 변경합니다.',
        inputSchema: { type: 'object', properties: { backgroundId: { type: 'string', enum: BACKGROUNDS.map(background => background.id) } }, required: ['backgroundId'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: ({ backgroundId }) => { if (!BACKGROUNDS.some(background => background.id === backgroundId)) throw new Error('지원하지 않는 배경입니다.'); if (state.backgroundId !== backgroundId) recordHistory(); state.backgroundId = backgroundId; syncBackgroundOptions(); renderCanvas(); return { backgroundId }; }
      },
      {
        name: 'transform_image_layer', title: '이미지 항목 변형', description: '선택한 이미지 항목의 위치, 크기, 회전, 대칭을 변경합니다.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number', minimum: -20, maximum: 120 }, y: { type: 'number', minimum: -20, maximum: 120 }, scale: { type: 'number', minimum: 10, maximum: 240 }, rotation: { type: 'number', minimum: -180, maximum: 180 }, flipX: { type: 'boolean' }, flipY: { type: 'boolean' } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: input => {
          const layer = state.images.find(item => item.id === input.id); if (!layer) throw new Error('이미지 항목을 찾을 수 없습니다.');
          recordHistory();
          ['x', 'y', 'rotation', 'flipX', 'flipY'].forEach(key => { if (input[key] !== undefined) layer[key] = input[key]; });
          if (input.scale !== undefined) setLayerScale(layer, input.scale);
          selectedLayerId = layer.id; renderLayers(); renderCanvas(); return { updated: true, id: layer.id };
        }
      }
    ];
    tools.forEach(tool => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  async function init() {
    renderBackgroundOptions(); bindEvents(); syncControls(); setCanvasRatio(); switchTab(activeTab);
    templates = await loadTemplates(); renderTemplates(); registerWebMcp();
    if (document.fonts?.ready) document.fonts.ready.then(renderCanvas);
  }

  init();
})();
