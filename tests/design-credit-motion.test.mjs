import test from 'node:test';
import assert from 'node:assert/strict';
import { CREDIT_HOLD, CREDIT_STEP, DESIGN_CREDIT_TEXT, DesignCreditMotion } from '../src/design-credit-motion.ts';

const count=frame=>frame.blocked.filter(Boolean).length;

test('each character slot, including both spaces, becomes a block exactly once',()=>{
  const motion=new DesignCreditMotion(DESIGN_CREDIT_TEXT.length,()=>0),changed=[];let previous=Array(13).fill(false);
  assert.equal(DESIGN_CREDIT_TEXT.toUpperCase(),'DSGND BY WHEN'); assert.equal(count(motion.sample(5999)),0);
  for(let step=0;step<13;step++) {
    const frame=motion.sample(6000+step*CREDIT_STEP);assert.equal(count(frame),step+1);
    const delta=frame.blocked.flatMap((blocked,index)=>blocked&&!previous[index]?[index]:[]);assert.equal(delta.length,1);changed.push(delta[0]);previous=frame.blocked;
  }
  assert.equal(new Set(changed).size,13);assert.ok(changed.includes(5)&&changed.includes(8));
});

test('all blocks hold for half a second and restore one unique slot per step',()=>{
  const motion=new DesignCreditMotion(13,()=>0),holdStart=6000+12*CREDIT_STEP,restoreStart=holdStart+CREDIT_HOLD;
  motion.sample(6000);assert.equal(CREDIT_HOLD,500);
  assert.equal(motion.sample(holdStart).phase,'hold');assert.equal(count(motion.sample(restoreStart-1)),13);
  let previous=Array(13).fill(true);const changed=[];
  for(let step=0;step<13;step++) {
    const frame=motion.sample(restoreStart+step*CREDIT_STEP);assert.equal(count(frame),12-step);
    const delta=frame.blocked.flatMap((blocked,index)=>!blocked&&previous[index]?[index]:[]);assert.equal(delta.length,1);changed.push(delta[0]);previous=frame.blocked;
  }
  assert.equal(new Set(changed).size,13);assert.equal(motion.sample(restoreStart+12*CREDIT_STEP).phase,'idle');
});

test('the credit remains normal between occasional events',()=>{
  const motion=new DesignCreditMotion(13,()=>0);motion.sample(6000);
  for(let time=8500;time<20000;time+=100) assert.equal(count(motion.sample(time)),0);
});
