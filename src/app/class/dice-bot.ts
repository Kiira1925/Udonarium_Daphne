import { GameSystemInfo } from 'bcdice/lib/bcdice/game_system_list.json';
import GameSystemClass from 'bcdice/lib/game_system';

import BCDiceLoader from './bcdice/bcdice-loader';
import { ChatMessage, ChatMessageContext } from './chat-message';
import { ChatTab } from './chat-tab';
import { SyncObject } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';
import { PromiseQueue } from './core/system/util/promise-queue';
import { StringUtil } from './core/system/util/string-util';

interface DiceRollResult {
  id: string;
  result: string;
  isSecret: boolean;
  total?: number | null;
}

let loader: BCDiceLoader;
let queue: PromiseQueue = initializeDiceBotQueue();

@SyncObject('dice-bot')
export class DiceBot extends GameObject {
  static diceBotInfos: GameSystemInfo[] = [];

  static get lastRoll(): number {
    let latest: ChatMessage = null;
    let latestTotal = 0;
    for (let message of ObjectStore.instance.getObjects(ChatMessage)) {
      if (!message.isDicebot || message.isSecret || message.isDirect || message.usesLastRoll) continue;
      let storedTotal = message.getAttribute('diceTotal');
      let total = storedTotal == null || storedTotal === '' ? this.extractTotal(message.text) : Number(storedTotal);
      if (total == null || !Number.isFinite(total)) continue;
      if (latest && (message.timestamp < latest.timestamp
        || (message.timestamp === latest.timestamp && message.identifier <= latest.identifier))) continue;
      latest = message;
      latestTotal = total;
    }
    return latestTotal;
  }

  static replaceLastRollVariables(text: string, onLastRoll?: () => void): string {
    return text.replace(/[{｛]\s*([^{}｛｝]+?)\s*[}｝]/g, (match, name) => {
      if (StringUtil.toHalfWidth(name).trim().toLowerCase() !== 'lastroll') return match;
      onLastRoll?.();
      return String(this.lastRoll);
    });
  }

  static extractTotal(result: string): number | null {
    let lines = StringUtil.toHalfWidth(result ?? '').split(/\r?\n/);
    for (let line of lines.reverse()) {
      let parts = line.split(/[>＞]/).slice(1);
      for (let part of parts.reverse()) {
        let match = /^([+\-]?\d+(?:\.\d+)?)(?:\[[^\]]*\])?$/.exec(part.trim());
        if (!match) continue;
        let total = Number(match[1]);
        if (Number.isFinite(total)) return total;
      }
    }
    return null;
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    EventSystem.register(this)
      .on('SEND_MESSAGE', async event => {
        let chatMessage = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (!chatMessage || !chatMessage.isSendFromSelf || chatMessage.isSystem) return;

        let text: string = StringUtil.toHalfWidth(chatMessage.text).trim();
        let gameType: string = chatMessage.tag;

        try {
          let regArray = /^((\d+)?\s+)?(.*)?/ig.exec(text);
          let repeat: number = (regArray[2] != null) ? Number(regArray[2]) : 1;
          let rollText: string = (regArray[3] != null) ? regArray[3] : text;
          if (!rollText || repeat < 1) return;
          // 繰り返しコマンドに変換
          if (repeat > 1) {
            rollText = `x${repeat} ${rollText}`
          }

          let rollResult = await DiceBot.diceRollAsync(rollText, gameType);
          if (!rollResult.result) return;
          this.sendResultMessage(rollResult, chatMessage);
          EventSystem.trigger('DICE_ROLL_EXECUTED', { sourceIdentifier: chatMessage.sourceIdentifier });
        } catch (e) {
          console.error(e);
        }
        return;
      });
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
  }

  private sendResultMessage(rollResult: DiceRollResult, originalMessage: ChatMessage) {
    let id: string = rollResult.id.split(':')[0];
    let result: string = rollResult.result;
    let isSecret: boolean = rollResult.isSecret;

    if (result.length < 1) return;

    let diceBotMessage: ChatMessageContext = {
      identifier: '',
      tabIdentifier: originalMessage.tabIdentifier,
      originFrom: originalMessage.from,
      sourceIdentifier: originalMessage.sourceIdentifier,
      replyToIdentifier: originalMessage.identifier,
      from: 'System-BCDice',
      timestamp: originalMessage.timestamp + 1,
      imageIdentifier: '',
      tag: `system dicebot${isSecret ? ' secret' : ''}`,
      name: `${id} : ${originalMessage.name}${isSecret ? ' (Secret)' : ''}`,
      text: result,
      round: originalMessage.round,
      diceTotal: rollResult.total ?? undefined,
      usesLastRoll: originalMessage.usesLastRoll,
    };

    if (originalMessage.to != null && 0 < originalMessage.to.length) {
      diceBotMessage.to = originalMessage.to;
      if (originalMessage.to.indexOf(originalMessage.from) < 0) {
        diceBotMessage.to += ' ' + originalMessage.from;
      }
    }
    let chatTab = ObjectStore.instance.get<ChatTab>(originalMessage.tabIdentifier);
    if (chatTab) chatTab.addMessage(diceBotMessage);
  }

  static async diceRollAsync(message: string, gameType: string): Promise<DiceRollResult> {
    const empty: DiceRollResult = { id: gameType, result: '', isSecret: false };
    try {
      const gameSystem = await DiceBot.loadGameSystemAsync(gameType);
      if (!gameSystem?.COMMAND_PATTERN.test(message)) return empty;

      const result = gameSystem.eval(message);
      if (result) {
        console.log('diceRoll!!!', result.text);
        console.log('isSecret!!!', result.secret);
        return {
          id: gameSystem.ID,
          result: result.text.replace(/\n?(#\d+)\n/ig, '$1 '), // 繰り返しダイスロールは改行表示を短縮する
          isSecret: result.secret,
          total: DiceBot.extractTotal(result.text),
        };
      }
    } catch (e) {
      console.error(e);
    }
    return empty;
  }

  static async getHelpMessage(gameType: string): Promise<string> {
    try {
      const gameSystem = await DiceBot.loadGameSystemAsync(gameType);
      return gameSystem.HELP_MESSAGE;
    } catch (e) {
      console.error(e);
    }
    return '';
  }

  static async loadGameSystemAsync(gameType: string): Promise<GameSystemClass> {
    return await queue.add(() => {
      const id = this.diceBotInfos.some(info => info.id === gameType) ? gameType : 'DiceBot';
      try {
        return loader.getGameSystemClass(id);
      } catch {
        return loader.dynamicLoad(id);
      }
    });
  }
}

function initializeDiceBotQueue(): PromiseQueue {
  let queue = new PromiseQueue('DiceBotQueue');
  queue.add(async () => {
    loader = new (await import(
      /* webpackChunkName: "lib/bcdice/bcdice-loader" */
      './bcdice/bcdice-loader')
    ).default;
    DiceBot.diceBotInfos = loader.listAvailableGameSystems()
      .sort((a, b) => {
        if (a.sortKey < b.sortKey) return -1;
        if (a.sortKey > b.sortKey) return 1;
        return 0;
      });
  });
  return queue;
}
