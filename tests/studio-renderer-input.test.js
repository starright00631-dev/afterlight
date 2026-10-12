import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioRenderer} from '../studio-renderer.js';
import {createStudy, updateScene} from '../studies.js';
import {evaluateScene} from '../optics.js';

// A Canvas2D boundary double observes the actual drawn handles. Pointer targets
// come from those handles, not a second copy of the renderer's transform formula.
function harness(t) {
  const originals = new Map(), images = [], observers = [], frames = new Map();
  let nextFrame = 0;
  function replace(name, value) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable:true, writable:true});
  }
  function context() {
    let translatedX=0,translatedY=0,path=null;
    const stack=[];
    return new Proxy({
      circles:[], labels:[], draws:[], fills:[],
      save() { stack.push([translatedX,translatedY]); },
      restore() { const restored=stack.pop();if(restored)[translatedX,translatedY]=restored; },
      translate(x,y) { translatedX+=x;translatedY+=y; },
      beginPath() { path=null; },
      roundRect(x,y,width,height) { path={x:translatedX+x,y:translatedY+y,width,height}; },
      fill() { if(path)this.fills.push({...path,style:this.fillStyle}); },
      drawImage(image,...args) { const [x,y,width,height]=args.slice(-4);this.draws.push({image,file:image.src,x:translatedX+x,y:translatedY+y,width,height}); },
      arc(x,y,radius) { this.circles.push({x,y,radius}); },
      fillText(text,x,y) { this.labels.push({text:String(text),x,y}); },
      measureText(text) { return {width:String(text).length*7}; },
      createLinearGradient() { return {addColorStop(){}}; },
      createRadialGradient() { return {addColorStop(){}}; },
      createImageData(width,height) { return {data:new Uint8ClampedArray(width*height*4)}; }
    }, {get(target,key) { return key in target ? target[key] : () => {}; }});
  }
  const ctx = context(), listeners = new Map(), captures = new Set();
  const rect = {left:37,top:61,width:800,height:500};
  const canvas = {
    title:'Exact controls available',style:{cursor:'crosshair'},
    getContext:() => ctx, getBoundingClientRect:() => rect,
    addEventListener(type,fn) { listeners.set(type,fn); },
    removeEventListener(type,fn) { if(listeners.get(type)===fn)listeners.delete(type); },
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
    toDataURL:() => 'data:image/png;base64,mock'
  };
  replace('document',{createElement() { return {getContext:context}; }});
  replace('Image',class {
    complete=false; naturalWidth=0; naturalHeight=0; listeners=new Map();
    constructor() { images.push(this); }
    addEventListener(type,fn) { this.listeners.set(type,fn); }
    removeEventListener(type,fn) { if(this.listeners.get(type)===fn)this.listeners.delete(type); }
  });
  replace('ResizeObserver',class {
    disconnected=false;
    constructor(fn) { this.fn=fn; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected=true; }
  });
  replace('requestAnimationFrame',(fn) => { const id=++nextFrame;frames.set(id,fn);return id; });
  replace('cancelAnimationFrame',(id) => frames.delete(id));
  replace('devicePixelRatio',2);
  let renderer;
  t.after(() => {
    renderer?.destroy();
    for(const [name,descriptor] of originals) {
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else delete globalThis[name];
    }
  });
  return {
    canvas,ctx,images,observers,listeners,captures,frames,rect,
    mount(callbacks) { return renderer=createStudioRenderer(canvas,callbacks); },
    flush() {
      ctx.circles.length=0;ctx.labels.length=0;ctx.draws.length=0;ctx.fills.length=0;
      let budget=20;
      while(frames.size) {
        assert.ok(budget-- > 0,'draw scheduling settles');
        const queued=[...frames];frames.clear();queued.forEach(([,fn])=>fn());
      }
    },
    emit(type,point={},pointerId=7) {
      listeners.get(type)?.({pointerId,clientX:(point.x??0)+rect.left,clientY:(point.y??0)+rect.top,preventDefault(){}});
    }
  };
}

