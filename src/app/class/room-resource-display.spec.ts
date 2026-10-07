import { EventSystem } from './core/system';
import { GameCharacter } from './game-character';
import { RoomState } from './room-state';

describe('RoomState resource change display', () => {
  let room: RoomState;
  let character: GameCharacter;
  let notify: jasmine.Spy;

  beforeEach(() => {
    room = new RoomState('resource-display-test');
    character = GameCharacter.create('target', 1, '');
    character.rootDataElement.getFirstElementByName('HP').currentValue = 20;
    spyOn<any>(room, 'sendResourceSystemMessage');
    notify = spyOn(EventSystem, 'call');
  });

  afterEach(() => character.destroy());

  function execute(name: string, operator: string, expression: string) {
    return (room as any).executeResourceCommand({ resourceName: name, operator, expression }, character);
  }

  function notifications() {
    return notify.calls.allArgs().filter(args => args[0] === 'RESOURCE_VALUE_CHANGED').map(args => args[1]);
  }

  it('defaults to HP and sends the actual damage to all peers', async () => {
    await execute('HP', '-', '4');
    expect(notifications()).toEqual([{
      characterIdentifier: character.identifier, resourceName: 'HP', delta: -4, isStatusHidden: false,
    }]);
  });

  it('uses the actual recovery after applying the maximum', async () => {
    let hp = character.rootDataElement.getFirstElementByName('HP');
    hp.value = 25;
    await execute('HP', '+', '30M');
    expect(notifications()[0].delta).toBe(5);
  });

  it('computes differences for assignment, multiplication and decimal division', async () => {
    await execute('HP', '=', '10');
    await execute('HP', '*', '2');
    await execute('HP', '/', '3');
    expect(notifications().map(change => change.delta)).toEqual([-10, 10, -13.3333]);
  });

  it('does not send changes for zero, reversed damage or failed expressions', async () => {
    await execute('HP', '+', '0');
    await execute('HP', '-', '4+6!');
    await execute('HP', '/', '0');
    await execute('HP', '+', 'invalid');
    expect(notifications()).toEqual([]);
  });

  it('applies named room targets to every character and ignores other resources', async () => {
    await execute('MP', '-', '2');
    expect(notifications()).toEqual([]);
    room.resourceDisplayNames = ' hp,ｍｐ ';
    await execute('MP', '-', '2');
    expect(notifications()[0].resourceName).toBe('MP');
    room.resourceDisplayNames = 'MP';
    notify.calls.reset();
    await execute('HP', '-', '2');
    expect(notifications()).toEqual([]);
  });

  it('includes the hidden status at command execution time', async () => {
    character.isStatusHidden = true;
    await execute('HP', '-', '4');
    expect(notifications()[0].isStatusHidden).toBeTrue();
  });

  it('shares the target setting in room context and resets old saves to HP', () => {
    room.resourceDisplayNames = 'HP,MP';
    let peer = new RoomState(room.identifier);
    peer.apply(room.toContext());
    expect(peer.isResourceDisplayTarget('MP')).toBeTrue();
    let legacy = room.toContext();
    delete legacy.syncData['resourceDisplayNames'];
    peer.apply(legacy);
    expect(peer.resourceDisplayNames).toBe('HP');
    peer.resourceDisplayNames = 'MP';
    peer.resetForRoomLoad();
    expect(peer.resourceDisplayNames).toBe('HP');
  });
});
