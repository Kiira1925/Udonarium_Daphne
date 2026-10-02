import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RoomState } from '@udonarium/room-state';
import { PanelService } from 'service/panel.service';
import { EffectManagementComponent } from './effect-management.component';

describe('EffectManagementComponent reset confirmation', () => {
  let fixture: ComponentFixture<EffectManagementComponent>;
  let component: EffectManagementComponent;
  let room: RoomState;
  let reset: jasmine.Spy;
  let isGM: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EffectManagementComponent],
      imports: [CommonModule, FormsModule],
      providers: [{ provide: PanelService, useValue: { title: '' } }],
    }).compileComponents();
    room = new RoomState('reset-confirmation-test');
    room.round = 2;
    isGM = spyOn(room, 'isGM').and.returnValue(true);
    spyOn(room, 'canAdvanceRound').and.returnValue(true);
    spyOn(room, 'incrementRound');
    reset = spyOn(room, 'resetBattle');
    fixture = TestBed.createComponent(EffectManagementComponent);
    component = fixture.componentInstance;
    spyOnProperty(component, 'roomState', 'get').and.returnValue(room);
    fixture.detectChanges();
  });

  function pressReset() {
    fixture.nativeElement.querySelector('.reset-control button').click();
    fixture.detectChanges();
  }

  it('lights the progress lamps without resetting on the first two clicks', () => {
    expect(fixture.nativeElement.querySelectorAll('.reset-lamp').length).toBe(3);
    for (let count of [1, 2]) {
      pressReset();
      expect(reset).not.toHaveBeenCalled();
      expect(room.round).toBe(2);
      expect(component.resetPressCount).toBe(count);
      expect(fixture.nativeElement.querySelectorAll('.reset-lamp.is-lit').length).toBe(count);
      expect(fixture.nativeElement.querySelector('.reset-progress').textContent).toContain(`${count}/3`);
    }
  });

  it('resets exactly once on the third click and starts a fresh confirmation afterwards', () => {
    pressReset();
    pressReset();
    pressReset();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(component.resetPressCount).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.reset-lamp.is-lit').length).toBe(0);
    expect(component.message).toBe('戦闘をリセットしました');
    pressReset();
    pressReset();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('cancels pending confirmation when Next Round is clicked', () => {
    pressReset();
    pressReset();
    fixture.nativeElement.querySelector('.round-actions > button').click();
    fixture.detectChanges();
    expect(room.incrementRound).toHaveBeenCalledWith(1);
    expect(component.resetPressCount).toBe(0);
    pressReset();
    expect(component.resetPressCount).toBe(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('requires new confirmation if the shared round or battle changes', () => {
    pressReset();
    pressReset();
    room.round++;
    expect(component.resetPressCount).toBe(0);
    pressReset();
    expect(component.resetPressCount).toBe(1);
    room.battleSequence++;
    expect(component.resetPressCount).toBe(0);
    pressReset();
    expect(component.resetPressCount).toBe(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not count or execute reset when GM mode is off', () => {
    pressReset();
    pressReset();
    isGM.and.returnValue(false);
    component.resetBattle();
    expect(component.resetPressCount).toBe(0);
    expect(reset).not.toHaveBeenCalled();
    isGM.and.returnValue(true);
    pressReset();
    expect(component.resetPressCount).toBe(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not carry confirmation into a newly opened panel', () => {
    pressReset();
    pressReset();
    fixture.destroy();
    fixture = TestBed.createComponent(EffectManagementComponent);
    component = fixture.componentInstance;
    spyOnProperty(component, 'roomState', 'get').and.returnValue(room);
    fixture.detectChanges();
    pressReset();
    expect(component.resetPressCount).toBe(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
