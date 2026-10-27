import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATOR_BREATH_PERIOD, LOCATOR_LINE_LENGTH, LOCATOR_RADIUS, LOCATOR_WIPE_DURATION, LocatorMotion, locatorRingWidth, locatorRotation, locatorStrokeWindow } from '../src/locator-motion.ts';

test('the circle breathes smoothly between 1 and 4 without changing its radius', () => {
  assert.equal(locatorRingWidth(0),1); assert.equal(locatorRingWidth(LOCATOR_BREATH_PERIOD/2),4); assert.equal(locatorRingWidth(LOCATOR_BREATH_PERIOD),1);
  for(let time=0;time<30000;time+=20) assert.ok(locatorRingWidth(time)>=1 && locatorRingWidth(time)<=4);
  assert.ok(LOCATOR_LINE_LENGTH>2*(LOCATOR_RADIUS+2)*Math.SQRT2);
});

test('X rotation never stops or reverses, and acceleration pulses do not reset the angle', () => {
  let previous=locatorRotation(0).angle, minimum=Infinity, maximum=0;
  for(let time=20;time<50000;time+=20) {
    const frame=locatorRotation(time); assert.ok(frame.angle>previous); previous=frame.angle;
    minimum=Math.min(minimum,frame.angularSpeed); maximum=Math.max(maximum,frame.angularSpeed);
    assert.ok(frame.angularSpeed>=5 && frame.angularSpeed<=40);
    const measured=(locatorRotation(time+.01).angle-locatorRotation(time-.01).angle)/.00002;
    assert.ok(Math.abs(measured-frame.angularSpeed)<.0001);
  }
  assert.equal(minimum,5); assert.ok(maximum>39.99);
});

test('a stroke has a solid cut that moves A to B, then reveals again from A', () => {
  assert.deepEqual(locatorStrokeWindow(-1),{start:0,end:1,phase:'idle'});
  const early=locatorStrokeWindow(LOCATOR_WIPE_DURATION/4), middle=locatorStrokeWindow(LOCATOR_WIPE_DURATION/2);
  assert.ok(early.start>0&&early.start<.1); assert.equal(early.end,1); assert.equal(middle.start,.5);
  assert.deepEqual(locatorStrokeWindow(LOCATOR_WIPE_DURATION),{start:0,end:0,phase:'reveal'});
  assert.deepEqual(locatorStrokeWindow(LOCATOR_WIPE_DURATION*1.5),{start:0,end:.5,phase:'reveal'});
  assert.deepEqual(locatorStrokeWindow(LOCATOR_WIPE_DURATION*2),{start:0,end:1,phase:'idle'});
});

test('paired wipes are delayed by 0.8–1 seconds and cannot change the ring or rotation clocks', () => {
  const first=new LocatorMotion(()=>0), second=new LocatorMotion(()=>.9);
  first.sample(8000);
  const staggered=first.sample(8500); assert.equal(staggered.delay,800);
  assert.equal(staggered.strokes[0].phase,'erase'); assert.equal(staggered.strokes[1].phase,'idle');
  assert.equal(first.sample(8800).strokes[1].phase,'erase');
  for(let time=9000;time<50000;time+=100) {
    const a=first.sample(time),b=second.sample(time);
    assert.equal(a.ringWidth,b.ringWidth); assert.equal(a.angle,b.angle); assert.equal(a.angularSpeed,b.angularSpeed);
    if(a.wiping) assert.ok(a.delay>=800&&a.delay<=1000);
    if(b.wiping) assert.ok(b.delay>=800&&b.delay<=1000);
  }
});
