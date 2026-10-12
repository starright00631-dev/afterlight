import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioRenderer} from '../studio-renderer.js';
import {createStudy} from '../studies.js';
import {evaluateScene} from '../optics.js';

// Observe the raster and Canvas2D operations actually sent to the browser. The
// expected outcomes below are physical invariants, not a copy of tone mapping.
function harness(t) {
  const originals = new Map(), frames = new Map(), images = [], renderers = [];
  let nextFrame = 0, sequence = 0;
  const replace = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, writable: true, configurable: true});
  };
  const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  function context(owner) {
    let matrix = [1,0,0,1,0,0], path = null;
    const stack = [], operations = [], circles = [], labels = [];
    const point = (x,y) => ({x:matrix[0]*x+matrix[2]*y+matrix[4], y:matrix[1]*x+matrix[3]*y+matrix[5]});
    const bounds = (x,y,w,h) => {
      const corners = [point(x,y),point(x+w,y),point(x,y+h),point(x+w,y+h)];
      const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
      return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
    };
    const ctx = {
      operations, circles, labels, globalCompositeOperation:'source-over', globalAlpha:1,
      shadowBlur:0,shadowOffsetY:0,shadowColor:'transparent',fillStyle:'#000',strokeStyle:'#000',lineWidth:1,
      setTransform(...next) { matrix=next; },
      save() { stack.push({matrix:[...matrix],globalCompositeOperation:this.globalCompositeOperation,globalAlpha:this.globalAlpha,shadowBlur:this.shadowBlur,shadowOffsetY:this.shadowOffsetY,shadowColor:this.shadowColor,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth}); },
      restore() { const saved=stack.pop(); if(saved){matrix=saved.matrix;Object.assign(this,saved);} },
      translate(x,y) { matrix=multiply(matrix,[1,0,0,1,x,y]); },
      rotate(a) { matrix=multiply(matrix,[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]); },
      scale(x,y) { matrix=multiply(matrix,[x,0,0,y,0,0]); },
      beginPath() { path=null; },
      roundRect(x,y,w,h) { path={kind:'rectangle',bounds:bounds(x,y,w,h)}; },
      arc(x,y,radius) { path={kind:'circle',...point(x,y),radius};circles.push({...path,order:++sequence}); },
      fill() { operations.push({kind:'fill',path,style:this.fillStyle,blur:this.shadowBlur,order:++sequence}); },
      fillText(text,x,y) { labels.push({text:String(text),...point(x,y),order:++sequence}); },
      measureText(text) { return {width:String(text).length*7}; },
      createLinearGradient() { return {stops:[],addColorStop(at,color){this.stops.push({at,color});}}; },
      createRadialGradient() { return this.createLinearGradient(); },
      createImageData(width,height) { return {width,height,data:new Uint8ClampedArray(width*height*4)}; },
      putImageData(pixels) { owner.raster={width:pixels.width,height:pixels.height,data:Uint8ClampedArray.from(pixels.data)}; },
      drawImage(asset,...args) {
        const [x,y,w,h]=args.slice(-4);
        operations.push({kind:'image',source:asset.src || 'field',bounds:bounds(x,y,w,h),
          raster:asset.raster ? {...asset.raster,data:Uint8ClampedArray.from(asset.raster.data)} : null,
          composite:this.globalCompositeOperation,order:++sequence});
      }
    };
    return new Proxy(ctx,{get(target,key){return key in target?target[key]:()=>{};}});
  }
  const main = {}, ctx = context(main), listeners = new Map(), rect={left:0,top:0,width:800,height:500};
  const canvas={width:300,height:150,getContext:()=>ctx,getBoundingClientRect:()=>rect,
    addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},
    setPointerCapture(){},hasPointerCapture(){return false;},toDataURL(){return 'data:image/png;base64,mock';}};
  replace('document',{createElement(){const field={width:300,height:150};field.getContext=()=>field.context ||= context(field);return field;}});
  replace('Image',class {
    complete=true;naturalWidth=1774;naturalHeight=887;listeners=new Map();
    constructor(){images.push(this);}
    addEventListener(type,fn){this.listeners.set(type,fn);}
    removeEventListener(type){this.listeners.delete(type);}
  });
  replace('ResizeObserver',class {observe(){}disconnect(){}});
  replace('requestAnimationFrame',fn=>{const id=++nextFrame;frames.set(id,fn);return id;});
  replace('cancelAnimationFrame',id=>frames.delete(id));replace('devicePixelRatio',1);
  const renderer=createStudioRenderer(canvas);renderers.push(renderer);
  t.after(()=>{
    renderers.forEach(item=>item.destroy());
    for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  });
  return {
    ctx, images,
    render(state) {
      ctx.operations.length=0;ctx.circles.length=0;ctx.labels.length=0;
      renderer.render(state);
      let budget=20;
      while(frames.size){assert.ok(budget--);const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());}
      return ctx.operations.filter(operation=>operation.raster);
    }
  };
}
const scene = () => createStudy({projectId:'render-light-project'}).scene;
const channel = (raster,index) => [...raster.data.slice(index*4,index*4+4)];

