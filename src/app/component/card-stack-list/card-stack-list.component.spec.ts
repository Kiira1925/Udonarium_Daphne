import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { CardStack } from '@udonarium/card-stack';

import { CardStackListComponent } from './card-stack-list.component';

describe('CardStackListComponent', () => {
  let component: CardStackListComponent;
  let fixture: ComponentFixture<CardStackListComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CardStackListComponent);
    component = fixture.componentInstance;
    component.cardStack = CardStack.create('test');
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});