test('drawn lamp handles map pointer edits to the same physical points as numeric edits and clamp to the surface',t => {
  const h=harness(t),study=createStudy({projectId:'project-pointer'}),changes=[],selections=[],commits=[];
  const original=structuredClone(study.scene);
  const renderer=h.mount({onSelect:selection=>selections.push(selection),onMove:change=>changes.push(change),onCommitMove:result=>commits.push(result)});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  const lamp=h.ctx.circles.find(item=>item.radius===14),points=h.ctx.circles.filter(item=>item.radius===8);
  assert.equal(points.length,2);
  const lampOffset=lamp.y-points[0].y;
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:points[1].x,y:points[1].y+lampOffset});
  assert.deepEqual(selections,[{kind:'lamp',id:study.scene.lamps[0].id}]);
  assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,x:study.scene.detectors[1].x,y:study.scene.detectors[1].y});
  const numeric=structuredClone(study.scene);Object.assign(numeric.lamps[0],{x:changes.at(-1).x,y:changes.at(-1).y});
  updateScene(study,numeric);renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  const moved=h.ctx.circles.find(item=>item.radius===14),target=h.ctx.circles.filter(item=>item.radius===8)[1];
  assert.equal(moved.x,target.x);assert.equal(moved.y-target.y,lampOffset);
  assert.deepEqual(evaluateScene(study.scene),evaluateScene(numeric));
  h.emit('pointermove',{x:10000,y:-10000});
  assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,x:study.scene.width,y:0});
  h.emit('pointercancel');assert.deepEqual(commits,[{cancelled:true}]);
  assert.deepEqual(original.detectors,study.scene.detectors,'pointer editing does not move the measurement setup');
  const fractional=structuredClone(study.scene);fractional.width=2.345;fractional.depth=1.235;
  updateScene(study,fractional);renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  h.emit('pointerdown',h.ctx.circles.find(item=>item.radius===14));
  h.emit('pointermove',{x:10000,y:10000});
  assert.equal(changes.at(-1).x,study.scene.width,'rounding cannot put a handle beyond a valid fractional surface edge');
  assert.equal(changes.at(-1).y,study.scene.depth);
  h.emit('pointercancel');
});

test('missing art leaves scientific handles usable and a read-only difference rejects pointer editing',t => {
  const h=harness(t),study=createStudy({projectId:'project-readonly'}),calls=[];
  const a=structuredClone(study.scene),b=structuredClone(a);b.lamps[0].intensity=40;
  const renderer=h.mount({onSelect:()=>calls.push('select'),onMove:()=>calls.push('move'),onCommitMove:()=>calls.push('commit')});
  h.images.forEach(image=>{image.complete=true;}); // Failed browser image: complete, but no natural pixels.
  renderer.render({scene:b,mode:'difference',comparison:{aScene:a,bScene:b},readOnly:true});h.flush();
  const lamp=h.ctx.circles.find(item=>item.radius===14);
  assert.ok(lamp,'fallback still draws the model lamp');
  assert.ok(h.ctx.labels.some(item=>/lx/.test(item.text)),'fallback retains calculated text readings');
  assert.ok(h.ctx.labels.every(item=>!/(NaN|Infinity)/.test(item.text)));
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:lamp.x+40,y:lamp.y});h.emit('pointerup');
  assert.deepEqual(calls,[]);assert.equal(h.captures.size,0);
  assert.ok(h.images.every(image=>image.complete && image.naturalWidth===0),'this verifies the failed-image fallback path');
});

test('only the active pointer can finish a drag and disposal releases input and art resources',t => {
  const h=harness(t),study=createStudy({projectId:'project-cleanup'}),commits=[];
  const renderer=h.mount({onCommitMove:result=>commits.push(result)});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  const lamp=h.ctx.circles.find(item=>item.radius===14);
  h.emit('pointerdown',lamp,7);h.emit('pointermove',{x:lamp.x+30,y:lamp.y},7);
  h.emit('pointerdown',lamp,8);
  h.emit('pointerup',lamp,8);
  assert.deepEqual(commits,[],'a second pointer cannot commit the active drag');
  h.emit('pointercancel',lamp,7);assert.deepEqual(commits,[{cancelled:true}]);
  assert.equal(h.captures.size,0,'cancellation releases the active pointer capture');
  h.emit('pointerdown',lamp,7);h.emit('pointermove',{x:lamp.x+30,y:lamp.y},7);
  h.emit('lostpointercapture',lamp,7);
  assert.deepEqual(commits,[{cancelled:true},{cancelled:true}],'unexpected capture loss cancels the draft');
  h.emit('pointerdown',lamp,7);h.emit('pointermove',{x:lamp.x+30,y:lamp.y},7);
  renderer.render({scene:study.scene});assert.ok(h.frames.size>0);
  renderer.destroy();
  assert.deepEqual(commits,[{cancelled:true},{cancelled:true},{cancelled:true}],'disposal cancels an active draft');
  assert.equal(h.captures.size,0);
  assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);
  assert.ok(h.observers.every(observer=>observer.disconnected));
  assert.ok(h.images.every(image=>image.listeners.size===0),'image callbacks cannot retain a disposed renderer');
});