test('higher calculated lux never darkens either Room lighting pass in day or night appearance', t => {
  const h=harness(t),low=scene(),high=structuredClone(low);
  low.lamps[0].intensity=20;high.lamps[0].intensity=100;
  const lowPoints=evaluateScene(low).detectors,highPoints=evaluateScene(high).detectors;
  lowPoints.forEach((point,index)=>assert.ok(highPoints[index].lux>point.lux));
  for(const day of [false,true]){
    const dim=h.render({scene:low,day}),bright=h.render({scene:high,day});
    assert.deepEqual(dim.map(pass=>pass.composite),['multiply','screen']);
    assert.deepEqual(bright.map(pass=>pass.composite),['multiply','screen']);
    let changes=0;
    for(let pass=0;pass<dim.length;pass++) for(let offset=0;offset<dim[pass].raster.data.length;offset++){
      assert.ok(bright[pass].raster.data[offset]>=dim[pass].raster.data[offset],'increasing one source cannot dim a raster channel');
      changes+=bright[pass].raster.data[offset]>dim[pass].raster.data[offset];
    }
    assert.ok(changes>0,'the rendered field responds to the physical intensity change');
  }
});

test('the same lux at a fixed sample keeps the same Room colour even when another part becomes much brighter', t => {
  const h=harness(t),a=scene();
  const shape=h.render({scene:a})[0].raster,column=37,row=32;
  const x=(column+.5)/shape.width*a.width,y=(row+.5)/shape.height*a.depth;
  Object.assign(a.lamps[0],{x,y});Object.assign(a.detectors[0],{x,y});
  const b=structuredClone(a),extra={id:'lamp-b',x:2.2,y:.6,height:.2,intensity:180,enabled:true};
  b.lamps.push(extra);
  const contribution=extra.intensity*extra.height/Math.hypot(extra.x-x,extra.y-y,extra.height)**3;
  b.lamps[0].intensity-=contribution*a.lamps[0].height**2;
  assert.ok(Math.abs(evaluateScene(a).detectors[0].lux-evaluateScene(b).detectors[0].lux)<1e-9);
  for(const day of [false,true]){
    const before=h.render({scene:a,day}),after=h.render({scene:b,day}),index=row*shape.width+column;
    for(let pass=0;pass<before.length;pass++)assert.deepEqual(channel(before[pass].raster,index),channel(after[pass].raster,index),'fixed lux uses a fixed illustrative scale');
    assert.ok(after[1].raster.data.some((value,index)=>index%4===3&&value>before[1].raster.data[index]),'the second lamp increases the field elsewhere');
  }
});

test('disabled, zero-intensity and fully blocked lamps produce no additive Room light or absolute-field light', t => {
  const h=harness(t),disabled=scene(),zero=scene(),blocked=scene();
  disabled.lamps[0].enabled=false;zero.lamps[0].intensity=0;
  blocked.screens=[{id:'screen-a',x1:0,y1:.6,x2:2.4,y2:.6,height:3,enabled:true}];
  for(const current of [disabled,zero,blocked])for(const day of [false,true]){
    assert.equal(evaluateScene(current).maximumLux,0);
    const room=h.render({scene:current,day}),pool=room.find(pass=>pass.composite==='screen');
    assert.ok(pool.raster.data.every((value,index)=>index%4!==3||value===0),'zero direct light has transparent pool pixels');
    const field=h.render({scene:current,day,mode:'field'})[0].raster;
    assert.ok(field.data.every((value,index)=>index%4!==3||value===0),'absolute field has no illuminated samples');
    if(current!==blocked)assert.ok(!h.ctx.operations.some(op=>op.kind==='fill'&&op.path?.radius===4.5&&op.blur>0),'an inactive bulb has no emission glow');
  }
});

