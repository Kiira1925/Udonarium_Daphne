import { ComponentFixture, fakeAsync, flush, TestBed, tick, waitForAsync } from '@angular/core/testing';
import { GameTableMaskScratchLock } from '@udonarium/game-table-mask-scratch-lock';
import { GameTableMask } from '@udonarium/game-table-mask';

import { AppModule } from '../../app.module';

import { GameDataElementComponent } from './game-data-element.component';

describe('GameDataElementComponent', () => {
  let component: GameDataElementComponent;
  let fixture: ComponentFixture<GameDataElementComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GameDataElementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not apply a delayed mask setting after scratch editing is locked', fakeAsync(() => {
    let mask = GameTableMask.create('test mask', 4, 4, 100);
    let widthElement = mask.commonDataElement.getFirstElementByName('width');
    component.gameDataElement = widthElement;
    component.ngOnInit();

    component.value = 8;
    let lock = GameTableMaskScratchLock.create(mask.identifier);
    lock.setOwner('editing-peer', 'editing-token');
    tick(70);

    expect(widthElement.value).toBe(4);

    lock.destroy();
    mask.destroy();
    flush();
  }));
});
