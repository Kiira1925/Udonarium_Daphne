import { CommonModule } from '@angular/common';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ChatMessage } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { EventSystem } from '@udonarium/core/system';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ChatMessageService } from 'service/chat-message.service';
import { isLatestChatCandidate, latestChatMessage, latestChatResults, latestChatText, LatestChatComponent } from './latest-chat.component';

describe('latest chat selection', () => {
  function message(id: string, timestamp: number, text: string = '発言'): ChatMessage {
    const result = new ChatMessage(id);
    result.value = text;
    result.setAttribute('timestamp', timestamp);
    spyOnProperty(result, 'isDisplayable').and.returnValue(true);
    return result;
  }

  it('keeps normal chat and dice commands while excluding commands and system notifications', () => {
    for (const text of ['こんにちは', '１ｄ２０＋１０ 格闘！', 'choice[A,B]', '/道を進む']) {
      expect(isLatestChatCandidate(message(text, 100, text))).toBeTrue();
    }
    for (const text of [':HP-1d6', ' :MP+2 回復', '/buff 攻撃/+1/3', '/ROUND +1', '/exclude', '  ']) {
      expect(isLatestChatCandidate(message(text, 100, text))).toBeFalse();
    }
    const system = message('system', 200);
    system.tag = 'system room-state';
    expect(isLatestChatCandidate(system)).toBeFalse();
  });

  it('uses message order instead of arrival order and ignores private messages for unrelated users', () => {
    const recent = message('recent', 200);
    const old = message('old', 100);
    const privateMessage = message('private', 300);
    (Object.getOwnPropertyDescriptor(privateMessage, 'isDisplayable')?.get as jasmine.Spy).and.returnValue(false);
    expect(latestChatMessage([recent, privateMessage, old])).toBe(recent);
  });

  it('associates dice by original ID and tab, even when two characters roll at the same time', () => {
    const first = message('first', 100, '1d20 格闘！');
    const second = message('second', 100, '1d20 回避！');
    const result = message('result', 101, '結果 ＞ 24');
    result.tag = 'system dicebot';
    result.from = 'System-BCDice';
    result.replyToIdentifier = first.identifier;
    const tab = new ChatTab('tab');
    for (const item of [first, second, result]) spyOnProperty(item, 'parent').and.returnValue(tab);
    expect(latestChatResults([first, second, result], first)).toEqual([result]);
    expect(latestChatResults([first, second, result], second)).toEqual([]);
    expect(latestChatMessage([first, result, message('new', 200)])?.identifier).toBe('new');
    (Object.getOwnPropertyDescriptor(result, 'parent')?.get as jasmine.Spy).and.returnValue(new ChatTab('other'));
    expect(latestChatResults([result], first)).toEqual([]);
  });

  it('masks secret results until disclosure and respects result visibility', () => {
    const secret = message('secret', 100, '結果 ＞ 99');
    secret.tag = 'system dicebot secret';
    secret.from = 'System-BCDice';
    spyOnProperty(secret, 'isSendFromSelf').and.returnValue(false);
    expect(latestChatText(secret)).toBe('（シークレットダイス）');
    secret.tag = 'system dicebot';
    expect(latestChatText(secret)).toBe('結果 ＞ 99');
  });

  it('retains the original message link when synchronized', () => {
    const result = message('result', 100);
    result.replyToIdentifier = 'original';
    const copy = new ChatMessage(result.identifier);
    copy.apply(result.toContext());
    expect(copy.replyToIdentifier).toBe('original');
  });
});

describe('LatestChatComponent', () => {
  let fixture: ComponentFixture<LatestChatComponent>;
  let tab: ChatTab;
  let messages: ChatMessage[];
  let service: { latestChatEnabled: boolean };

  beforeEach(async () => {
    messages = [];
    tab = new ChatTab('latest-chat-test');
    tab.name = 'メインタブ';
    spyOnProperty(tab, 'chatMessages').and.callFake(() => messages);
    spyOnProperty(ChatTabList.instance, 'chatTabs').and.returnValue([tab]);
    service = { latestChatEnabled: true };
    await TestBed.configureTestingModule({
      declarations: [LatestChatComponent], imports: [CommonModule],
      providers: [{ provide: ChatMessageService, useValue: service }]
    }).compileComponents();
    fixture = TestBed.createComponent(LatestChatComponent);
  });

  afterEach(() => fixture.destroy());

  function addMessage(id: string, timestamp: number, text: string): ChatMessage {
    const message = new ChatMessage(id);
    message.name = 'モンスターB';
    message.value = text;
    message.setAttribute('timestamp', timestamp);
    spyOnProperty(message, 'parent').and.returnValue(tab);
    spyOnProperty(message, 'isDisplayable').and.returnValue(true);
    messages.push(message);
    return message;
  }

  it('renders the original portrait and speech with dice results and keeps dismissal until a new speech', fakeAsync(() => {
    const original = addMessage('original', 100, '1d20+21 モンスターBの格闘！');
    spyOnProperty(original, 'image').and.returnValue(ImageFile.create('assets/images/ic_account_circle_black_24dp_2x.png'));
    fixture.detectChanges(); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.portrait').getAttribute('src')).toContain('ic_account_circle');
    const result = addMessage('dice', 101, '(1D20+21) ＞ 3[3]+21 ＞ 24');
    result.tag = 'system dicebot'; result.from = 'System-BCDice'; result.replyToIdentifier = original.identifier;
    EventSystem.trigger('MESSAGE_ADDED', {}); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('モンスターBの格闘！');
    expect(fixture.nativeElement.querySelector('.dice-result').textContent).toContain('24');
    fixture.nativeElement.querySelector('button').click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
    EventSystem.trigger('MESSAGE_ADDED', {}); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
    addMessage('new', 200, '次の発言');
    EventSystem.trigger('MESSAGE_ADDED', {}); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('次の発言');
    expect(fixture.nativeElement.querySelector('.dice-result')).toBeNull();
    service.latestChatEnabled = false; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
  }));
});