test('two-axis dragging follows the drawn depth projection before and after a physical surface resize',t => {
  const h=harness(t),study=createStudy({projectId:'project-projection'}),changes=[];
  const prepared=structuredClone(study.scene);
  Object.assign(prepared.detectors[0],{x:.4,y:.2});
  Object.assign(prepared.detectors[1],{x:2.1,y:1.05});
  Object.assign(prepared.lamps[0],{x:.4,y:.2});
  updateScene(study,prepared);
  const renderer=h.mount({onMove:change=>changes.push(change)});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  let lamp=h.ctx.circles.find(item=>item.radius===14),points=h.ctx.circles.filter(item=>item.radius===8);
  let offset=lamp.y-points[0].y;
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:points[1].x,y:points[1].y+offset});h.emit('pointerup');
  assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,x:2.1,y:1.05});
  const resized=structuredClone(study.scene);
  Object.assign(resized.lamps[0],{x:2.1,y:1.05});resized.width=3.45;resized.depth=2.15;
  updateScene(study,resized);renderer.render({scene:study.scene,day:true,canMove:()=>true});h.flush();
  lamp=h.ctx.circles.find(item=>item.radius===14);points=h.ctx.circles.filter(item=>item.radius===8);offset=lamp.y-points[1].y;
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:points[0].x,y:points[0].y+offset});h.emit('pointerup');
  assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,x:.4,y:.2},'screen-space y compression must be inverted into physical metres');
  assert.deepEqual(study.scene.detectors,prepared.detectors,'resizing and dragging keep fixed measurement geometry');
});

test('off-centre lamp grips preserve their offset in both axes, including a small first movement on normal, compact and short stages',t => {
  const h=harness(t),study=createStudy({projectId:'project-grip'}),changes=[],commits=[];
  study.scene.detectors[1].y=.95;
  const renderer=h.mount({onMove:change=>changes.push(change),onCommitMove:change=>commits.push(change)});
  for(const [width,height,headOffset] of [[800,500,-34],[390,210,-26],[800,132,-21]]){
    h.rect.width=width;h.rect.height=height;renderer.render({scene:study.scene,canMove:()=>true});h.flush();
    const lamp=h.ctx.circles.find(item=>item.radius===14),points=h.ctx.circles.filter(item=>item.radius===8);
    const offset=lamp.y-points[0].y,grip={x:10,y:-8},down={x:lamp.x+grip.x,y:lamp.y+grip.y};
    assert.equal(offset,headOffset,'the drawn lamp head uses the stage-appropriate offset');
    const scaleX=(points[1].x-points[0].x)/(study.scene.detectors[1].x-study.scene.detectors[0].x);
    const scaleY=(points[1].y-points[0].y)/(study.scene.detectors[1].y-study.scene.detectors[0].y);
    h.emit('pointerdown',down);h.emit('pointermove',{x:down.x+3,y:down.y+3});
    assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,
      x:Math.round((study.scene.lamps[0].x+3/scaleX)*100)/100,
      y:Math.round((study.scene.lamps[0].y+3/scaleY)*100)/100},'the first move adds pointer travel, not the grip-to-centre distance');
    h.emit('pointermove',{x:points[1].x+grip.x,y:points[1].y+offset+grip.y});h.emit('pointerup');
    assert.deepEqual(changes.at(-1),{kind:'lamp',id:study.scene.lamps[0].id,x:1.6,y:.95});
    assert.equal(h.captures.size,0);
  }
  assert.deepEqual(commits,[{cancelled:false},{cancelled:false},{cancelled:false}]);
});

test('selection without movement and fixed-equipment selection never commit a geometry change',t => {
  const h=harness(t),study=createStudy({projectId:'project-select'}),selected=[],moves=[],commits=[];
  const original=structuredClone(study.scene);
  const renderer=h.mount({onSelect:item=>selected.push(item),onMove:item=>moves.push(item),onCommitMove:item=>commits.push(item)});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  let lamp=h.ctx.circles.find(item=>item.radius===14);
  h.emit('pointerdown',{x:lamp.x+6,y:lamp.y-4});h.emit('pointerup');
  assert.equal(selected.length,1);assert.deepEqual(moves,[]);assert.deepEqual(commits,[]);assert.equal(h.captures.size,0);
  renderer.render({scene:study.scene,canMove:()=>false});h.flush();lamp=h.ctx.circles.find(item=>item.radius===14);
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:lamp.x+50,y:lamp.y+50});h.emit('pointerup');
  assert.equal(selected.length,2,'fixed equipment can still be inspected');
  assert.deepEqual(moves,[]);assert.deepEqual(commits,[]);assert.equal(h.captures.size,0);assert.deepEqual(study.scene,original);
});

