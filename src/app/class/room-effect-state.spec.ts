import { BuffEffectEntry } from './buff-effect';
import { CharacterActionState } from './character-action-state';
import { RoomBuffTemplateState } from './room-buff-template-state';
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

  it('refreshes all shared fields together', () => {
    let state = new RoomEffectState('effect-refresh-test');
    state.active = false;
    state.createdRound = 1;
    state.expiresAtRound = 2;

    state.refresh(4, 3);

    let context = state.toContext();
    expect(context.syncData['active']).toBe(true);
    expect(context.syncData['createdRound']).toBe(4);
    expect(context.syncData['expiresAtRound']).toBe(7);
  });
});

describe('CharacterActionState', () => {
  it('uses one independent state identifier per character', () => {
    expect(CharacterActionState.identifierFor('character-1')).not.toBe(CharacterActionState.identifierFor('character-2'));
  });

  it('sets battle sequence and completed round together', () => {
    let state = new CharacterActionState('action-test');
    state.battleSequence = 1;
    state.completedRound = 1;

    state.setCompleted(2, 0);

    let context = state.toContext();
    expect(context.syncData['battleSequence']).toBe(2);
    expect(context.syncData['completedRound']).toBe(0);
  });
});

describe('RoomBuffTemplateState', () => {
  it('updates all template fields together', () => {
    let templateStrength: BuffEffectEntry = {
      kind: 'stat',
      statusName: 'Strength',
      operator: '+',
      amount: 2,
      description: '',
    };
    let templateArmor: BuffEffectEntry = {
      kind: 'stat',
      statusName: 'Armor',
      operator: '+',
      amount: 1,
      description: '',
    };
    let state = new RoomBuffTemplateState('template-test');
    state.updateFrom({
      ownerIdentifier: 'character-1',
      name: 'template',
      effects: [templateStrength, templateArmor],
      kind: 'stat',
      statusName: 'Strength',
      operator: '+',
      amount: 2,
      description: '',
      durationRounds: 5,
    });

    let context = state.toContext();
    expect(context.syncData['ownerIdentifier']).toBe('character-1');
    expect(context.syncData['name']).toBe('template');
    expect(context.syncData['entries']).toEqual([templateStrength, templateArmor]);
    expect(context.syncData['durationRounds']).toBe(5);
  });
});
