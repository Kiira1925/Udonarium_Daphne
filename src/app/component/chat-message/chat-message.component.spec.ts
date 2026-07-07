import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { ChatMessage } from '@udonarium/chat-message';

import { ChatMessageComponent } from './chat-message.component';

describe('ChatMessageComponent', () => {
  let component: ChatMessageComponent;
  let fixture: ComponentFixture<ChatMessageComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ChatMessageComponent);
    component = fixture.componentInstance;
    component.chatMessage = new ChatMessage();
    component.chatMessage.name = 'test';
    component.chatMessage.from = 'test';
    component.chatMessage.tag = '';
    component.chatMessage.imageIdentifier = '';
    component.chatMessage.round = 0;
    component.chatMessage.value = 'message';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