test('hover feedback respects editability changes, pointer leave and disposal without editing the model',t => {
  const h=harness(t),study=createStudy({projectId:'project-hover'}),calls=[];
  const original=structuredClone(study.scene),title=h.canvas.title,cursor=h.canvas.style.cursor;
  const renderer=h.mount({onSelect:()=>calls.push('select'),onMove:()=>calls.push('move'),onCommitMove:()=>calls.push('commit')});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();
  const lamp=h.ctx.circles.find(item=>item.radius===14);
  h.emit('pointermove',lamp);h.flush();assert.equal(h.canvas.style.cursor,'grab');assert.match(h.canvas.title,/Drag Lamp 1/);
  renderer.render({scene:study.scene,readOnly:true,canMove:()=>true});h.flush();
  assert.equal(h.canvas.style.cursor,cursor);assert.equal(h.canvas.title,title);
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();h.emit('pointermove',lamp);h.flush();
  h.emit('pointerleave');h.flush();assert.equal(h.canvas.style.cursor,cursor);assert.equal(h.canvas.title,title);
  h.emit('pointermove',lamp);h.flush();renderer.destroy();
  assert.equal(h.canvas.style.cursor,cursor);assert.equal(h.canvas.title,title);
  assert.deepEqual(calls,[]);assert.deepEqual(study.scene,original);
});

test('becoming readonly cancels an active geometry gesture and later pointer events cannot commit it',t => {
  const h=harness(t),study=createStudy({projectId:'project-gesture-lock'}),moves=[],commits=[];
  const renderer=h.mount({onMove:item=>moves.push(item),onCommitMove:item=>commits.push(item)});
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();const lamp=h.ctx.circles.find(item=>item.radius===14);
  h.emit('pointerdown',lamp);h.emit('pointermove',{x:lamp.x+30,y:lamp.y+20});assert.equal(h.captures.size,1);
  renderer.render({scene:study.scene,readOnly:true,canMove:()=>true});h.flush();
  assert.equal(h.captures.size,0);assert.deepEqual(commits,[{cancelled:true}]);
  h.emit('pointermove',{x:lamp.x+50,y:lamp.y+50});h.emit('pointerup');
  assert.equal(moves.length,1);assert.deepEqual(commits,[{cancelled:true}]);
});

function loadedArt(h) { h.images.forEach(image=>Object.assign(image,{complete:true,naturalWidth:1774,naturalHeight:887})); }
function drawnProp(h,id) {
  const shape=id==='book'?h.ctx.draws.find(draw=>draw.file?.endsWith('/reading-book.png')):h.ctx.fills.find(fill=>fill.style==='#525b3c');
  assert.ok(shape,`${id} is observed from its actual draw operation`);
  return {x:shape.x+shape.width/2,y:shape.y+shape.height/2};
}

test('drawn books and notebooks activate only on a matching release, even in readonly layouts, and never enter edit callbacks',t => {
  const h=harness(t),study=createStudy({projectId:'project-props'}),activated=[],edits=[];
  const renderer=h.mount({onActivate:item=>activated.push(item),onSelect:()=>edits.push('select'),onMove:()=>edits.push('move'),onCommitMove:()=>edits.push('commit')});
  loadedArt(h);renderer.render({scene:study.scene,readOnly:true});h.flush();
  const book=drawnProp(h,'book'),notebook=drawnProp(h,'notebook');
  for(const [id,point] of [['book',book],['notebook',notebook]]){
    const count=activated.length;
    h.emit('pointerdown',point);assert.equal(activated.length,count,'pressing down does not navigate');assert.equal(h.captures.size,1);
    h.emit('pointerup',point);assert.deepEqual(activated.at(-1),{kind:'prop',id});assert.equal(h.captures.size,0);
  }
  const count=activated.length;
  h.emit('pointerdown',book);h.emit('pointermove',{x:book.x+20,y:book.y});h.emit('pointerup',book);
  assert.equal(activated.length,count,'a touch drag does not open the guide on release');
  h.emit('pointerdown',book);h.emit('pointerup',notebook);
  assert.equal(activated.length,count,'releasing over another object cancels the press');
  for(const ending of ['pointercancel','lostpointercapture']){
    h.emit('pointerdown',book);h.emit(ending,book);assert.equal(activated.length,count);assert.equal(h.captures.size,0);
  }
  h.emit('pointerdown',book,7);h.emit('pointerdown',notebook,8);h.emit('pointerup',notebook,8);
  assert.equal(activated.length,count);assert.equal(h.captures.size,1,'a second pointer cannot complete the held press');
  h.emit('pointerup',book,7);assert.equal(activated.length,count+1);assert.equal(h.captures.size,0);
  assert.deepEqual(edits,[]);
});

