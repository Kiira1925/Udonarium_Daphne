import { ChatMessage } from './chat-message';
import { ChatTab } from './chat-tab';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { DataElement } from './data-element';
import { DiceBot } from './dice-bot';
import { GameCharacter } from './game-character';
import { RoomState } from './room-state';
import { ChatMessageService } from 'service/chat-message.service';

describe('DiceBot result totals', () => {
  const cases: [string, number | null][] = [
    ['(2D6+3) ＞ 8[3,5]+3 ＞ 11', 11],
    ['(2D6) ＞ 7[3,4]', 7],
    ['(2D6+3>=10) ＞ 8[3,5]+3 ＞ 11 ＞ 成功', 11],
    ['(1D100<=50) ＞ 37 ＞ 成功', 37],
    ['(1D6-6) ＞ 1[1]-6 ＞ -5', -5],
    ['(1D6-1) ＞ 1[1]-1 ＞ 0', 0],
    ['計算結果 ＞ 2.5', 2.5],
    ['(K20+3) ＞ 2D:[6,6 4,3]=12,7 ＞ 8,5+3 ＞ 16', 16],
    ['#1\n(2D6) ＞ 7[3,4]\n#2\n(2D6) ＞ 9[4,5]', 9],
    ['(1D6) ＞ 4 ＞ 表の説明（100点）', 4],
    ['成功数: 2', null],
    ['2D6+3', null],
    ['', null],
  ];

  for (let [text, total] of cases) {
    it(`extracts the numeric total from ${JSON.stringify(text)}`, () => {
      expect(DiceBot.extractTotal(text)).toBe(total);
    });
  }

  it('includes modifiers in totals from the real BCDice engine', async () => {
    let result = await DiceBot.diceRollAsync('2D1+5', 'DiceBot');
    expect(result.total).toBe(7);
    let repeated = await DiceBot.diceRollAsync('x2 1D1+3', 'DiceBot');
    expect(repeated.total).toBe(4);
    let invalid = await DiceBot.diceRollAsync('ordinary chat', 'DiceBot');
    expect(invalid.result).toBe('');
  });
});

