import { BuffEffectEntry } from './buff-effect';
import { CharacterActionState } from './character-action-state';
import { RoomEffectState } from './room-effect-state';

describe('RoomEffectState', () => {
  const strength: BuffEffectEntry = {
    kind: 'stat',
    statusName: '筋力',
    operator: '+',
    amount: 2,
    description: '',
  };
  const armor: BuffEffectEntry = {
    kind: 'stat',
    statusName: '防護',
    operator: '+',
    amount: 1,
    description: '',
  };

  it('uses the same identifier for the same effect regardless of entry order', () => {
    let first = RoomEffectState.identifierFor('character-1', 3, '戦闘態勢', [strength, armor]);
    let second = RoomEffectState.identifierFor('character-1', 3, '戦闘態勢', [armor, strength]);

    expect(first).toBe(second);
  });

  it('separates effects by target and battle sequence', () => {
    let base = RoomEffectState.identifierFor('character-1', 3, '強化', [strength]);
    let otherTarget = RoomEffectState.identifierFor('character-2', 3, '強化', [strength]);
    let otherBattle = RoomEffectState.identifierFor('character-1', 4, '強化', [strength]);

    expect(base).not.toBe(otherTarget);
    expect(base).not.toBe(otherBattle);
  });

  it('calculates remaining rounds from the shared round', () => {
    let state = new RoomEffectState('effect-test');
    state.targetIdentifier = 'character-1';
    state.name = '強化';
    state.entries = [strength];
    state.createdRound = 2;
    state.expiresAtRound = 5;

    expect(state.toBuffEffect(3).remainingRounds).toBe(2);
    expect(state.toBuffEffect(5).remainingRounds).toBe(0);
  });
});

describe('CharacterActionState', () => {
  it('uses one independent state identifier per character', () => {
    expect(CharacterActionState.identifierFor('character-1')).not.toBe(CharacterActionState.identifierFor('character-2'));
  });
});

