import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { GameTableMask } from '@udonarium/game-table-mask';

import { GameTableMaskComponent } from './game-table-mask.component';

describe('GameTableMaskComponent', () => {
  let component: GameTableMaskComponent;
  let fixture: ComponentFixture<GameTableMaskComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GameTableMaskComponent);
    component = fixture.componentInstance;
    component.gameTableMask = GameTableMask.create('test', 1, 1, 1);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('selects and deselects arbitrary cells along pointer strokes', () => {
    component.gameTableMask = GameTableMask.create('test', 4, 4, 1);
    (component as any).scratchSelectionAction = 'select';
    (component as any).scratchLastSelectionCell = { x: 0, y: 0 };

    (component as any).applyScratchSelectionStroke({ x: 3, y: 0 });

    expect(component.scratchSelectionCount).toBe(4);
    expect(component.isScratchCellSelected({ x: 0, y: 0 })).toBe(true);
    expect(component.isScratchCellSelected({ x: 3, y: 0 })).toBe(true);

    (component as any).scratchSelectionAction = 'deselect';
    (component as any).scratchLastSelectionCell = { x: 1, y: 0 };
    (component as any).applyScratchSelectionStroke({ x: 2, y: 0 });

    expect(component.scratchSelectionCount).toBe(2);
    expect(component.isScratchCellSelected({ x: 1, y: 0 })).toBe(false);
    expect(component.isScratchCellSelected({ x: 2, y: 0 })).toBe(false);
  });

  it('selects only cells that can be changed in the current mode', () => {
    component.gameTableMask = GameTableMask.create('test', 3, 1, 1);
    component.gameTableMask.addScratchArea({ x: 0, y: 0, width: 1, height: 1 });
    component.isScratchEditing = true;
    (component as any).scratchSelectionAction = 'select';
    (component as any).scratchLastSelectionCell = { x: 0, y: 0 };

    (component as any).applyScratchSelectionStroke({ x: 2, y: 0 });

    expect(component.scratchSelectionCount).toBe(2);
    expect(component.isScratchCellSelected({ x: 0, y: 0 })).toBe(false);
    expect(component.isScratchCellSelected({ x: 1, y: 0 })).toBe(true);
    expect(component.isScratchCellSelected({ x: 2, y: 0 })).toBe(true);

    component.setScratchEditMode('restore');

    expect(component.scratchSelectionCount).toBe(0);
    (component as any).scratchSelectionAction = 'select';
    (component as any).scratchLastSelectionCell = { x: 0, y: 0 };
    (component as any).applyScratchSelectionStroke({ x: 2, y: 0 });

    expect(component.scratchSelectionCount).toBe(1);
    expect(component.isScratchCellSelected({ x: 0, y: 0 })).toBe(true);
    expect(component.isScratchCellSelected({ x: 1, y: 0 })).toBe(false);
    expect(component.isScratchCellSelected({ x: 2, y: 0 })).toBe(false);
  });
});
