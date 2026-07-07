import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { GameCharacter } from '@udonarium/game-character';

import { GameCharacterSheetComponent } from './game-character-sheet.component';

describe('GameCharacterSheetComponent', () => {
  let component: GameCharacterSheetComponent;
  let fixture: ComponentFixture<GameCharacterSheetComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GameCharacterSheetComponent);
    component = fixture.componentInstance;
    component.tabletopObject = GameCharacter.create('test', 1, '');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
