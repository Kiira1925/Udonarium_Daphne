import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { GameCharacter } from '@udonarium/game-character';

import { OverviewPanelComponent } from './overview-panel.component';

describe('OverviewPanelComponent', () => {
  let component: OverviewPanelComponent;
  let fixture: ComponentFixture<OverviewPanelComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(OverviewPanelComponent);
    component = fixture.componentInstance;
    component.tabletopObject = GameCharacter.create('test', 1, '');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
