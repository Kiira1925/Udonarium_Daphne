import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { TextNote } from '@udonarium/text-note';

import { TextNoteComponent } from './text-note.component';

describe('TextNoteComponent', () => {
  let component: TextNoteComponent;
  let fixture: ComponentFixture<TextNoteComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TextNoteComponent);
    component = fixture.componentInstance;
    component.textNote = TextNote.create('title', 'text');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
