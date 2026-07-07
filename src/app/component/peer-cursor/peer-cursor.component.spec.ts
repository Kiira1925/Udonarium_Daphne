import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { PeerCursor } from '@udonarium/peer-cursor';

import { PeerCursorComponent } from './peer-cursor.component';

describe('PeerCursorComponent', () => {
  let component: PeerCursorComponent;
  let fixture: ComponentFixture<PeerCursorComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(PeerCursorComponent);
    component = fixture.componentInstance;
    component.cursor = new PeerCursor();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
