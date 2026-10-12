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
    return new Proxy({
      circles:[], labels:[],
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
    canvas,ctx,images,observers,listeners,captures,frames,
    mount(callbacks) { return renderer=createStudioRenderer(canvas,callbacks); },
    flush() {
      ctx.circles.length=0;ctx.labels.length=0;
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