test('covered proposals never draw a calculated raster or numeric readings, including a stale comparison state', t => {
  const h=harness(t),a=scene(),b=structuredClone(a);b.lamps[0].height=.7;
  for(const mode of ['layout','field','paths','difference']){
    const passes=h.render({scene:b,mode,proposed:true,comparison:{aScene:a,bScene:b}});
    assert.equal(passes.length,0);
    assert.ok(h.ctx.labels.some(label=>/pending/.test(label.text)));
    assert.ok(h.ctx.labels.every(label=>!/\blx\b/.test(label.text)));
    assert.ok(!h.ctx.operations.some(op=>op.kind==='fill'&&op.path?.radius===4.5&&op.blur>0));
  }
});

test('difference rendering preserves blue decreases, amber increases, reversible strength and transparent neutral samples', t => {
  const h=harness(t),a=scene(),b=structuredClone(a);b.lamps[0].height=.7;
  const forward=h.render({scene:b,mode:'difference',comparison:{aScene:a,bScene:b}});
  const reverse=h.render({scene:a,mode:'difference',comparison:{aScene:b,bScene:a}});
  assert.equal(forward.length,1);assert.equal(reverse.length,1);
  assert.equal(forward[0].composite,'source-over');
  const f=forward[0].raster,r=reverse[0].raster;let blue=0,amber=0;
  for(let index=0;index<f.width*f.height;index++){
    const original=channel(f,index),opposite=channel(r,index);
    assert.equal(original[3],opposite[3]);
    if(original[3]>0){assert.equal(original[2]>original[0],opposite[0]>opposite[2]);blue+=original[2]>original[0];amber+=original[0]>original[2];}
  }
  assert.ok(blue>0&&amber>0,'raising this lamp reduces the near field and increases some distant samples');
  const neutral=h.render({scene:a,mode:'difference',comparison:{aScene:a,bScene:a}})[0].raster;
  assert.ok(neutral.data.every((value,index)=>index%4!==3||value===0));
});

test('reading materials are beneath the live field and handles, and vacate a position occupied by a measurement point', t => {
  const h=harness(t),current=scene();h.render({scene:current});
  const book=h.ctx.operations.find(op=>op.kind==='image'&&op.source.endsWith('/reading-book.png'));
  assert.ok(book,'an unobstructed book is rendered on the roomy table');
  const notebook=h.ctx.operations.find(op=>op.kind==='fill'&&op.style==='#525b3c');
  assert.ok(notebook,'an unobstructed working notebook is rendered');
  const field=h.ctx.operations.find(op=>op.raster);
  assert.ok(book.order<field.order,'decorative paper receives the live field rather than covering it');
  assert.ok(notebook.order<field.order);
  const handles=h.ctx.circles.filter(circle=>circle.radius===14||circle.radius===8);
  for(const material of [book.bounds,notebook.path.bounds])for(const handle of handles){
    const nearestX=Math.max(material.x,Math.min(handle.x,material.x+material.width));
    const nearestY=Math.max(material.y,Math.min(handle.y,material.y+material.height));
    assert.ok(Math.hypot(handle.x-nearestX,handle.y-nearestY)>handle.radius);
    assert.ok(handle.order>field.order,'handles stay visible above the light and paper');
  }
  const [left,right]=h.ctx.circles.filter(circle=>circle.radius===8),scaleX=(right.x-left.x)/(current.detectors[1].x-current.detectors[0].x);
  const tableX=left.x-current.detectors[0].x*scaleX;
  const table=h.ctx.operations.find(op=>op.kind==='image'&&op.raster).bounds,scaleY=table.height/current.depth;
  for(const material of [book.bounds,notebook.path.bounds]){
    Object.assign(current.detectors[0],{x:(material.x+material.width/2-tableX)/scaleX,y:(material.y+material.height/2-table.y)/scaleY});
    h.render({scene:current});
    const obscuring=h.ctx.operations.some(op=>material===book.bounds ? op.kind==='image'&&op.source.endsWith('/reading-book.png') : op.kind==='fill'&&op.style==='#525b3c');
    assert.ok(!obscuring,'the material yields to a live point instead of obstructing it');
    const reading=evaluateScene(current).detectors[0].lux.toFixed(1);
    assert.ok(h.ctx.labels.some(label=>label.text===`A · ${reading} lx`));
  }
});
