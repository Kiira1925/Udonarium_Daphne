import { CharacterActionState } from './character-action-state';
import { ChatMessage } from './chat-message';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import { RoomState } from './room-state';

describe('RoomState action exclusion', () => {
  let room: RoomState;
  let first: GameCharacter;
  let second: GameCharacter;

  beforeEach(() => {
    room = new RoomState('room-exclusion-test');
    room.round = 1;
    first = new GameCharacter('action-exclusion-first');
    second = new GameCharacter('action-exclusion-second');
    spyOn(room, 'tableCharacters').and.returnValue([first, second]);
    spyOn<any>(room, 'sendRoundAnnouncement');
    spyOn<any>(room, 'sendMainSystemMessage');
    spyOn<any>(room, 'sendSystemMessage');
  });

  afterEach(() => {
    for (let character of [first, second]) {
      let state = ObjectStore.instance.get<CharacterActionState>(CharacterActionState.identifierFor(character.identifier));
      if (state) ObjectStore.instance.remove(state);
      if (ObjectStore.instance.get(character.identifier)) ObjectStore.instance.remove(character);
    }
  });

  it('counts excluded characters as done across rounds while ordinary completion expires', () => {
    room.setActionExcludedForCharacters([first], true);
    expect(room.isActionDone(first)).toBe(true);
    expect(room.actionDoneCharacterIds).toEqual([first.identifier]);
    expect(room.actionDoneCount()).toBe(1);
    expect(room.actionTargetCount()).toBe(2);
    expect(room.canAdvanceRound()).toBe(false);

    room.setActionDone(second, true);
    expect(room.canAdvanceRound()).toBe(true);
    room.incrementRound();
    expect(room.isActionDone(first)).toBe(true);
    expect(room.isActionDone(second)).toBe(false);
    expect(room.actionDoneCount()).toBe(1);
    expect(room.canAdvanceRound()).toBe(false);
  });

  it('keeps exclusion when completion is cleared and returns to pending when exclusion is removed', () => {
    room.setActionDone(first, true);
    room.setActionExcludedForCharacters([first], true);
    room.setActionDone(first, false);
    expect(room.toggleActionDone(first)).toBe(true);
    expect(room.isActionExcluded(first)).toBe(true);
    room.setActionExcludedForCharacters([first], false);
    expect(room.isActionDone(first)).toBe(false);
  });

  it('can exclude before combat starts and does not restore exclusion after battle reset', () => {
    room.round = 0;
    room.setActionExcludedForCharacters([first, second], true);
    room.incrementRound();
    expect(room.canAdvanceRound()).toBe(true);
    room.resetBattle();
    room.incrementRound();
    expect(room.isActionExcluded(first)).toBe(false);
    room.setActionDone(first, true);
    room.incrementRound();
    expect(room.isActionExcluded(first)).toBe(false);
    expect(room.isActionDone(first)).toBe(false);
  });

  it('shares exclusion in a single character context and restores it on a peer', () => {
    room.setActionExcludedForCharacters([first], true);
    let state = ObjectStore.instance.get<CharacterActionState>(CharacterActionState.identifierFor(first.identifier));
    let peerState = new CharacterActionState(state.identifier);
    peerState.apply(state.toContext());
    expect(peerState.characterIdentifier).toBe(first.identifier);
    expect(peerState.battleSequence).toBe(room.battleSequence);
    expect(peerState.excluded).toBe(true);
    expect(peerState.completedRound).toBe(0);
  });

  it('defaults older action contexts to participating', () => {
    let state = new CharacterActionState(CharacterActionState.identifierFor(first.identifier));
    state.characterIdentifier = first.identifier;
    state.battleSequence = room.battleSequence;
    state.completedRound = room.round;
    let context = state.toContext();
    delete context.syncData['excluded'];
    state.apply(context);
    ObjectStore.instance.add(state, false);
    expect(room.isActionExcluded(first)).toBe(false);
    expect(room.isActionDone(first)).toBe(true);
    room.incrementRound();
    expect(room.isActionDone(first)).toBe(false);
  });

  it('targets selected characters first and the sender otherwise', () => {
    ObjectStore.instance.add(first, false);
    let message = new ChatMessage('exclude-command-test');
    message.sourceIdentifier = first.identifier;
    let selection = spyOn(room, 'selectedCharacters').and.returnValue([second]);
    expect((room as any).handleExcludeCommand('/exclude', message, '')).toBe(true);
    expect(room.isActionExcluded(second)).toBe(true);
    expect(room.isActionExcluded(first)).toBe(false);

    selection.and.returnValue([]);
    (room as any).handleExcludeCommand('/EXCLUDE ON', message, '');
    expect(room.isActionExcluded(first)).toBe(true);
    (room as any).handleExcludeCommand('/exclude off', message, '');
    expect(room.isActionDone(first)).toBe(false);
    expect(room.isActionExcluded(second)).toBe(true);
  });

  it('rejects invalid commands and missing targets without changing action state', () => {
    spyOn(room, 'selectedCharacters').and.returnValue([]);
    let message = new ChatMessage('exclude-invalid-test');
    expect((room as any).handleExcludeCommand('/exclude later', message, '')).toBe(true);
    expect((room as any).handleExcludeCommand('/exclude', message, '')).toBe(true);
    expect((room as any).handleExcludeCommand('/excluded', message, '')).toBe(false);
    expect(room.actionDoneCount()).toBe(0);
    expect((room as any).sendSystemMessage).toHaveBeenCalledTimes(2);
  });

  it('announces only changed exclusions when repeating a bulk command', () => {
    room.setActionExcludedForCharacters([first, second], true, true);
    room.setActionExcludedForCharacters([first, second], true, true);
    expect((room as any).sendMainSystemMessage).toHaveBeenCalledTimes(2);
  });
});
