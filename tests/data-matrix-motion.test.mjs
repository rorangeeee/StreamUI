import test from 'node:test';
import assert from 'node:assert/strict';
import { DataMatrixMotion, MATRIX_HOLD, MATRIX_IDLE, MATRIX_STEP, matrixDiagonal, matrixDiagonalFilled, sampleMatrixSweep } from '../src/data-matrix-motion.ts';
import { DATA_MATRIX_CONTENT, DATA_MATRIX_ROWS } from '../src/data-matrix-data.ts';

test('the 3 by 3 wave follows the specified lower-left diagonal order', () => {
  assert.deepEqual([0,1,2,3,4].map(diagonal => matrixDiagonal(3,diagonal).map(({x,y}) => [x,y])), [
    [[0,0]], [[0,1],[1,0]], [[0,2],[1,1],[2,0]], [[1,2],[2,1]], [[2,2]],
  ]);
});

test('every diagonal fills cumulatively, holds black for one second, then restores in the same direction', () => {
  const size=3,last=4,holdStart=MATRIX_IDLE+last*MATRIX_STEP,restoreStart=holdStart+MATRIX_HOLD;
  for(let diagonal=0;diagonal<last;diagonal++) {
    const filled=sampleMatrixSweep(MATRIX_IDLE+diagonal*MATRIX_STEP,size);
    assert.deepEqual([0,1,2,3,4].map(index=>matrixDiagonalFilled(filled,index)), [0,1,2,3,4].map(index=>index<=diagonal));
  }
  assert.equal(MATRIX_HOLD,1000);
  assert.equal(sampleMatrixSweep(holdStart,size).phase,'hold');
  assert.equal(sampleMatrixSweep(restoreStart-1,size).phase,'hold');
  assert.deepEqual([0,1,2,3,4].map(index=>matrixDiagonalFilled(sampleMatrixSweep(restoreStart,size),index)),[false,true,true,true,true]);
  assert.equal(sampleMatrixSweep(restoreStart+last*MATRIX_STEP,size).phase,'idle');
});

test('a rare color glitch flashes exactly twice and returns to the normal black state', () => {
  const motion=new DataMatrixMotion(14,()=>0);
  assert.deepEqual([6999,7000,7079,7080,7159,7160,7239,7240,8000].map(time=>motion.sample(time).highlighted),[false,true,true,false,false,true,true,false,false]);
});

test('the pre-generated LATENITE symbol has a square grid and its ECC200 finder borders', () => {
  assert.equal(DATA_MATRIX_CONTENT,'LATENITE'); assert.equal(DATA_MATRIX_ROWS.length,14);
  assert.ok(DATA_MATRIX_ROWS.every(row=>row.length===14&&/^[01]+$/.test(row)));
  assert.ok(DATA_MATRIX_ROWS.every(row=>row[0]==='1'));
  assert.equal(DATA_MATRIX_ROWS.at(-1),'11111111111111');
  assert.equal(DATA_MATRIX_ROWS[0],'10101010101010');
});