describe('lastRoll shared variable', () => {
  let messages: ChatMessage[];
  let existingObjects: Set<GameObject>;

  beforeEach(() => {
    messages = [];
    existingObjects = new Set(ObjectStore.instance.getObjects());
    let getObjects = ObjectStore.instance.getObjects.bind(ObjectStore.instance);
    spyOn(ObjectStore.instance, 'getObjects').and.callFake((type?: any) =>
      type === ChatMessage ? messages : getObjects(type));
  });

  afterEach(() => {
    for (let object of ObjectStore.instance.getObjects()) {
      if (!existingObjects.has(object)) ObjectStore.instance.remove(object);
    }
  });

  function result(timestamp: number, total?: number, tag: string = 'system dicebot', to: string = ''): ChatMessage {
    let message = new ChatMessage(`last-roll-${messages.length}`);
    message.from = 'System-BCDice';
    message.originFrom = `user-${messages.length}`;
    message.tag = tag;
    message.to = to;
    message.setAttribute('timestamp', timestamp);
    if (total != null) message.diceTotal = total;
    messages.push(message);
    return message;
  }

  it('uses the latest public result across senders regardless of arrival order', () => {
    result(200, 12);
    result(100, 7);
    expect(DiceBot.lastRoll).toBe(12);
    result(300, 0);
    expect(DiceBot.lastRoll).toBe(0);
  });

  it('does not expose secret or direct results or treat ordinary messages as dice', () => {
    result(100, 12);
    result(200, 99, 'system dicebot secret');
    result(300, 88, 'system dicebot', 'recipient');
    result(400, 77, '');
    result(500, NaN);
    expect(DiceBot.lastRoll).toBe(12);
  });

  it('reads older public dice messages and keeps the previous total for nonnumeric results', () => {
    result(100).value = '(2D6+3) ＞ 7[3,4]+3 ＞ 10';
    result(200).value = '成功数: 2';
    expect(DiceBot.lastRoll).toBe(10);
  });

  it('defaults to zero and preserves ordinary variables when only replacing lastRoll', () => {
    expect(DiceBot.replaceLastRollVariables(':HP-{lastRoll}+{防護}!')).toBe(':HP-0+{防護}!');
    result(100, -3);
    expect(DiceBot.replaceLastRollVariables('{ lastRoll } ｛ＬＡＳＴＲＯＬＬ｝ {MP}')).toBe('-3 -3 {MP}');
  });

  it('shares the total as part of the dice result context', () => {
    let original = result(100, 15);
    let peer = new ChatMessage(original.identifier);
    peer.apply(original.toContext());
    messages = [peer];
    expect(DiceBot.lastRoll).toBe(15);
  });

  it('keeps the previous total after lastRoll dice commands and updates it after an independent roll', async () => {
    result(100, 12);
    const tab = new ChatTab();
    tab.initialize();
    const service = new ChatMessageService();
    const bot = new DiceBot();
    for (const [command, total, lastRoll] of [
      ['1D1+{lastRoll}', 13, 12],
      ['x2 1D1+｛ ＬＡＳＴＲＯＬＬ ｝', 13, 12],
      ['1D1+5', 6, 6],
      ['C({lastRoll}*2)', 12, 6],
    ] as [string, number, number][]) {
      const original = service.sendMessage(tab, command, 'DiceBot', 'test-user');
      const roll = await DiceBot.diceRollAsync(original.text, 'DiceBot');
      expect(roll.total).toBe(total);
      (bot as any).sendResultMessage(roll, original);
      const response = tab.chatMessages.find(message => message.replyToIdentifier === original.identifier);
      expect(response.diceTotal).toBe(total);
      messages.push(response);
      expect(DiceBot.lastRoll).toBe(lastRoll);
    }
  });

  it('preserves the exclusion on peers and in saved logs without the original command', () => {
    const original = result(100, 15);
    original.usesLastRoll = true;
    const peer = new ChatMessage(original.identifier);
    peer.apply(original.toContext());
    messages = [peer];
    expect(DiceBot.lastRoll).toBe(0);
    const restored = ObjectSerializer.instance.parseXml(original.toXml()) as ChatMessage;
    messages = [restored];
    expect(DiceBot.lastRoll).toBe(0);
    original.usesLastRoll = false;
    messages = [ObjectSerializer.instance.parseXml(original.toXml()) as ChatMessage];
    expect(DiceBot.lastRoll).toBe(15);
  });

  it('tracks lastRoll inside nested palette and status variables when sending character commands', async () => {
    result(100, 12);
    const character = GameCharacter.create('target', 1, '');
    character.chatPalette.setPalette('//damage=1D1+{previous}\n//previous={lastRoll}');
    character.detailDataElement.appendChild(DataElement.create('previousRoll', '{lastRoll}'));
    const tab = new ChatTab();
    tab.initialize();
    const service = new ChatMessageService();
    for (const command of ['{damage}', '1D1+{previousRoll}']) {
      const original = service.sendMessage(tab, command, 'DiceBot', character.identifier);
      expect(original.text).toBe('1D1+12');
      const roll = await DiceBot.diceRollAsync(original.text, 'DiceBot');
      (new DiceBot() as any).sendResultMessage(roll, original);
      const response = tab.chatMessages.find(message => message.replyToIdentifier === original.identifier);
      expect(response.diceTotal).toBe(13);
      messages.push(response);
      expect(DiceBot.lastRoll).toBe(12);
    }
  });

  it('adds totals to dice result messages in different chat tabs', () => {
    let firstTab = new ChatTab();
    let secondTab = new ChatTab();
    firstTab.initialize();
    secondTab.initialize();
    for (let [tab, timestamp, total] of [[firstTab, 100, 7], [secondTab, 200, 12]] as [ChatTab, number, number][]) {
      let original = new ChatMessage();
      original.from = `user-${timestamp}`;
      original.name = 'character';
      original.setAttribute('timestamp', timestamp);
      tab.appendChild(original);
      spyOn(tab, 'addMessage').and.callFake(context => {
        let message = result(context.timestamp, context.diceTotal, context.tag, context.to);
        tab.appendChild(message);
        return message;
      });
      (new DiceBot() as any).sendResultMessage({ id: 'DiceBot', result: `total > ${total}`, total, isSecret: false }, original);
    }
    expect(DiceBot.lastRoll).toBe(12);
  });

  it('links actual dice result messages to their original speech and character', () => {
    const tab = new ChatTab();
    tab.initialize();
    const original = new ChatMessage();
    original.from = 'test-user';
    original.name = 'モンスターB';
    original.sourceIdentifier = 'test-character';
    original.setAttribute('timestamp', 100);
    tab.appendChild(original);
    const add = spyOn(tab, 'addMessage').and.callThrough();
    (new DiceBot() as any).sendResultMessage({ id: 'DiceBot', result: '結果 ＞ 24', total: 24, isSecret: false }, original);
    expect(add.calls.mostRecent().args[0].replyToIdentifier).toBe(original.identifier);
    const result = tab.chatMessages.find(message => message.isDicebot);
    expect(result.replyToIdentifier).toBe(original.identifier);
    expect(result.sourceIdentifier).toBe('test-character');
  });

  it('expands the reserved variable inside palette macros without creating a status', () => {
    result(100, 12);
    let character = GameCharacter.create('target', 1, '');
    character.detailDataElement.appendChild(DataElement.create('防護', 3));
    character.chatPalette.setPalette('//lastRoll=999\n//damage=:HP-{lastRoll}+{防護}!');
    expect(character.chatPalette.evaluate('{damage}', character.rootDataElement)).toBe(':HP-12+3!');
    expect(character.rootDataElement.getFirstElementByName('lastRoll')).toBeNull();
    let service = new ChatMessageService();
    expect((service as any).evaluateText('damage {lastRoll}', '')).toBe('damage 12');
  });

  it('applies the previous roll to HP damage and does not replace it with resource calculations', async () => {
    result(100, 12);
    let character = GameCharacter.create('target', 1, '');
    character.detailDataElement.appendChild(DataElement.create('防護', 3));
    let hp = character.rootDataElement.getFirstElementByName('HP');
    hp.currentValue = 20;
    let service = new ChatMessageService();
    let command = (service as any).evaluateText(':HP-{lastRoll}+{防護}!', character.identifier);
    let room = new RoomState('last-roll-resource-test');
    spyOn<any>(room, 'sendResourceSystemMessage');
    let original = new ChatMessage();
    original.sourceIdentifier = character.identifier;
    original.tag = 'DiceBot';
    await (room as any).handleResourceCommands(command, original, '');
    expect(hp.currentValue).toBe(11);
    expect(DiceBot.lastRoll).toBe(12);
    await (room as any).executeResourceCommand({ resourceName: 'HP', operator: '-', expression: '{lastRoll}!' }, character);
    expect(hp.currentValue).toBe(-1);
    expect(DiceBot.lastRoll).toBe(12);
  });
});