test('prop hover and held presses are cleared when Room details disappear or the renderer is destroyed',t => {
  const h=harness(t),study=createStudy({projectId:'project-prop-mode'}),activated=[];
  const title=h.canvas.title,cursor=h.canvas.style.cursor;
  const renderer=h.mount({onActivate:item=>activated.push(item)});loadedArt(h);
  renderer.render({scene:study.scene,readOnly:true});h.flush();const book=drawnProp(h,'book');
  h.emit('pointermove',book);h.flush();assert.equal(h.canvas.style.cursor,'pointer');assert.equal(h.canvas.title,'Open field guide');
  h.emit('pointerdown',book);renderer.render({scene:study.scene,mode:'field',readOnly:true});h.flush();
  assert.equal(h.canvas.style.cursor,cursor);assert.equal(h.canvas.title,title);
  h.emit('pointerup',book);assert.deepEqual(activated,[]);assert.equal(h.captures.size,0);
  renderer.render({scene:study.scene,readOnly:true});h.flush();h.emit('pointerdown',drawnProp(h,'book'));
  renderer.destroy();assert.equal(h.captures.size,0);assert.deepEqual(activated,[]);assert.equal(h.canvas.title,title);assert.equal(h.canvas.style.cursor,cursor);
});

test('a measurement handle takes priority over a former book location, without accidental navigation',t => {
  const h=harness(t),study=createStudy({projectId:'project-prop-priority'}),selected=[],activated=[];
  study.scene.detectors[1].y=.95;
  const renderer=h.mount({onSelect:item=>selected.push(item),onActivate:item=>activated.push(item)});loadedArt(h);
  renderer.render({scene:study.scene,canMove:()=>true});h.flush();const book=drawnProp(h,'book'),points=h.ctx.circles.filter(item=>item.radius===8);
  const a=study.scene.detectors[0],b=study.scene.detectors[1],scaleX=(points[1].x-points[0].x)/(b.x-a.x),scaleY=(points[1].y-points[0].y)/(b.y-a.y);
  const changed=structuredClone(study.scene);
  changed.detectors[0].x=a.x+(book.x-points[0].x)/scaleX;changed.detectors[0].y=a.y+(book.y-points[0].y)/scaleY;
  renderer.render({scene:changed,canMove:()=>true});h.flush();const point=h.ctx.circles.find(item=>item.radius===8);
  assert.ok(!h.ctx.draws.some(draw=>draw.file?.endsWith('/reading-book.png')),'paper yields to the measurement location');
  h.emit('pointerdown',point);h.emit('pointerup',point);
  assert.deepEqual(selected,[{kind:'point',id:a.id}]);assert.deepEqual(activated,[]);
});

test('a procedural fallback book stays actionable and asset loading changes neither handle positions nor readings',t => {
  const h=harness(t),study=createStudy({projectId:'project-prop-fallback'}),activated=[];
  const renderer=h.mount({onActivate:item=>activated.push(item)});
  renderer.render({scene:study.scene,readOnly:true});h.flush();
  const fallback=h.ctx.fills.find(fill=>fill.style==='#354438');assert.ok(fallback);
  const point={x:fallback.x+fallback.width/2,y:fallback.y+fallback.height/2};
  h.emit('pointerdown',point);h.emit('pointerup',point);assert.deepEqual(activated,[{kind:'prop',id:'book'}]);
  const handles=h.ctx.circles.filter(circle=>circle.radius===14||circle.radius===8),readings=h.ctx.labels.filter(label=>/lx/.test(label.text));
  loadedArt(h);h.images.forEach(image=>image.listeners.get('load')?.());h.flush();
  assert.deepEqual(h.ctx.circles.filter(circle=>circle.radius===14||circle.radius===8),handles);
  assert.deepEqual(h.ctx.labels.filter(label=>/lx/.test(label.text)),readings);
  const loaded=drawnProp(h,'book');assert.deepEqual(loaded,point);
  h.emit('pointerdown',loaded);h.emit('pointerup',loaded);assert.deepEqual(activated.at(-1),{kind:'prop',id:'book'});
});
