import test from 'node:test';
import assert from 'node:assert/strict';
import {mountStudio} from '../studio-ui.js';
import {createStudy, commitExperiment, saveAlternative} from '../studies.js';
import {LIGHT_SOURCES} from '../optics.js';

// A DOM boundary double exercises the installed delegated handlers and focus
// targets. Actual room hit testing is covered at the renderer boundary.
function mount(t, state, {reducedMotion = true} = {}) {
  const originals=new Map(), nodes=new Map(), events=new Map();
  const replace=(name,value)=>{
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  };
  const document={activeElement:null};
  function node(id) {
    if(nodes.has(id))return nodes.get(id);
    const item={id,dataset:{},style:{},attributes:new Map(),innerHTML:'',textContent:'',open:false,
      setAttribute(name,value){this.attributes.set(name,value);},
      focus(options){document.activeElement=this;this.focusOptions=options;},
      scrollIntoView(options){this.scrollOptions=options;},
      showModal(){this.open=true;},close(){this.open=false;},
      querySelector(selector){return selector==='.dialog-close'?node('dialog-close'):null;},
      addEventListener(){},removeEventListener(){},getContext(){return null;},
      getBoundingClientRect(){return {left:0,top:0,width:0,height:0};}
    };
    nodes.set(id,item);return item;
  }
  const root={innerHTML:'',querySelector(selector){return selector.startsWith('#')?node(selector.slice(1)):selector==='.studio-stage'?node('studio-stage'):null;},
    addEventListener(type,handler){events.set(type,handler);},
    removeEventListener(type,handler){if(events.get(type)===handler)events.delete(type);}
  };
  replace('document',document);
  replace('Image',class {addEventListener(){}removeEventListener(){}});
  replace('ResizeObserver',class {observe(){}disconnect(){}});
  replace('matchMedia',()=>({matches:reducedMotion}));
  const view=mountStudio(root,{getState:()=>state,commitState(){throw Error('Navigation must not write a study.');}});
  t.after(()=>{
    view.destroy();
    for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  });
  return {view,document,nodes,events,
    click(action){const target={dataset:{studio:action},disabled:false,hasAttribute(){return false;},closest(selector){return selector==='button'?this:null;}};events.get('click')?.({target});}
  };
}

function retainedState() {
  const study=createStudy({projectId:'shortcut-project'});
  saveAlternative(study,'Retained original');
  commitExperiment(study,{detectorId:'point-a',prediction:'increase',hypothesis:'Lower one lamp while the points stay fixed.'});
  return {projects:[{id:'shortcut-project',title:'A shared reading place'}],settings:{night:true},sources:[],studio:{version:1,activeStudyId:study.id,studies:[study]}};
}

test('Study record navigation focuses retained evidence without writing or altering a committed prediction',t=>{
  const state=retainedState(),before=structuredClone(state),h=mount(t,state);
  h.click('record');
  const record=h.nodes.get('studio-record');
  assert.equal(h.document.activeElement,record);
  assert.deepEqual(record.focusOptions,{preventScroll:true});
  assert.deepEqual(record.scrollOptions,{behavior:'auto',block:'start'});
  assert.deepEqual(state,before,'read-only navigation keeps the scene, saved layout and prediction intact');
  h.click('return-table');
  assert.equal(h.document.activeElement,h.nodes.get('studio-canvas'));
  assert.deepEqual(h.nodes.get('studio-canvas').focusOptions,{preventScroll:true});
  assert.deepEqual(h.nodes.get('studio-stage').scrollOptions,{behavior:'auto',block:'start'});
  assert.deepEqual(state,before,'the return trip restores keyboard access without changing the study');
});

test('the Field guide shortcut opens the real cited model guide, with modal focus and no changes to evidence',t=>{
  const state=retainedState(),before=structuredClone(state),h=mount(t,state);
  h.click('guide');
  assert.equal(h.nodes.get('studio-dialog').open,true);
  assert.equal(h.nodes.get('studio-dialog-title').textContent,'A field guide to useful light');
  const guide=h.nodes.get('studio-dialog-body').innerHTML;
  LIGHT_SOURCES.forEach(source=>assert.ok(guide.includes(source.url),'the guide retains each real scientific source'));
  assert.ok(guide.includes('Day/night appearance does not add ambient light or change the calculations.'));
  assert.equal(h.document.activeElement.id,'dialog-close');
  assert.deepEqual(state,before);
  h.click('close-dialog');assert.equal(h.nodes.get('studio-dialog').open,false);
});

test('record navigation respects motion preferences and disposed studio handlers cannot reopen content',t=>{
  const state=retainedState(),h=mount(t,state,{reducedMotion:false});
  h.click('record');assert.equal(h.nodes.get('studio-record').scrollOptions.behavior,'smooth');
  h.click('return-table');assert.equal(h.nodes.get('studio-stage').scrollOptions.behavior,'smooth');
  h.view.destroy();assert.equal(h.events.size,0);
  h.click('guide');assert.ok(!h.nodes.get('studio-dialog').open);
});
