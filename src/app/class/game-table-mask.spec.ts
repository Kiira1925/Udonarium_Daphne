import { GameTableMask, GameTableMaskScratchArea } from './game-table-mask';

describe('GameTableMask scratch areas', () => {
  it('parses and clips scratch areas to the mask grid', () => {
    let areas = GameTableMask.parseScratchData('-1,0,3,2;3,3,4,4;invalid', 5, 5);

    expect(areas).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 3, y: 3, width: 2, height: 2 },
    ]);
  });

  it('merges adjacent areas that share the same rows', () => {
    let mask = GameTableMask.create('test', 5, 5, 100);

    mask.addScratchArea({ x: 0, y: 1, width: 2, height: 1 });
    mask.addScratchArea({ x: 2, y: 1, width: 2, height: 1 });

    expect(mask.scratchData).toBe('0,1,4,1');
    expect(mask.scratchAreas).toEqual([{ x: 0, y: 1, width: 4, height: 1 }]);
  });

  it('does not change shared data for an invalid area', () => {
    let mask = GameTableMask.create('test', 2, 2, 100);
    mask.scratchData = '0,0,1,1';
    let invalid: GameTableMaskScratchArea = { x: 3, y: 3, width: 1, height: 1 };

    expect(mask.addScratchArea(invalid)).toBe(false);
    expect(mask.scratchData).toBe('0,0,1,1');
  });

  it('keeps scratch data when cloning a mask', () => {
    let mask = GameTableMask.create('test', 3, 3, 100);
    mask.addScratchArea({ x: 1, y: 1, width: 2, height: 2 });

    let clone = mask.clone();

    expect(clone.scratchData).toBe('1,1,2,2');
    expect(clone.scratchAreas).toEqual([{ x: 1, y: 1, width: 2, height: 2 }]);
  });

  it('records the commit token together with the published area', () => {
    let mask = GameTableMask.create('test', 3, 3, 100);

    expect(mask.commitScratchArea({ x: 0, y: 1, width: 2, height: 1 }, 'commit-token')).toBe(true);
    expect(mask.scratchData).toBe('0,1,2,1');
    expect(mask.scratchCommitToken).toBe('commit-token');
    expect(mask.scratchLockGeneration).toBe(1);
  });

  it('restores the selected cells inside a published area', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    mask.addScratchArea({ x: 0, y: 0, width: 4, height: 4 });

    expect(mask.restoreScratchArea({ x: 1, y: 1, width: 2, height: 2 })).toBe(true);
    expect(mask.scratchAreas).toEqual([
      { x: 0, y: 0, width: 4, height: 1 },
      { x: 0, y: 1, width: 1, height: 2 },
      { x: 3, y: 1, width: 1, height: 2 },
      { x: 0, y: 3, width: 4, height: 1 },
    ]);
  });

  it('records a restore commit and rejects an older revealed state', () => {
    let mask = GameTableMask.create('test', 3, 3, 100);
    mask.commitScratchArea({ x: 0, y: 0, width: 3, height: 3 }, 'reveal-token');
    let staleRevealedContext = mask.toContext();

    expect(mask.commitScratchArea(
      { x: 1, y: 1, width: 1, height: 1 },
      'restore-token',
      1,
      'restore'
    )).toBe(true);
    mask.apply(staleRevealedContext);

    expect(mask.scratchAreas.some(area =>
      area.x <= 1 && 1 < area.x + area.width
      && area.y <= 1 && 1 < area.y + area.height
    )).toBe(false);
    expect(mask.scratchCommitToken).toBe('restore-token');
    expect(mask.scratchLockGeneration).toBe(2);
  });

  it('advances a lock generation only from the expected value', () => {
    let mask = GameTableMask.create('test', 3, 3, 100);

    expect(mask.advanceScratchLockGeneration(1)).toBe(false);
    expect(mask.advanceScratchLockGeneration(0)).toBe(true);
    expect(mask.advanceScratchLockGeneration(0)).toBe(false);
    expect(mask.scratchLockGeneration).toBe(1);
  });

  it('does not roll back published areas or lock generation from a stale context', () => {
    let mask = GameTableMask.create('test', 3, 3, 100);
    let staleContext = mask.toContext();
    mask.commitScratchArea({ x: 1, y: 1, width: 1, height: 1 }, 'new-token');

    mask.apply(staleContext);

    expect(mask.scratchAreas).toEqual([{ x: 1, y: 1, width: 1, height: 1 }]);
    expect(mask.scratchCommitToken).toBe('new-token');
    expect(mask.scratchLockGeneration).toBe(1);
  });
});
