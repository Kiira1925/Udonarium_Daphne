import { ChangeDetectorRef } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { EventSystem } from '@udonarium/core/system';
import { ResourceChangeEvent } from '@udonarium/core/system/event/observer';
import { GameCharacter } from '@udonarium/game-character';
import { RoomState } from '@udonarium/room-state';
import { GameCharacterComponent } from './game-character.component';

describe('GameCharacter resource change animation', () => {
  let component: GameCharacterComponent;
  let gm: jasmine.Spy;

  beforeEach(() => {
    let detector = jasmine.createSpyObj<ChangeDetectorRef>('detector', ['markForCheck', 'detectChanges']);
    component = new GameCharacterComponent(null, null, detector, null, null, null);
    component.gameCharacter = new GameCharacter();
    gm = spyOn(RoomState.instance, 'isGM').and.returnValue(false);
    spyOn(RoomState.instance, 'canAccessGMCharacter').and.returnValue(true);
    component.ngOnChanges();
  });

  afterEach(() => component.ngOnDestroy());

  function send(overrides: Partial<ResourceChangeEvent> = {}) {
    EventSystem.trigger('RESOURCE_VALUE_CHANGED', {
      characterIdentifier: component.gameCharacter.identifier, resourceName: 'HP', delta: -4,
      isStatusHidden: false, ...overrides,
    });
  }

  it('receives peer changes, formats signed numbers and expires each independently', fakeAsync(() => {
    send();
    tick(400);
    send({ delta: 3 });
    expect(component.visibleResourceChanges.map(change => change.text)).toEqual(['-4', '+3']);
    expect(component.resourceChanges.map(change => change.lane)).toEqual([0, 1]);
    tick(1300);
    expect(component.visibleResourceChanges.map(change => change.text)).toEqual(['+3']);
    tick(400);
    expect(component.resourceChanges).toEqual([]);
  }));

  it('ignores other characters, zero and invalid values', () => {
    send({ characterIdentifier: 'other' });
    send({ delta: 0 });
    send({ delta: NaN });
    expect(component.resourceChanges).toEqual([]);
  });

  it('hides private values from non-GM even when the character update is delayed', () => {
    send({ isStatusHidden: true });
    expect(component.resourceChanges).toEqual([]);
    component.gameCharacter.isStatusHidden = true;
    send();
    expect(component.resourceChanges).toEqual([]);
    gm.and.returnValue(true);
    send({ isStatusHidden: true });
    expect(component.visibleResourceChanges.length).toBe(1);
    gm.and.returnValue(false);
    expect(component.visibleResourceChanges).toEqual([]);
  });

  it('removes finished animations and cancels timers on destroy', fakeAsync(() => {
    send();
    component.removeResourceChange(component.resourceChanges[0].id);
    expect(component.resourceChanges).toEqual([]);
    send();
    component.ngOnDestroy();
    tick(2000);
    expect(component.resourceChanges).toEqual([]);
    send();
    expect(component.resourceChanges).toEqual([]);
  }));
});
