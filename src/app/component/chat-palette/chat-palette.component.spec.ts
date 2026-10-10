import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { AppModule } from '../../app.module';
import { GameCharacter } from '@udonarium/game-character';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { DataElement } from '@udonarium/data-element';
import { ChatMessageService } from 'service/chat-message.service';

import { ChatPaletteComponent } from './chat-palette.component';

describe('ChatPaletteComponent', () => {
  let component: ChatPaletteComponent;
  let fixture: ComponentFixture<ChatPaletteComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ AppModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ChatPaletteComponent);
    component = fixture.componentInstance;
    component.character = GameCharacter.create('test', 1, '');
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });
});

describe('ChatPalette lastRoll tracking', () => {
  let existingObjects: Set<GameObject>;

  beforeEach(() => {
    existingObjects = new Set(ObjectStore.instance.getObjects());
  });

  afterEach(() => {
    for (const object of ObjectStore.instance.getObjects()) {
      if (!existingObjects.has(object)) ObjectStore.instance.remove(object);
    }
  });

  it('retains lastRoll use when expanding the active palette for multiple selected characters', () => {
    const first = GameCharacter.create('first', 1, '');
    const second = GameCharacter.create('second', 1, '');
    first.chatPalette.setPalette('//damage=1D1+{lastRoll}+{bonus}');
    second.chatPalette.setPalette('//damage=1D1+99');
    first.detailDataElement.appendChild(DataElement.create('bonus', 2));
    second.detailDataElement.appendChild(DataElement.create('bonus', 3));
    const tab = new ChatTab();
    tab.initialize();
    const component = new ChatPaletteComponent(new ChatMessageService(), null, { objects: [first, second] } as any, null);
    component.character = first;
    component.chatTabidentifier = tab.identifier;
    component.sendChat({ text: '{damage}', gameType: 'DiceBot', sendFrom: first.identifier, sendTo: '' });
    const commands = tab.chatMessages;
    expect(commands.map(message => message.text)).toEqual(['1D1+0+2', '1D1+0+3']);
    expect(commands.every(message => message.usesLastRoll)).toBeTrue();

    component.sendChat({ text: '1D1+{bonus}', gameType: 'DiceBot', sendFrom: first.identifier, sendTo: '' });
    expect(tab.chatMessages.slice(2).every(message => !message.usesLastRoll)).toBeTrue();
  });
});
