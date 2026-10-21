import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRect, localPoint, normalizeAngle, resizeRect } from '../src/window-geometry.ts';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const pointOnWindow = (rect, x, y) => {
  const angle = rect.angle * Math.PI / 180;
  const dx = x - rect.width / 2;
  const dy = y - rect.height / 2;
  return { x: rect.x + rect.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: rect.y + rect.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
};

test('screen coordinates map back to the rotated window at any angle', () => {
  for (const angle of [-179, -90, -25, 0, 30, 90, 179]) {
    const rect = { x: 170, y: 140, width: 500, height: 240, angle };
    for (const [x, y] of [[0, 0], [500, 240], [250, 120], [0, 120]]) {
      const screen = pointOnWindow(rect, x, y);
      const local = localPoint(rect, screen.x, screen.y);
      near(local.x, x);
      near(local.y, y);
    }
  }
});

test('resizing each rotated corner fixes the opposite corner in place', () => {
  for (const angle of [-70, 0, 35, 90, 145]) {
    const rect = { x: 200, y: 180, width: 440, height: 220, angle };
    for (const edges of [{ right: true, bottom: true }, { left: true, top: true }, { right: true, top: true }, { left: true, bottom: true }]) {
      const before = pointOnWindow(rect, edges.left ? rect.width : 0, edges.top ? rect.height : 0);
      const resized = resizeRect(rect, edges, 32, 23);
      const after = pointOnWindow(resized, edges.left ? resized.width : 0, edges.top ? resized.height : 0);
      near(after.x, before.x);
      near(after.y, before.y);
      near(resized.angle, angle);
    }
  }
});

test('minimum dimensions keep the opposite corner anchored', () => {
  const rect = { x: 200, y: 200, width: 400, height: 200, angle: 35 };
  const before = pointOnWindow(rect, rect.width, rect.height);
  const resized = resizeRect(rect, { left: true, top: true }, 10000, 10000);
  assert.equal(resized.width, 220);
  assert.equal(resized.height, 120);
  const after = pointOnWindow(resized, resized.width, resized.height);
  near(before.x, after.x);
  near(before.y, after.y);
});

test('fitting keeps every rotated corner inside the workspace when it fits', () => {
  for (const angle of [-170, -90, -40, 0, 30, 80, 155]) {
    const rect = { x: -120, y: 900, width: 440, height: 220, angle };
    fitRect(rect, 1280, 720);
    for (const [x, y] of [[0, 0], [440, 0], [0, 220], [440, 220]]) {
      const point = pointOnWindow(rect, x, y);
      assert.ok(point.x >= -1e-8 && point.x <= 1280 + 1e-8);
      assert.ok(point.y >= -1e-8 && point.y <= 720 + 1e-8);
    }
  }
});

test('an oversized rotated window stays reachable without changing its size', () => {
  const rect = { x: 100, y: 50, width: 1100, height: 400, angle: 90 };
  fitRect(rect, 1280, 720);
  near(rect.y + rect.height / 2, 360);
  assert.equal(rect.width, 1100);
  assert.equal(rect.height, 400);
});

test('rotation wraps cleanly through a full turn in either direction', () => {
  for (const [input, expected] of [[0, 0], [370, 10], [-370, -10], [180, -180], [1080, 0]]) near(normalizeAngle(input), expected);
});
