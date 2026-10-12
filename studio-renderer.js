import { evaluateScene, sampleField } from './optics.js';
import {calculateDifferenceField} from './field-difference.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** One transform drives table drawing, pointer hit testing and dragging. */
export function createStudioRenderer(canvas, callbacks = {}) {
  const context = canvas.getContext('2d');
  let state = null, transform = null, hits = [], frame = 0, drag = null, disposed = false;
  const listeners = [];
  const artwork = {}, assetListeners = [];
  for (const [name, file] of [['night','room-night.png'],['day','room-day.png'],['wood','table-oak.png']]) {
    const asset = new Image(); artwork[name] = asset;
    asset.addEventListener('load', requestDraw);
    assetListeners.push([asset, requestDraw]);
    asset.src = new URL(`./assets/${file}`, import.meta.url).href;
  }
  const listen = (type, fn) => { canvas.addEventListener(type, fn); listeners.push([type, fn]); };

  function rounded(x, y, width, height, radius = 8) {
    context.beginPath(); context.roundRect(x, y, width, height, radius);
  }
  function line(x1, y1, x2, y2, colour, width = 1) {
    context.strokeStyle = colour; context.lineWidth = width;
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
  function label(value, x, y, colour, font = '12px "Segoe UI", sans-serif', align = 'center') {
    context.fillStyle = colour; context.font = font; context.textAlign = align; context.fillText(value, x, y);
  }
  function plant(x, y, scale, day) {
    context.save(); context.translate(x, y); context.scale(scale, scale);
    context.fillStyle = day ? '#816a48' : '#4a4636'; context.beginPath(); context.ellipse(0, 0, 20, 16, 0, 0, TAU); context.fill();
    context.strokeStyle = day ? '#536044' : '#273f30'; context.lineWidth = 3;
    for (let i = 0; i < 9; i += 1) {
      const angle = i * 2.39996; const length = 19 + (i % 3) * 8;
      line(0, -3, Math.cos(angle) * length, Math.sin(angle) * length - 8, day ? '#526a45' : '#34513c', 2);
      context.save(); context.translate(Math.cos(angle) * length, Math.sin(angle) * length - 8); context.rotate(angle + 0.7);
      context.fillStyle = i % 2 ? (day ? '#73864e' : '#415c3e') : (day ? '#495c38' : '#294833');
      context.beginPath(); context.ellipse(0, 0, 12, 5, 0, 0, TAU); context.fill(); context.restore();
    }
    context.restore();
  }
  function book(x, y, width, height, angle, day) {
    context.save(); context.translate(x, y); context.rotate(angle);
    rounded(-width / 2, -height / 2, width, height, 3); context.fillStyle = day ? '#728070' : '#354438'; context.fill();
    rounded(-width / 2 + 5, -height / 2 + 4, width - 8, height - 8, 1); context.fillStyle = day ? '#e0d2ad' : '#9d916c'; context.fill();
    line(0, -height / 2 + 5, 0, height / 2 - 5, day ? '#b0a07b' : '#6d674b');
    for (let row = 0; row < 4; row += 1) line(-width / 2 + 11, -height / 2 + 13 + row * 6, -4, -height / 2 + 13 + row * 6, day ? '#b9aa89' : '#827758', 1);
    context.restore();
  }
  function chair(x, y, width, below, day) {
    const height = width * 0.48;
    context.save(); context.translate(x, y); if (below) context.rotate(Math.PI);
    rounded(-width / 2, -height / 2, width, height, 17); context.fillStyle = day ? '#ad8758' : '#604831'; context.fill();
    context.strokeStyle = day ? '#765b3c' : '#856345'; context.lineWidth = 3; context.stroke();
    context.save(); rounded(-width / 2 + 8, -height / 2 + 7, width - 16, height - 14, 10); context.clip();
    for (let i = -width; i < width; i += 7) {
      line(i, -height, i, height, day ? '#7f6a46' : '#a7804f', 1);
      line(-width, i, width, i, day ? '#88724e' : '#735638', 1);
    }
    context.restore(); context.restore();
  }
  function dimension(x1, y1, x2, y2, text, colour, vertical = false) {
    line(x1, y1, x2, y2, colour);
    const dx = vertical ? 5 : 0, dy = vertical ? 0 : 5;
    line(x1 - dx, y1 - dy, x1 + dx, y1 + dy, colour);
    line(x2 - dx, y2 - dy, x2 + dx, y2 + dy, colour);
    label(text, vertical ? x1 - 9 : (x1 + x2) / 2, vertical ? (y1 + y2) / 2 + 4 : y1 - 8, colour, '12px "Segoe UI", sans-serif', vertical ? 'right' : 'center');
  }

  function draw() {
    if (disposed || !state || !context) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { scene, day = false, mode = 'layout', proposed = false, selected = null, comparison = null } = state;
    const w = rect.width, h = rect.height, compact = w < 460, short = h < 180;
    const padX = compact ? 39 : 60, padY = short ? 24 : Math.max(30, Math.min(compact ? 48 : 55, h * 0.14));
    const scale = Math.min((w - padX * 2) / scene.width, (h - padY * 2) / scene.depth);
    const tw = scene.width * scale, th = scene.depth * scale, tx = (w - tw) / 2, ty = (h - th) / 2;
    transform = { x: tx, y: ty, scale, width: scene.width, depth: scene.depth };
    const px = (value) => tx + value * scale, py = (value) => ty + value * scale;
    const textColour = day ? '#654d31' : '#ebddba';
    const callout = (value, x, y, font = '11px "Segoe UI", sans-serif') => {
      context.font = font;
      const width = context.measureText(value).width;
      rounded(x - width / 2 - 4, y - 11, width + 8, 15, 3);
      context.fillStyle = day ? '#faf6e9' : '#142e25'; context.fill();
      label(value, x, y, day ? '#443925' : '#ebddba', font);
    };
    const background = context.createLinearGradient(0, 0, w, h);
    background.addColorStop(0, day ? '#eee6d5' : '#172c28'); background.addColorStop(1, day ? '#d1c6ac' : '#0f211f');
    context.fillStyle = background; context.fillRect(0, 0, w, h);

    const room = artwork[day ? 'day' : 'night'], illustrated = room.complete && room.naturalWidth > 0;
    if (illustrated) {
      const ratio = Math.max(w / room.naturalWidth, h / room.naturalHeight);
      const iw = room.naturalWidth * ratio, ih = room.naturalHeight * ratio;
      context.drawImage(room, (w-iw)/2, (h-ih)/2, iw, ih);
    }

    // Decorative room objects remain outside the calculated task surface.
    if (!illustrated) {
    const rugWidth = short ? Math.min(w * 0.85, tw + 80) : w * 0.85, rugX = (w - rugWidth) / 2, rugY = h * 0.10;
    rounded(rugX, rugY, rugWidth, h * 0.84, 8); context.fillStyle = day ? '#b0a086' : '#394035'; context.fill();
    context.strokeStyle = day ? '#897559' : '#665a42'; context.lineWidth = 3; context.stroke();
    for (let inset = 8; inset < 25; inset += 6) {
      rounded(rugX + inset, rugY + inset, rugWidth - inset * 2, h * 0.84 - inset * 2, 5);
      context.strokeStyle = day ? '#c6b899' : '#71644a'; context.lineWidth = 1; context.stroke();
    }
    if (!short) {
      chair(tx + tw * 0.31, ty - 18, clamp(tw * 0.19, 50, 104), false, day);
      chair(tx + tw * 0.69, ty + th + 18, clamp(tw * 0.19, 50, 104), true, day);
    }
    }
    context.shadowColor = day ? '#5f44273f' : '#0009'; context.shadowBlur = 14; context.shadowOffsetY = 9;
    rounded(tx, ty, tw, th, 6); context.fillStyle = day ? '#ac8250' : '#76542f'; context.fill();
    context.shadowBlur = 0; context.shadowOffsetY = 0;
    context.save(); rounded(tx, ty, tw, th, 6); context.clip();
    const wood = context.createLinearGradient(tx, ty, tx + tw, ty + th);
    wood.addColorStop(0, day ? '#caab74' : '#967043'); wood.addColorStop(0.5, day ? '#b58b51' : '#7e592f'); wood.addColorStop(1, day ? '#cba471' : '#8e6439');
    context.fillStyle = wood; context.fillRect(tx, ty, tw, th);
    if (artwork.wood.complete && artwork.wood.naturalWidth > 0) {
      context.drawImage(artwork.wood, tx, ty, tw, th);
      if (mode === 'paths' || mode === 'difference' || proposed) { context.fillStyle = day ? '#4d2a0824' : '#0719149c'; context.fillRect(tx, ty, tw, th); }
    }
    for (let grain = 0; grain < 75; grain += 1) {
      const y = ty + grain / 75 * th;
      context.beginPath(); context.moveTo(tx, y);
      for (let x = 0; x <= tw; x += 18) context.lineTo(tx + x, y + Math.sin(x / 55 + grain * 0.71) * 1.4);
      context.strokeStyle = grain % 3 ? (day ? '#76522619' : '#341c0b20') : (day ? '#eed3a52d' : '#d2aa7020'); context.lineWidth = 1; context.stroke();
    }
    if (!proposed && mode !== 'paths') {
      const difference = mode === 'difference' && comparison;
      const field = difference ? calculateDifferenceField(comparison.aScene, comparison.bScene) : sampleField(scene, compact ? 76 : 112, compact ? 42 : 64);
      const offscreen = document.createElement('canvas'); offscreen.width = field.columns; offscreen.height = field.rows;
      const fieldContext = offscreen.getContext('2d'), pixels = fieldContext.createImageData(field.columns, field.rows);
      for (let index = 0; index < field.values.length; index += 1) {
        const delta = field.values[index], value = difference ? (field.maxMagnitude ? Math.sqrt(Math.abs(delta) / field.maxMagnitude) : 0) : 1 - Math.exp(-delta / 105), cell = index * 4;
        const roomLight = !difference && mode === 'layout';
        const exposure = (day ? .38 : .16) + value * (day ? .62 : .84);
        const colour = roomLight ? [255*exposure,250*exposure,225*exposure] : difference && delta < 0 ? [71,145,191] : [255,199,89];
        pixels.data[cell] = colour[0]; pixels.data[cell + 1] = colour[1]; pixels.data[cell + 2] = colour[2];
        pixels.data[cell + 3] = roomLight ? 255 : Math.round(value * (difference ? 230 : 235));
      }
      fieldContext.putImageData(pixels, 0, 0); context.imageSmoothingEnabled = true;
      if (!difference && mode === 'layout') context.globalCompositeOperation = 'multiply';
      context.drawImage(offscreen, tx, ty, tw, th);
      context.globalCompositeOperation = 'source-over';
      if (mode === 'field') {
        context.fillStyle = day ? '#1b251320' : '#14231c30'; context.globalCompositeOperation = 'multiply'; context.fillRect(tx, ty, tw, th); context.globalCompositeOperation = 'source-over';
      }
    }
    if (mode === 'field' || mode === 'paths' || mode === 'difference') {
      context.strokeStyle = day ? '#583b2728' : '#e9d6ab20'; context.lineWidth = 1;
      for (let x = 0.25; x < scene.width; x += Math.max(0.25, scene.width / 12)) line(px(x), ty, px(x), ty + th, context.strokeStyle);
      for (let y = 0.25; y < scene.depth; y += Math.max(0.25, scene.depth / 8)) line(tx, py(y), tx + tw, py(y), context.strokeStyle);
    }
    context.restore();
    rounded(tx, ty, tw, th, 6); context.strokeStyle = day ? '#795938' : '#b78e53'; context.lineWidth = 2; context.stroke();
    if (short) label(`${scene.width.toFixed(1)} × ${scene.depth.toFixed(1)} m`, w / 2, 12, textColour, '10px "Segoe UI", sans-serif');
    else {
      dimension(tx, ty - 23, tx + tw, ty - 23, `${scene.width.toFixed(2).replace(/0$/, '')} m`, textColour);
      if (w > 360) dimension(tx - 18, ty, tx - 18, ty + th, `${scene.depth.toFixed(2).replace(/0$/, '')} m`, textColour, true);
    }
    if (!illustrated && w > 650) { plant(22, h * 0.27, 0.8, day); plant(w - 25, h * 0.76, 0.75, day); book(w - 28, 40, 43, 58, 0.14, day); }
    const readings = proposed ? null : evaluateScene(scene);
    const priorReadings = mode === 'difference' && comparison ? evaluateScene(comparison.aScene) : null;
    hits = [];
    if (mode === 'paths' && readings) {
      for (const point of scene.detectors) for (const lamp of scene.lamps) {
        if (!lamp.enabled || lamp.intensity === 0) continue;
        const contribution = readings.detectors.find((item) => item.id === point.id).contributions.find((item) => item.lampId === lamp.id);
        context.setLineDash(contribution.blockedBy.length ? [4, 5] : []);
        line(px(lamp.x), py(lamp.y), px(point.x), py(point.y), contribution.blockedBy.length ? '#a75441' : (day ? '#6a6e35' : '#eee5a7'), 2);
        context.setLineDash([]);
      }
    }
    for (const screen of scene.screens) {
      if (!screen.enabled) continue;
      line(px(screen.x1) + 3, py(screen.y1) + 4, px(screen.x2) + 3, py(screen.y2) + 4, '#1c150939', 8);
      line(px(screen.x1), py(screen.y1), px(screen.x2), py(screen.y2), day ? '#3d4b3b' : '#213d33', 9);
      line(px(screen.x1), py(screen.y1), px(screen.x2), py(screen.y2), '#cab082', 2);
      for (const [kind, x, y] of [['screen-start', screen.x1, screen.y1], ['screen-end', screen.x2, screen.y2]]) {
        context.fillStyle = selected?.id === screen.id ? '#f3d39a' : '#9e956c'; context.beginPath(); context.arc(px(x), py(y), 5, 0, TAU); context.fill();
        hits.push({ kind, id: screen.id, x: px(x), y: py(y), radius: 12, offsetY: 0 });
      }
      if (!compact) label(`Screen · ${screen.height.toFixed(2)} m`, px((screen.x1 + screen.x2) / 2) + 11, py((screen.y1 + screen.y2) / 2), textColour, '11px "Segoe UI", sans-serif', 'left');
    }
    for (const [index, lamp] of scene.lamps.entries()) {
      const x = px(lamp.x), y = py(lamp.y) - 21;
      const luminous = lamp.enabled && lamp.intensity > 0 && !proposed && mode !== 'difference';
      line(x, y + 11, x, py(lamp.y), '#4a3a2680', 1);
      context.shadowBlur = luminous ? clamp(lamp.intensity / 6, 2, 18) : 0; context.shadowColor = '#ffc262';
      const brass = context.createRadialGradient(x-4,y-5,1,x,y,14);
      brass.addColorStop(0,'#ffe0a0');brass.addColorStop(.35,'#ad7932');brass.addColorStop(.64,'#463118');brass.addColorStop(.86,'#ba873d');brass.addColorStop(1,'#382511');
      context.beginPath(); context.arc(x, y, 14, 0, TAU); context.fillStyle = lamp.enabled && lamp.intensity > 0 ? brass : '#778371'; context.fill(); context.shadowBlur = 0;
      context.strokeStyle = day ? '#49321c' : '#f2d199'; context.lineWidth = selected?.kind === 'lamp' && selected.id === lamp.id ? 3 : 1.5; context.stroke();
      context.beginPath(); context.arc(x, y, 5, 0, TAU); context.fillStyle = luminous ? '#fff0b9' : '#9e8f68'; context.fill();
      callout(`L${index + 1}`, x, y - 18);
      hits.push({ kind: 'lamp', id: lamp.id, x, y, radius: 18, offsetY: -21 });
    }
    for (const [index, point] of scene.detectors.entries()) {
      const x = px(point.x), y = py(point.y), active = selected?.kind === 'point' && selected.id === point.id;
      context.beginPath(); context.arc(x, y, active ? 10 : 8, 0, TAU); context.fillStyle = day ? '#faf2dbd9' : '#142e25d9'; context.fill(); context.strokeStyle = day ? '#634e2f' : '#f3dfab'; context.lineWidth = active ? 2.5 : 1; context.stroke();
      line(x - 12, y, x + 12, y, day ? '#55432d' : '#f3dfab'); line(x, y - 12, x, y + 12, day ? '#55432d' : '#f3dfab');
      const reading = readings?.detectors.find((item) => item.id === point.id);
      const delta = priorReadings ? reading.lux - priorReadings.detectors.find((entry) => entry.id === point.id).lux : null;
      const value = proposed ? 'pending' : delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lx` : `${reading.lux.toFixed(1)} lx`;
      callout(short ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + index)} · ${value}`, x, y + (short ? 23 : 28), `${compact ? 11 : 12}px "Segoe UI", sans-serif`);
      hits.push({ kind: 'point', id: point.id, x, y, radius: 14, offsetY: 0 });
    }
    callout(proposed ? 'PROPOSED GEOMETRY · CALCULATIONS COVERED' : mode === 'difference' ? 'B − A · BLUE LESS LIGHT · AMBER MORE LIGHT' : mode === 'paths' ? 'DIRECT PATHS · DASHED PATHS ARE BLOCKED' : 'CALCULATED DIRECT LIGHT · IDEAL POINT SOURCES', w / 2, h - 12, '10px "Segoe UI", sans-serif');
  }
  function requestDraw() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function position(event) {
    const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  listen('pointerdown', (event) => {
    if (!transform || !state || state.readOnly || drag) return;
    const point = position(event);
    const hit = hits.filter((item) => Math.hypot(point.x - item.x, point.y - item.y) <= item.radius).sort((a, b) => Math.hypot(point.x - a.x, point.y - a.y) - Math.hypot(point.x - b.x, point.y - b.y))[0];
    if (!hit) return;
    callbacks.onSelect?.({ kind: hit.kind, id: hit.id });
    if (state.canMove && !state.canMove(hit)) return;
    drag = { ...hit, pointerId: event.pointerId, startX: point.x, startY: point.y, moved: false };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  listen('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId || !transform) return;
    const point = position(event);
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) < 2 && !drag.moved) return;
    drag.moved = true;
    const x = clamp(Math.round(clamp((point.x - transform.x) / transform.scale, 0, transform.width) * 100) / 100, 0, transform.width);
    const y = clamp(Math.round(clamp((point.y - drag.offsetY - transform.y) / transform.scale, 0, transform.depth) * 100) / 100, 0, transform.depth);
    callbacks.onMove?.({ kind: drag.kind, id: drag.id, x, y }); event.preventDefault();
  });
  function finish(event = null, cancelled = false) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const moved = drag.moved, pointerId = drag.pointerId; drag = null;
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    if (moved) callbacks.onCommitMove?.({ cancelled });
  }
  listen('pointerup', (event) => finish(event));
  listen('pointercancel', (event) => finish(event, true));
  listen('lostpointercapture', (event) => finish(event, true));
  const observer = new ResizeObserver(requestDraw); observer.observe(canvas);
  return {
    render(next) { state = next; requestDraw(); },
    snapshot() { draw(); return canvas.toDataURL('image/png'); },
    destroy() { disposed = true; finish(null, true); if (frame) cancelAnimationFrame(frame); observer.disconnect(); listeners.forEach(([type, fn]) => canvas.removeEventListener(type, fn)); assetListeners.forEach(([asset, fn]) => asset.removeEventListener('load', fn)); }
  };
}
