import { TestBed } from '@angular/core/testing';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { DiceBot } from '@udonarium/dice-bot';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TextNote } from '@udonarium/text-note';

import { ChatMessageService } from './chat-message.service';
import { TabletopActionService } from './tabletop-action.service';
import { TabletopSelectionService } from './tabletop-selection.service';

describe('TabletopActionService', () => {
  let service: TabletopActionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TabletopActionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('Selected character choice', () => {
  let service: TabletopActionService;
  let selection: TabletopSelectionService;
  let chat: jasmine.SpyObj<ChatMessageService>;
  let mainTab: ChatTab;
  let previousCursor: PeerCursor;

  beforeEach(() => {
    mainTab = new ChatTab('choice-main-tab');
    chat = jasmine.createSpyObj('ChatMessageService', ['sendMessage'], { chatTabs: [mainTab] });
    TestBed.configureTestingModule({ providers: [{ provide: ChatMessageService, useValue: chat }] });
    service = TestBed.inject(TabletopActionService);
    selection = TestBed.inject(TabletopSelectionService);
    previousCursor = PeerCursor.myCursor;
    PeerCursor.myCursor = new PeerCursor('choice-user');
    let get = ObjectStore.instance.get.bind(ObjectStore.instance);
    spyOn(ObjectStore.instance, 'get').and.callFake((id: string) => id === 'MainTab' ? mainTab : get(id));
  });

  afterEach(() => {
    PeerCursor.myCursor = previousCursor;
  });

  function character(name: string): GameCharacter {
    let object = new GameCharacter();
    spyOnProperty(object, 'name', 'get').and.returnValue(name);
    return object;
  }

  it('hides the command when fewer than two characters are selected', () => {
    let objects = spyOnProperty(selection, 'objects', 'get').and.returnValue([new TextNote()]);
    expect(service.makeSelectionChoiceContextMenuAction()).toBeNull();
    objects.and.returnValue([character('A')]);
    expect(service.makeSelectionChoiceContextMenuAction()).toBeNull();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it('sends one public BCDice command for characters only, preserving duplicate candidates', () => {
    spyOnProperty(selection, 'objects', 'get').and.returnValue([
      character('モンスター A'), new TextNote(), character('モンスター A'), character('モンスター B')
    ]);
    let action = service.makeSelectionChoiceContextMenuAction();
    action.action();
    expect(chat.sendMessage).toHaveBeenCalledOnceWith(
      mainTab, 'choice[モンスター A,モンスター A,モンスター B]', 'DiceBot', 'choice-user');
  });

  it('keeps delimiter-containing and empty names as individual BCDice candidates', async () => {
    spyOnProperty(selection, 'objects', 'get').and.returnValue([
      character(' A, B］\nC '), character('　')
    ]);
    service.makeSelectionChoiceContextMenuAction().action();
    let command = chat.sendMessage.calls.mostRecent().args[1];
    expect(command).toBe('choice[A、 B〕 C,名称未設定]');
    let roll = await DiceBot.diceRollAsync(command, 'DiceBot');
    expect(roll.result).toMatch(/ ＞ (A、 B〕 C|名称未設定)$/);
    expect(roll.isSecret).toBeFalse();
  });

  it('uses the current selection when the menu action runs', () => {
    let objects = spyOnProperty(selection, 'objects', 'get').and.returnValue([character('A'), character('B')]);
    let action = service.makeSelectionChoiceContextMenuAction();
    objects.and.returnValue([character('C'), character('D')]);
    action.action();
    expect(chat.sendMessage).toHaveBeenCalledOnceWith(mainTab, 'choice[C,D]', 'DiceBot', 'choice-user');
  });
});
