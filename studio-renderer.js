import { evaluateScene, sampleField } from './optics.js';
import {calculateDifferenceField} from './field-difference.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** One transform drives table drawing, pointer hit testing and dragging. */
export function createStudioRenderer(canvas, callbacks = {}) {
  const context = canvas.getContext('2d');
  let state = null, transform = null, hits = [], props = [], hovered = null, frame = 0, drag = null, disposed = false;
  const originalTitle = canvas.title || '', originalCursor = canvas.style?.cursor || '';
  const listeners = [];
  const artwork = {}, assetListeners = [];
  let fieldCanvas = null;
  for (const [name, file] of [['night','room-night.png'],['day','room-day.png'],['wood','table-oak-refined.png'],['book','reading-book.png'],['lamp','lamp-brass.png']]) {
    const asset = new Image(); artwork[name] = asset;
    asset.addEventListener('load', requestDraw);
    assetListeners.push([asset, requestDraw]);
    asset.src = new URL(`./assets/${file}`, import.meta.url).href;
  }
  const listen = (type, fn) => { canvas.addEventListener(type, fn); listeners.push([type, fn]); };

  function rounded(x, y, width, height, radius = 8) {
    context.beginPath(); context.roundRect(x, y, width, height, radius);
  }
  function cover(asset, x, y, width, height) {
    const scale = Math.max(width / asset.naturalWidth, height / asset.naturalHeight);
    const sourceWidth = width / scale, sourceHeight = height / scale;
    context.drawImage(asset, (asset.naturalWidth - sourceWidth) / 2, (asset.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height);
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
  function readingMaterials(scene, tx, ty, tw, th, scale, day, lampOffset) {
    if (tw < 240 || th < 125) return;
    // These flat place cues receive the same light raster as the timber. They are
    // decorative paper, never additional blockers or alternate sample surfaces.
    const protectedAreas = [
      ...scene.lamps.map(lamp => ({x:tx + lamp.x * scale.x - 29,y:ty + lamp.y * scale.y + lampOffset - 44,width:58,height:49 - lampOffset})),
      ...scene.detectors.map(point => ({x:tx + point.x * scale.x - 45,y:ty + point.y * scale.y - 16,width:90,height:51})),
      ...scene.screens.filter(screen => screen.enabled).map(screen => ({x:tx + Math.min(screen.x1,screen.x2) * scale.x - 18,y:ty + Math.min(screen.y1,screen.y2) * scale.y - 18,width:Math.abs(screen.x2-screen.x1) * scale.x + 36,height:Math.abs(screen.y2-screen.y1) * scale.y + 36}))
    ];
    const width = clamp(tw * .20, 56, 116), height = width * .70;
    const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
    const place = (id,x,y,width,height,draw) => {
      const box={x:x-width/2-7,y:y-height/2-7,width:width+14,height:height+14};
      if (box.x < tx+4 || box.y < ty+4 || box.x+box.width > tx+tw-4 || box.y+box.height > ty+th-4 || protectedAreas.some(area=>overlaps(box,area))) return;
      context.save(); context.translate(x,y); draw(width,height); context.restore();
      props.push({kind:'prop',id,x,y,box,label:id === 'book' ? 'Open field guide' : 'Open study record'});
    };
    place('book',tx + width / 2 + 17, ty + height / 2 + 22, width, height, (width,height) => {
      context.rotate(-.075);
      if (artwork.book.complete && artwork.book.naturalWidth > 0) {
        context.shadowColor = '#2c190b70'; context.shadowBlur = 5; context.shadowOffsetY = 2;
        context.drawImage(artwork.book,-width/2,-height/2,width,height);
      } else book(0,0,width,height,-.02,day);
    });
    place('notebook',tx + tw - width * .35 - 21, ty + height * .57 + 26, width * .65, height * 1.04, (width,height) => {
      context.rotate(.10);
      context.shadowColor='#27170760';context.shadowBlur=5;context.shadowOffsetY=3;
      rounded(-width/2-2,-height/2-2,width+4,height+4,2);context.fillStyle='#525b3c';context.fill();
      context.shadowBlur=0;context.shadowOffsetY=0;
      const paper=context.createLinearGradient(-width/2,0,width/2,0);
      paper.addColorStop(0,'#d5c8a6');paper.addColorStop(.09,'#f2e6c8');paper.addColorStop(1,'#e4d5b2');
      rounded(-width/2,-height/2,width,height,1);context.fillStyle=paper;context.fill();
      line(-width/2+4,-height/2+3,-width/2+4,height/2-3,'#a4926675');
      // A blank working notebook and graphite pencil; no fabricated evidence.
      for(let row=0;row<6;row++)line(-width/2+10,-height/2+13+row*7,width/2-7,-height/2+13+row*7,'#a899753c',.65);
      context.save();context.translate(width/2+1,4);context.rotate(.12);
      line(0,-height/2,0,height/2-3,'#352918',4);line(-.7,-height/2,-.7,height/2-5,'#c1a765',1.3);
      context.beginPath();context.moveTo(-2,height/2-3);context.lineTo(0,height/2+3);context.lineTo(2,height/2-3);context.closePath();context.fillStyle='#d9c3a0';context.fill();context.restore();
    });
  }

  function draw() {
    if (disposed || !state || !context) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(rect.width * ratio), pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { scene, day = false, mode = 'layout', proposed = false, selected = null, comparison = null } = state;
    const w = rect.width, h = rect.height, compact = w < 460, short = h < 180;
    props = [];
    const lampOffset = short ? -21 : compact ? -26 : -34;
    const padX = compact ? 39 : 60, padY = short ? 24 : Math.max(30, Math.min(compact ? 42 : 76, h * 0.18));
    // A gentle orthographic viewing angle gives the timber depth. The field,
    // rulers, objects and inverse pointer mapping all use this one projection.
    const depthProjection = .82;
    const scale = Math.min((w - padX * 2) / scene.width, (h - padY * 2) / (scene.depth * depthProjection));
    const scaleY = scale * depthProjection;
    const tw = scene.width * scale, th = scene.depth * scaleY, tx = (w - tw) / 2, ty = (h - th) / 2;
    transform = { x: tx, y: ty, scaleX: scale, scaleY, width: scene.width, depth: scene.depth };
    const px = (value) => tx + value * scale, py = (value) => ty + value * scaleY;
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
    // The crafted rim sits outside the same physical surface used by every handle.
    const rim = short ? 2 : 3, thickness = short ? 3 : 9;
    context.shadowColor = day ? '#3c291951' : '#020906ce'; context.shadowBlur = short ? 10 : 23; context.shadowOffsetY = thickness + 5;
    rounded(tx - rim, ty - rim, tw + rim * 2, th + rim * 2 + thickness, 9);
    const edge = context.createLinearGradient(0, ty - rim, 0, ty + th + rim + thickness);
    edge.addColorStop(0, day ? '#aa743d' : '#885727'); edge.addColorStop(.85, day ? '#855326' : '#523018'); edge.addColorStop(1, day ? '#442a17' : '#26170e');
    context.fillStyle = edge; context.fill();
    context.shadowBlur = 0; context.shadowOffsetY = 0;
    rounded(tx - rim + .5, ty - rim + .5, tw + rim * 2 - 1, th + rim * 2 + thickness - 1, 8);
    context.strokeStyle = day ? '#674323bb' : '#bc854c70'; context.lineWidth = 1; context.stroke();
    context.save(); rounded(tx, ty, tw, th, 6); context.clip();
    const wood = context.createLinearGradient(tx, ty, tx + tw, ty + th);
    wood.addColorStop(0, day ? '#caab74' : '#967043'); wood.addColorStop(0.5, day ? '#b58b51' : '#7e592f'); wood.addColorStop(1, day ? '#cba471' : '#8e6439');
    context.fillStyle = wood; context.fillRect(tx, ty, tw, th);
    const textured = artwork.wood.complete && artwork.wood.naturalWidth > 0;
    if (textured) {
      context.globalAlpha = .92; cover(artwork.wood, tx, ty, tw, th); context.globalAlpha = 1;
    }
    for (let grain = 0; !textured && grain < 55; grain += 1) {
      const y = ty + grain / 55 * th;
      context.beginPath(); context.moveTo(tx, y);
      for (let x = 0; x <= tw; x += 18) context.lineTo(tx + x, y + Math.sin(x / 55 + grain * 0.71) * 1.4);
      context.strokeStyle = grain % 3 ? (day ? '#76522619' : '#341c0b20') : (day ? '#eed3a52d' : '#d2aa7020'); context.lineWidth = 1; context.stroke();
    }
    if (mode === 'layout' && !short) readingMaterials(scene,tx,ty,tw,th,{x:scale,y:scaleY},day,lampOffset);
    if (mode !== 'layout' || proposed) {
      context.fillStyle = day ? '#50351d14' : '#07141070'; context.fillRect(tx, ty, tw, th);
    }
    if (!proposed && mode !== 'paths') {
      const difference = mode === 'difference' && comparison;
      const field = difference ? calculateDifferenceField(comparison.aScene, comparison.bScene) : sampleField(scene, compact ? 76 : 112, compact ? 42 : 64);
      const offscreen = fieldCanvas ||= document.createElement('canvas');
      if (offscreen.width !== field.columns) offscreen.width = field.columns;
      if (offscreen.height !== field.rows) offscreen.height = field.rows;
      const fieldContext = offscreen.getContext('2d'), pixels = fieldContext.createImageData(field.columns, field.rows);
      for (let index = 0; index < field.values.length; index += 1) {
        const delta = field.values[index], value = difference ? (field.maxMagnitude ? Math.sqrt(Math.abs(delta) / field.maxMagnitude) : 0) : 1 - Math.exp(-delta / 105), cell = index * 4;
        const roomLight = !difference && mode === 'layout';
        // Fixed, monotonic tone mapping: brighter calculated lux yields brighter timber.
        // Appearance is illustrative; ambient colour never enters the photometry.
        const exposure = (day ? .83 : .34) + value * (day ? .17 : .66);
        const colour = roomLight ? [255*exposure,(day ? 252 : 245)*exposure,(day ? 240 : 219)*exposure] : difference && delta < 0 ? [71,145,191] : [255,199,89];
        pixels.data[cell] = colour[0]; pixels.data[cell + 1] = colour[1]; pixels.data[cell + 2] = colour[2];
        pixels.data[cell + 3] = roomLight ? 255 : Math.round(value * (difference ? 230 : 235));
      }
      fieldContext.putImageData(pixels, 0, 0); context.imageSmoothingEnabled = true;
      if (!difference && mode === 'layout') context.globalCompositeOperation = 'multiply';
      context.drawImage(offscreen, tx, ty, tw, th);
      context.globalCompositeOperation = 'source-over';
      if (!difference && mode === 'layout') {
        // A second model-derived pass lets pools brighten wood instead of only dimming it.
        // A blocked ray or disabled lamp contributes zero to both passes.
        for (let index = 0; index < field.values.length; index += 1) {
          const value = 1 - Math.exp(-field.values[index] / 105), cell = index * 4;
          pixels.data[cell] = 255; pixels.data[cell + 1] = 221; pixels.data[cell + 2] = 151;
          pixels.data[cell + 3] = Math.round(Math.pow(value, 1.45) * (day ? .23 : .66) * 255);
        }
        fieldContext.putImageData(pixels, 0, 0); context.globalCompositeOperation = 'screen';
        context.drawImage(offscreen, tx, ty, tw, th); context.globalCompositeOperation = 'source-over';
      }
      if (mode === 'field') {
        context.fillStyle = day ? '#1b251320' : '#14231c30'; context.globalCompositeOperation = 'multiply'; context.fillRect(tx, ty, tw, th); context.globalCompositeOperation = 'source-over';
      }
    }
    if (mode === 'field' || mode === 'paths' || mode === 'difference') {
      context.strokeStyle = day ? '#583b2728' : '#e9d6ab20'; context.lineWidth = 1;
      for (let x = 0.25; x < scene.width; x += Math.max(0.25, scene.width / 12)) line(px(x), ty, px(x), ty + th, context.strokeStyle);
      for (let y = 0.25; y < scene.depth; y += Math.max(0.25, scene.depth / 8)) line(tx, py(y), tx + tw, py(y), context.strokeStyle);
    }
    // A shallow bevel and end grain give the tabletop a material edge, not a diagram border.
    const bevel = context.createLinearGradient(0, ty, 0, ty + th);
    bevel.addColorStop(0, day ? '#fff1cb78' : '#ffe0a04d'); bevel.addColorStop(.025, '#ffffff00');
    bevel.addColorStop(.965, '#28150700'); bevel.addColorStop(1, day ? '#321b096b' : '#140c087f');
    context.fillStyle = bevel; context.fillRect(tx, ty, tw, th);
    context.restore();
    rounded(tx + .5, ty + .5, tw - 1, th - 1, 6); context.strokeStyle = day ? '#d4ad7590' : '#c0985a75'; context.lineWidth = 1; context.stroke();
    line(tx + 8, ty - rim + 1, tx + tw - 8, ty - rim + 1, day ? '#eac993aa' : '#d4a25c90');
    line(tx + 8, ty + th + rim + 1, tx + tw - 8, ty + th + rim + 1, day ? '#b97c4380' : '#85552f80');
    if (short) label(`${scene.width} × ${scene.depth} m`, w / 2, 12, textColour, '10px "Segoe UI", sans-serif');
    else {
      dimension(tx, ty - 23, tx + tw, ty - 23, `${scene.width} m`, textColour);
      if (w > 360) dimension(tx - 18, ty, tx - 18, ty + th, `${scene.depth} m`, textColour, true);
    }
    if (!illustrated && w > 650) { plant(22, h * 0.27, 0.8, day); plant(w - 25, h * 0.76, 0.75, day); book(w - 28, 40, 43, 58, 0.14, day); }
    const readings = proposed ? null : evaluateScene(scene);
    const priorReadings = !proposed && mode === 'difference' && comparison ? evaluateScene(comparison.aScene) : null;
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
      const x = px(lamp.x), y = py(lamp.y) + lampOffset, shadeSize = short ? 31 : compact ? 35 : 45;
      const luminous = lamp.enabled && lamp.intensity > 0 && !proposed && mode !== 'difference';
      // The head and its physical foot keep their shared draw/hit/drag transform.
      const stemTop = Math.max(ty + 6,y - (short ? 13 : 40));
      if (stemTop < y-5) {
        line(x,stemTop,x,y-2,'#3b2918',3);line(x-.6,stemTop,x-.6,y-3,'#d6b477',1);
        context.beginPath();context.ellipse(x,stemTop,3.5,1.8,0,0,TAU);context.fillStyle='#aa864b';context.fill();
      }
      context.beginPath(); context.ellipse(x + 3, py(lamp.y) + 2, 10, 4, 0, 0, TAU); context.fillStyle = day ? '#38241335' : '#060c0860'; context.fill();
      context.beginPath(); context.ellipse(x, py(lamp.y), 7, 3, 0, 0, TAU); context.fillStyle = '#775126'; context.fill();
      line(x, y + 9, x, py(lamp.y), '#382513', 3); line(x - .7, y + 9, x - .7, py(lamp.y) - 1, '#d8b377', 1);
      context.shadowBlur = 6; context.shadowOffsetY = 3; context.shadowColor = '#21140880';
      const brass = context.createRadialGradient(x-5,y-6,1,x+2,y+2,18);
      brass.addColorStop(0,'#fff0bf');brass.addColorStop(.26,'#dcb777');brass.addColorStop(.49,'#9c692d');brass.addColorStop(.68,'#442b13');brass.addColorStop(.83,'#c39655');brass.addColorStop(1,'#39230f');
      context.beginPath(); context.arc(x, y, 14, 0, TAU); context.fillStyle = lamp.enabled && lamp.intensity > 0 ? brass : '#778371'; context.fill(); context.shadowBlur = 0;
      context.shadowOffsetY = 0;
      context.strokeStyle = '#382511'; context.lineWidth = 1.5; context.stroke();
      context.beginPath(); context.arc(x, y, 12.1, 0, TAU); context.strokeStyle = '#eed19a90'; context.lineWidth = .8; context.stroke();
      context.beginPath(); context.arc(x - 1, y - 1, 10.5, Math.PI * 1.05, Math.PI * 1.67); context.strokeStyle = '#fff0c6a6'; context.lineWidth = 1.1; context.stroke();
      if (artwork.lamp.complete && artwork.lamp.naturalWidth > 0) {
        context.shadowBlur = 5; context.shadowOffsetY = 3; context.shadowColor = '#23150880';
        context.globalAlpha = lamp.enabled && lamp.intensity>0 ? 1 : .58;
        context.drawImage(artwork.lamp,x-shadeSize/2,y-shadeSize/2,shadeSize,shadeSize);
        context.globalAlpha = 1; context.shadowBlur = 0; context.shadowOffsetY = 0;
        context.save();context.beginPath();context.arc(x,y,shadeSize*.445,0,TAU);context.clip();
        context.fillStyle = day ? '#6043201a' : '#3928103b';context.fillRect(x-shadeSize/2,y-shadeSize/2,shadeSize,shadeSize);context.restore();
      }
      context.shadowBlur = luminous ? clamp(lamp.intensity / 9, 2, 12) : 0; context.shadowColor = '#ffe0a0';
      context.beginPath(); context.arc(x, y, 4.5, 0, TAU); context.fillStyle = luminous ? '#fff0b9' : '#8f805d'; context.fill(); context.shadowBlur = 0;
      if (selected?.kind === 'lamp' && selected.id === lamp.id) {
        context.beginPath(); context.arc(x, y, short ? 18 : compact ? 21 : 25, 0, TAU); context.strokeStyle = day ? '#58391e' : '#fae4b1'; context.lineWidth = 1.3; context.stroke();
      }
      const captionOffset = short || compact ? 18 : 27;
      callout(`L${index + 1}`, y-captionOffset<12 ? x+shadeSize/2+12 : x, y-captionOffset<12 ? Math.max(12,y+4) : y-captionOffset);
      hits.push({ kind: 'lamp', id: lamp.id, x, y, radius: short ? 18 : compact ? 19 : 23, offsetY: lampOffset, label: `Lamp ${index + 1}` });
    }
    for (const [index, point] of scene.detectors.entries()) {
      const x = px(point.x), y = py(point.y), active = selected?.kind === 'point' && selected.id === point.id;
      context.beginPath(); context.arc(x, y, active ? 10 : 8, 0, TAU); context.fillStyle = day ? '#faf2dbd9' : '#142e25d9'; context.fill(); context.strokeStyle = day ? '#634e2f' : '#f3dfab'; context.lineWidth = active ? 2.5 : 1; context.stroke();
      line(x - 12, y, x + 12, y, day ? '#55432d' : '#f3dfab'); line(x, y - 12, x, y + 12, day ? '#55432d' : '#f3dfab');
      const reading = readings?.detectors.find((item) => item.id === point.id);
      const delta = priorReadings ? reading.lux - priorReadings.detectors.find((entry) => entry.id === point.id).lux : null;
      const value = proposed ? 'pending' : delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lx` : `${reading.lux.toFixed(1)} lx`;
      callout(short ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + index)} · ${value}`, x, y + (short ? 23 : 28), `${compact ? 11 : 12}px "Segoe UI", sans-serif`);
      hits.push({ kind: 'point', id: point.id, x, y, radius: 14, offsetY: 0, label: `Point ${String.fromCharCode(65 + index)}` });
    }
    if (drag?.navigation && !props.some(item=>item.id===drag.id))finish(null,true);
    const hoverHit = hovered && [...hits,...props].find(item=>item.kind===hovered.kind && item.id===hovered.id);
    if (!hoverHit) hovered=null;
    feedback(hoverHit);
    if (hoverHit?.kind === 'prop') {
      rounded(hoverHit.box.x,hoverHit.box.y,hoverHit.box.width,hoverHit.box.height,4);
      context.strokeStyle = day ? '#72552b95' : '#eed8a1a0'; context.lineWidth = 1; context.stroke();
      callout(hoverHit.label,hoverHit.x,Math.min(h-30,hoverHit.box.y+hoverHit.box.height+17));
    } else if (hoverHit && !state.readOnly && state.canMove?.(hoverHit) !== false && !drag) {
      context.beginPath(); context.arc(hoverHit.x,hoverHit.y,hoverHit.radius+3,0,TAU);
      context.strokeStyle = day ? '#60472270' : '#f5df9a70'; context.lineWidth = 1; context.stroke();
    }
    callout(proposed ? 'Proposal · calculations covered' : mode === 'difference' ? 'B − A · blue less light · amber more light' : mode === 'paths' ? 'Direct paths · dashed paths are blocked' : 'Direct light · ideal point sources', w / 2, h - 12, '10px "Segoe UI", sans-serif');
  }
  function requestDraw() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function position(event) {
    const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function hitAt(point) {
    const object = hits.filter(item=>Math.hypot(point.x-item.x,point.y-item.y)<=item.radius).sort((a,b)=>Math.hypot(point.x-a.x,point.y-a.y)-Math.hypot(point.x-b.x,point.y-b.y))[0];
    return object || props.find(item=>point.x>=item.box.x && point.x<=item.box.x+item.box.width && point.y>=item.box.y && point.y<=item.box.y+item.box.height);
  }
  function feedback(hit = null) {
    const movable = hit && hit.kind !== 'prop' && !state?.readOnly && state?.canMove?.(hit) !== false;
    if (canvas.style) canvas.style.cursor = drag && !drag.navigation ? 'grabbing' : hit?.kind === 'prop' || drag?.navigation ? 'pointer' : movable ? 'grab' : originalCursor;
    canvas.title = hit?.kind === 'prop' ? hit.label : movable ? `Drag ${hit.label || 'screen endpoint'} · exact values in controls` : originalTitle;
  }
  listen('pointerdown', (event) => {
    if (!transform || !state || drag) return;
    const point = position(event);
    const hit = hitAt(point);
    if (!hit) return;
    if (hit.kind === 'prop') {
      drag={...hit,pointerId:event.pointerId,startX:point.x,startY:point.y,moved:false,navigation:true};
      canvas.setPointerCapture(event.pointerId); feedback(hit); event.preventDefault(); return;
    }
    if (state.readOnly) return;
    callbacks.onSelect?.({ kind: hit.kind, id: hit.id });
    if (state.canMove && !state.canMove(hit)) return;
    drag = { ...hit, pointerId: event.pointerId, startX: point.x, startY: point.y, grabX:point.x-hit.x,grabY:point.y-hit.y,moved: false };
    canvas.setPointerCapture(event.pointerId); feedback(hit); event.preventDefault();
  });
  listen('pointermove', (event) => {
    if (!transform || !state) return;
    const point = position(event);
    if (!drag) {
      const hit=hitAt(point), next=hit ? {kind:hit.kind,id:hit.id} : null;
      if (next?.kind !== hovered?.kind || next?.id !== hovered?.id) { hovered=next; requestDraw(); }
      feedback(hit); return;
    }
    if (event.pointerId !== drag.pointerId) return;
    if (drag.navigation) { if(Math.hypot(point.x-drag.startX,point.y-drag.startY)>=5)drag.moved=true; return; }
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) < 2 && !drag.moved) return;
    drag.moved = true;
    const x = clamp(Math.round(clamp((point.x - drag.grabX - transform.x) / transform.scaleX, 0, transform.width) * 100) / 100, 0, transform.width);
    const y = clamp(Math.round(clamp((point.y - drag.grabY - drag.offsetY - transform.y) / transform.scaleY, 0, transform.depth) * 100) / 100, 0, transform.depth);
    callbacks.onMove?.({ kind: drag.kind, id: drag.id, x, y }); event.preventDefault();
  });
  function finish(event = null, cancelled = false) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const active=drag, moved = drag.moved, pointerId = drag.pointerId; drag = null;
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    if (active.navigation) {
      const released = event && hitAt(position(event));
      if(!cancelled && !moved && released?.kind==='prop' && released.id===active.id)callbacks.onActivate?.({kind:'prop',id:active.id});
    } else if (moved) callbacks.onCommitMove?.({ cancelled });
    feedback(); requestDraw();
  }
  listen('pointerup', (event) => finish(event));
  listen('pointercancel', (event) => finish(event, true));
  listen('lostpointercapture', (event) => finish(event, true));
  listen('pointerleave', () => { hovered=null; if(!drag) feedback(); requestDraw(); });
  const observer = new ResizeObserver(requestDraw); observer.observe(canvas);
  return {
    render(next) { if (drag && !drag.navigation && next.readOnly)finish(null,true); state = next; requestDraw(); },
    snapshot() { draw(); return canvas.toDataURL('image/png'); },
    destroy() { disposed = true; finish(null, true); if (frame) cancelAnimationFrame(frame); observer.disconnect(); listeners.forEach(([type, fn]) => canvas.removeEventListener(type, fn)); assetListeners.forEach(([asset, fn]) => asset.removeEventListener('load', fn)); canvas.title=originalTitle; if(canvas.style)canvas.style.cursor=originalCursor; }
  };
}
