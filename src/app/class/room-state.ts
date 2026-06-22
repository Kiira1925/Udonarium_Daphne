import { TabletopSelectionService } from 'service/tabletop-selection.service';

import { DiceBot } from './dice-bot';
import { ChatMessage, ChatMessageContext } from './chat-message';
import { ChatTab } from './chat-tab';
import { ChatTabList } from './chat-tab-list';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { CompareOption, StringUtil } from './core/system/util/string-util';
import { UUID } from './core/system/util/uuid';
import { DataElement } from './data-element';
import { GameCharacter } from './game-character';

export type BuffOperator = '+' | '-' | '*';
export type BuffEffectKind = 'stat' | 'note';

export interface BuffEffectEntry {
  kind: BuffEffectKind;
  statusName: string;
  operator: BuffOperator;
  amount: number;
  description?: string;
}

export interface BuffEffect {
  id: string;
  targetIdentifier: string;
  effects?: BuffEffectEntry[];
  kind?: BuffEffectKind;
  name: string;
  statusName?: string;
  operator?: BuffOperator;
  amount?: number;
  description?: string;
  remainingRounds: number;
  createdRound: number;
}

export interface BuffTemplate {
  id: string;
  ownerIdentifier: string;
  effects?: BuffEffectEntry[];
  kind?: BuffEffectKind;
  name: string;
  statusName?: string;
  operator?: BuffOperator;
  amount?: number;
  description?: string;
  durationRounds: number;
}

interface ResourceCommand {
  token: string;
  resourceName: string;
  operator: string;
  expression: string;
}

@SyncObject('room-state')
export class RoomState extends GameObject {
  private static readonly identifier = 'RoomState';
  private static readonly gmModeStorageKey = 'udonarium-daphne-gm-mode';

  static get instance(): RoomState {
    let state = ObjectStore.instance.get<RoomState>(RoomState.identifier);
    if (!state) {
      state = new RoomState(RoomState.identifier);
      state.initialize();
    }
    return state;
  }

  @SyncVar() round: number = 0;
  @SyncVar() effects: BuffEffect[] = [];
  @SyncVar() buffTemplates: BuffTemplate[] = [];
  @SyncVar() actionDoneCharacterIds: string[] = [];
  @SyncVar() roomMasterUserId: string = '';

  get localGMMode(): boolean {
    return localStorage.getItem(RoomState.gmModeStorageKey) === 'true';
  }

  set localGMMode(isEnabled: boolean) {
    localStorage.setItem(RoomState.gmModeStorageKey, isEnabled ? 'true' : 'false');
  }

  onStoreAdded() {
    super.onStoreAdded();
    EventSystem.register(this)
      .on('SEND_MESSAGE', event => this.onSendMessage(event.data.tabIdentifier, event.data.messageIdentifier))
      .on('DELETE_GAME_OBJECT', event => this.removeCharacterState(event.data.identifier));
  }

  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
  }

  addEffect(target: GameCharacter, name: string, entries: BuffEffectEntry[], remainingRounds: number): BuffEffect | null {
    let normalizedEntries = this.normalizeEffectEntries(entries);
    if (normalizedEntries.length < 1) return null;

    let existing = this.effects.find(effect => this.isSameEffectContent(effect, target.identifier, name, normalizedEntries));
    if (existing) {
      if (existing.remainingRounds === remainingRounds) return null;

      let updated = { ...existing, remainingRounds: remainingRounds, createdRound: this.round };
      this.effects = this.effects.map(effect => effect.id === existing.id ? updated : effect);
      return updated;
    }

    let firstEntry = normalizedEntries[0];
    let newEffect: BuffEffect = {
      id: UUID.generateUuid(),
      targetIdentifier: target.identifier,
      effects: normalizedEntries,
      kind: firstEntry.kind,
      name: name,
      statusName: firstEntry.statusName,
      operator: firstEntry.operator,
      amount: firstEntry.amount,
      description: firstEntry.description ?? '',
      remainingRounds: remainingRounds,
      createdRound: this.round,
    };

    let effects = this.effects.slice();
    effects.push(newEffect);
    this.effects = effects;
    return newEffect;
  }

  ensureRoomMaster(userId: string) {
    if (!userId) return;
    if (!this.roomMasterUserId) {
      this.roomMasterUserId = userId;
    }
  }

  isRoomMaster(userId: string = Network.peer.userId): boolean {
    return !!userId && this.roomMasterUserId === userId;
  }

  isGM(userId: string = Network.peer.userId): boolean {
    if (!userId || userId !== Network.peer.userId) return false;
    return this.localGMMode;
  }

  canAccessGMCharacter(character: GameCharacter): boolean {
    return !character.isGMCreated || this.isGM();
  }

  applyTemplateToSelected(template: BuffTemplate): number {
    let addedCount = 0;
    let targets = this.selectedCharacters();
    for (let target of targets) {
      if (this.addEffect(target, template.name, this.effectEntries(template), template.durationRounds)) {
        addedCount++;
      }
    }
    return addedCount;
  }

  removeEffect(effectId: string) {
    this.effects = this.effects.filter(effect => effect.id !== effectId);
  }

  incrementRound(amount: number = 1): BuffEffect[] {
    if (amount < 1) return [];
    this.round = this.round + amount;
    this.actionDoneCharacterIds = [];
    this.sendRoundAnnouncement();

    let expired: BuffEffect[] = [];
    let effects: BuffEffect[] = [];
    for (let effect of this.effects) {
      let updated = { ...effect, remainingRounds: effect.remainingRounds - amount };
      if (updated.remainingRounds <= 0) {
        expired.push(updated);
      } else {
        effects.push(updated);
      }
    }
    this.effects = effects;
    return expired;
  }

  resetBattle(): number {
    let removedCount = this.effects.length;
    this.round = 0;
    this.effects = [];
    this.actionDoneCharacterIds = [];
    return removedCount;
  }

  addTemplate(template: Omit<BuffTemplate, 'id'>): BuffTemplate | null {
    let entries = this.normalizeEffectEntries(this.effectEntries(template));
    if (entries.length < 1) return null;
    let firstEntry = entries[0];
    let created: BuffTemplate = {
      ...template,
      id: UUID.generateUuid(),
      effects: entries,
      kind: firstEntry.kind,
      statusName: firstEntry.statusName,
      operator: firstEntry.operator,
      amount: firstEntry.amount,
      description: firstEntry.description ?? '',
      durationRounds: Math.floor(Number(template.durationRounds)),
    };
    this.buffTemplates = this.buffTemplates.concat(created);
    return created;
  }

  updateTemplate(template: BuffTemplate) {
    let entries = this.normalizeEffectEntries(this.effectEntries(template));
    if (entries.length < 1) return;
    let firstEntry = entries[0];
    let updated: BuffTemplate = {
      ...template,
      effects: entries,
      kind: firstEntry.kind,
      statusName: firstEntry.statusName,
      operator: firstEntry.operator,
      amount: firstEntry.amount,
      description: firstEntry.description ?? '',
      durationRounds: Math.floor(Number(template.durationRounds)),
    };
    this.buffTemplates = this.buffTemplates.map(item => item.id === updated.id ? updated : item);
  }

  removeTemplate(templateId: string) {
    this.buffTemplates = this.buffTemplates.filter(template => template.id !== templateId);
  }

  templatesFor(ownerIdentifier: string): BuffTemplate[] {
    return this.buffTemplates.filter(template => template.ownerIdentifier === ownerIdentifier);
  }

  templateFor(ownerIdentifier: string, templateName: string): BuffTemplate | null {
    return this.templatesFor(ownerIdentifier).find(template => this.isSameText(template.name, templateName)) ?? null;
  }

  importTemplatesFromChatPalette(character: GameCharacter): number {
    let palette = character.chatPalette;
    if (!palette) return 0;

    let importedCount = 0;
    for (let line of palette.getPalette()) {
      let match = /^\s*\/buff\s+(.+?)\s*$/i.exec(line);
      if (!match) continue;

      let parsed = this.parseBuffCommand(match[1]);
      if (!parsed) continue;

      let template: Omit<BuffTemplate, 'id'> = {
        ...parsed,
        ownerIdentifier: character.identifier,
      };
      if (this.hasSameTemplate(template)) continue;

      if (this.addTemplate(template)) importedCount++;
    }
    return importedCount;
  }

  applyEffects(target: GameCharacter, element: DataElement): string | null {
    return this.applyEffectsByTargetIdentifier(target.identifier, element);
  }

  applyEffectsByTargetIdentifier(targetIdentifier: string, element: DataElement): string | null {
    let base = this.toNumber(element.isNumberResource ? element.currentValue : element.value);
    if (base == null) return null;

    let multipliers = 1;
    let additions = 0;
    for (let effect of this.effectsForTargetIdentifier(targetIdentifier, element.name)) {
      for (let entry of this.effectEntries(effect)) {
        if (entry.kind !== 'stat' || !this.isSameStatusName(entry.statusName, element.name)) continue;
        if (entry.operator === '*') {
          multipliers *= entry.amount;
        } else if (entry.operator === '+') {
          additions += entry.amount;
        } else if (entry.operator === '-') {
          additions -= entry.amount;
        }
      }
    }

    let modified = base * multipliers + additions;
    return Number.isInteger(modified) ? modified + '' : modified.toString();
  }

  effectsFor(target: GameCharacter, statusName?: string): BuffEffect[] {
    return this.effectsForTargetIdentifier(target.identifier, statusName);
  }

  effectsForTargetIdentifier(targetIdentifier: string, statusName?: string): BuffEffect[] {
    return this.effects.filter(effect =>
      effect.targetIdentifier === targetIdentifier
      && this.effectEntries(effect).some(entry =>
        entry.kind === 'stat'
        && (statusName == null || this.isSameStatusName(entry.statusName, statusName))
      )
    );
  }

  selectedCharacters(): GameCharacter[] {
    let objects = TabletopSelectionService.instance?.objects ?? [];
    return objects.filter((object): object is GameCharacter => object instanceof GameCharacter);
  }

  tableCharacters(): GameCharacter[] {
    return ObjectStore.instance.getObjects(GameCharacter)
      .filter(character => character.isVisibleOnTable);
  }

  actionDoneCount(): number {
    return this.tableCharacters()
      .filter(character => this.isActionDone(character))
      .length;
  }

  actionTargetCount(): number {
    return this.tableCharacters().length;
  }

  canAdvanceRound(): boolean {
    if (this.round <= 0) return true;

    let characters = this.tableCharacters();
    return characters.every(character => this.isActionDone(character));
  }

  isActionDone(character: GameCharacter): boolean {
    return this.round > 0 && this.actionDoneCharacterIds.includes(character.identifier);
  }

  setActionDone(character: GameCharacter, isDone: boolean) {
    this.setActionDoneForCharacters([character], isDone);
  }

  setActionDoneForCharacters(characters: GameCharacter[], isDone: boolean, announce: boolean = false) {
    if (this.round <= 0) return;

    let targets = characters.filter(character => character != null);
    if (targets.length < 1) return;

    let targetIdentifiers = new Set(targets.map(character => character.identifier));
    let doneBefore = new Set(this.actionDoneCharacterIds);
    let ids = this.actionDoneCharacterIds.filter(identifier => !targetIdentifiers.has(identifier));
    if (isDone) {
      for (let target of targets) {
        if (!ids.includes(target.identifier)) ids.push(target.identifier);
      }
    }
    this.actionDoneCharacterIds = ids;

    if (announce && isDone) {
      targets
        .filter(character => !doneBefore.has(character.identifier))
        .forEach(character => this.sendMainSystemMessage(`${character.name} が行動完了`));
    }
  }

  toggleActionDone(character: GameCharacter): boolean {
    let isDone = !this.isActionDone(character);
    this.setActionDoneForCharacters([character], isDone, true);
    return isDone;
  }

  private async onSendMessage(tabIdentifier: string, messageIdentifier: string) {
    let chatMessage = ObjectStore.instance.get<ChatMessage>(messageIdentifier);
    if (!chatMessage || !chatMessage.isSendFromSelf || chatMessage.isSystem) return;

    let text = (chatMessage.text ?? '').trim();
    if (await this.handleResourceCommands(text, chatMessage, tabIdentifier)) return;
    if (!text.startsWith('/')) return;

    if (this.handleBuffCommand(text, chatMessage, tabIdentifier)) return;
    if (this.handleRoundCommand(text, chatMessage, tabIdentifier)) return;
  }

  private async handleResourceCommands(text: string, chatMessage: ChatMessage, tabIdentifier: string): Promise<boolean> {
    if (!text.startsWith(':')) return false;

    let tokens = text.split(' ').filter(token => 0 < token.length);
    let commandTokens: string[] = [];
    let index = 0;
    while (index < tokens.length && tokens[index].startsWith(':')) {
      commandTokens.push(tokens[index]);
      index++;
    }

    let commands = commandTokens.map(token => this.parseResourceCommand(token));
    if (commands.length < 1 || commands.some(command => command == null)) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'リソース操作書式: :HP-1d6 / :MP+2 / :HP=10');
      return true;
    }

    let source = ObjectStore.instance.get<GameCharacter>(chatMessage.sourceIdentifier);
    if (!(source instanceof GameCharacter)) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'リソース操作には、送信元にキャラコマを指定してください');
      return true;
    }

    if (source.isStatusHidden) {
      let commentTokens = tokens.slice(index);
      chatMessage.setAttribute('gmText', text);
      chatMessage.value = commands
        .map(command => `:${command.resourceName} ??`)
        .concat(commentTokens)
        .join(' ');
    }

    for (let command of commands) {
      await this.executeResourceCommand(command, source, chatMessage, tabIdentifier);
    }
    return true;
  }

  private parseResourceCommand(token: string): ResourceCommand | null {
    let parsed = /^:\s*(.+?)\s*([+\-*/=])\s*(.+)$/.exec(token);
    if (!parsed) return null;

    return {
      token: token,
      resourceName: parsed[1].trim(),
      operator: parsed[2],
      expression: parsed[3].trim(),
    };
  }

  private async executeResourceCommand(command: ResourceCommand, source: GameCharacter, chatMessage: ChatMessage, tabIdentifier: string) {
    let resourceName = command.resourceName;
    let operator = command.operator;
    let options = this.parseResourceOptions(command.expression);
    let expression = options.expression;
    let shouldHideResourceChat = source.isStatusHidden;
    let expressionForEvaluate = operator === '+' || operator === '-' ? operator + expression : expression;
    let operatorForCalculate = operator === '+' || operator === '-' ? '+' : operator;
    let resource = this.findNumberResource(source, resourceName);
    if (!resource) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `${source.name} に「${resourceName}」リソースは見つかりません`);
      return;
    }

    let operand = await this.evaluateResourceExpression(expressionForEvaluate, chatMessage.tag);
    if (operand == null) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `式を数値として評価できません: ${expressionForEvaluate}`);
      return;
    }
    operand = this.applyResourceOperandOptions(operator, operand, options);

    let current = this.toNumber(resource.currentValue);
    if (current == null) current = 0;

    let next = this.calculateResourceValue(current, operatorForCalculate, operand);
    if (next == null) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `リソース操作に失敗しました: ${operator}${expression}`);
      return;
    }
    next = this.applyResourceResultOptions(next, resource, options);

    resource.currentValue = Number.isInteger(next) ? next : Number(next.toFixed(4));
    let publicText = shouldHideResourceChat
      ? `${source.name} ${resource.name}: ?? -> ??`
      : `${source.name} ${resource.name}: ${current} -> ${resource.currentValue} (${this.formatResourceOperation(operatorForCalculate, operand)})`;
    let gmText = shouldHideResourceChat
      ? `${source.name} ${resource.name}: ${current} -> ${resource.currentValue} (${operator}${expression} = ${this.formatResourceOperation(operatorForCalculate, operand)})`
      : '';
    this.sendSystemMessage(chatMessage, tabIdentifier, publicText, gmText);
  }

  private handleBuffCommand(text: string, chatMessage: ChatMessage, tabIdentifier: string): boolean {
    let match = /^\/buff\s+(.+)$/i.exec(text);
    if (!match) return false;

    let templateName = match[1].trim();
    if (0 < templateName.length && templateName.indexOf('/') < 0) {
      return this.handleBuffTemplateCommand(templateName, chatMessage, tabIdentifier);
    }

    let parsed = this.parseBuffCommand(match[1]);
    if (!parsed) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'バフ書式: /buff バフ名/効果1;効果2/効果時間');
      return true;
    }

    let targets = this.selectedCharacters();
    if (targets.length < 1) {
      this.sendSystemMessage(chatMessage, tabIdentifier, '対象コマが選択されていません');
      return true;
    }

    let addedCount = 0;
    for (let target of targets) {
      if (this.addEffect(target, parsed.name, this.effectEntries(parsed), parsed.durationRounds)) {
        addedCount++;
      }
    }

    this.sendSystemMessage(chatMessage, tabIdentifier, `${parsed.name}: ${this.formatEffectEntries(this.effectEntries(parsed))} / 残り${parsed.durationRounds}R を${addedCount}体に付与`);
    return true;
  }

  private handleBuffTemplateCommand(templateName: string, chatMessage: ChatMessage, tabIdentifier: string): boolean {
    let source = ObjectStore.instance.get<GameCharacter>(chatMessage.sourceIdentifier);
    if (!(source instanceof GameCharacter)) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'テンプレートを呼び出すには、送信元にキャラコマを指定してください');
      return true;
    }

    let template = this.templateFor(source.identifier, templateName);
    if (!template) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `${source.name} に「${templateName}」テンプレートは登録されていません`);
      return true;
    }

    let targets = this.selectedCharacters();
    if (targets.length < 1) {
      this.sendSystemMessage(chatMessage, tabIdentifier, '対象コマが選択されていません');
      return true;
    }

    let addedCount = this.applyTemplateToSelected(template);
    this.sendSystemMessage(chatMessage, tabIdentifier, `${template.name} / 残り${template.durationRounds}R を${addedCount}体に付与`);
    return true;
  }

  private handleRoundCommand(text: string, chatMessage: ChatMessage, tabIdentifier: string): boolean {
    let match = /^\/round\s+(.+)$/i.exec(text);
    if (!match) return false;

    if (!this.isGM()) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'ラウンド操作はGMモード中のユーザーのみ実行できます');
      return true;
    }

    let arg = match[1].trim().toLowerCase();
    if (arg === 'reset') {
      let removedCount = this.resetBattle();
      this.sendSystemMessage(chatMessage, tabIdentifier, `Round reset。効果${removedCount}件を削除`);
      return true;
    }

    let increment = /^\+(\d+)$/.exec(arg);
    if (!increment) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'ラウンド書式: /round +1 または /round reset');
      return true;
    }

    if (!this.canAdvanceRound()) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `未行動のテーブル上コマがあります（${this.actionDoneCount()}/${this.actionTargetCount()}）。全員が行動完了になるまでラウンドを進められません`);
      return true;
    }

    let prevRound = this.round;
    let amount = Number(increment[1]);
    let expired = this.incrementRound(amount);
    this.sendSystemMessage(chatMessage, tabIdentifier, `Round ${prevRound} -> ${this.round}。期限切れ効果${expired.length}件を削除`);
    return true;
  }

  private parseBuffCommand(command: string): Omit<BuffTemplate, 'id' | 'ownerIdentifier'> | null {
    let parts = command.trim().split('/').map(part => part.trim()).filter(part => 0 < part.length);
    if (parts.length !== 3) return null;

    let [name, effectText, durationText] = parts;
    let duration = Number(durationText);
    if (!Number.isFinite(duration) || duration < 1) return null;

    let entries = effectText.split(';')
      .map(item => this.parseEffectEntry(item.trim()))
      .filter((entry): entry is BuffEffectEntry => entry != null);
    if (entries.length < 1 || entries.length !== effectText.split(';').length) return null;

    return {
      name: name,
      effects: entries,
      ...this.legacyEffectFields(entries[0]),
      durationRounds: Math.floor(duration),
    };
  }

  private parseEffectEntry(effectText: string): BuffEffectEntry | null {
    if (!effectText) return null;

    let effect = /^(.+?)([+\-*])(-?\d+(?:\.\d+)?)$/.exec(effectText);
    if (!effect) {
      return {
        kind: 'note',
        statusName: '',
        operator: '+',
        amount: 0,
        description: effectText,
      };
    }

    return {
      kind: 'stat',
      statusName: effect[1].trim(),
      operator: effect[2] as BuffOperator,
      amount: Number(effect[3]),
      description: '',
    };
  }

  private removeCharacterState(targetIdentifier: string) {
    this.removeEffectsByTarget(targetIdentifier);
    this.removeTemplatesByOwner(targetIdentifier);
    this.actionDoneCharacterIds = this.actionDoneCharacterIds.filter(identifier => identifier !== targetIdentifier);
  }

  private removeEffectsByTarget(targetIdentifier: string) {
    if (!this.effects.some(effect => effect.targetIdentifier === targetIdentifier)) return;
    this.effects = this.effects.filter(effect => effect.targetIdentifier !== targetIdentifier);
  }

  private removeTemplatesByOwner(ownerIdentifier: string) {
    if (!this.buffTemplates.some(template => template.ownerIdentifier === ownerIdentifier)) return;
    this.buffTemplates = this.buffTemplates.filter(template => template.ownerIdentifier !== ownerIdentifier);
  }

  private hasSameTemplate(template: Omit<BuffTemplate, 'id'>): boolean {
    return this.templatesFor(template.ownerIdentifier).some(item =>
      this.isSameText(item.name, template.name)
      && item.durationRounds === template.durationRounds
      && this.isSameEffectEntries(this.effectEntries(item), this.effectEntries(template))
    );
  }

  private findNumberResource(character: GameCharacter, resourceName: string): DataElement | null {
    return character.rootDataElement
      ?.getElementsByName(resourceName, CompareOption.IgnoreCase | CompareOption.IgnoreWidth)
      .find(element => element.isNumberResource) ?? null;
  }

  private parseResourceOptions(expression: string): { expression: string, capMax: boolean, noReverse: boolean } {
    let options = { expression: expression.trim(), capMax: false, noReverse: false };
    while (0 < options.expression.length) {
      let suffix = options.expression.charAt(options.expression.length - 1);
      if (suffix === 'M' || suffix === 'm') {
        options.capMax = true;
      } else if (suffix === '!') {
        options.noReverse = true;
      } else {
        break;
      }
      options.expression = options.expression.slice(0, -1).trim();
    }
    return options;
  }

  private async evaluateResourceExpression(expression: string, gameType: string): Promise<number | null> {
    let rollResult = await DiceBot.diceRollAsync(expression, gameType || 'DiceBot');
    let bcdiceValue = this.extractLastNumber(rollResult.result);
    if (bcdiceValue != null) return bcdiceValue;

    return this.evaluateSimpleExpression(expression);
  }

  private extractLastNumber(text: string): number | null {
    if (!text) return null;
    let matches = text.match(/-?\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 1) return null;

    let value = Number(matches[matches.length - 1]);
    return Number.isFinite(value) ? value : null;
  }

  private evaluateSimpleExpression(expression: string): number | null {
    let normalized = StringUtil.toHalfWidth(expression).trim();
    if (!/^[\d+\-*/().\s]+$/.test(normalized)) return null;

    try {
      let value = Function(`"use strict"; return (${normalized});`)();
      return Number.isFinite(value) ? Number(value) : null;
    } catch (_error) {
      return null;
    }
  }

  private calculateResourceValue(current: number, operator: string, operand: number): number | null {
    if (operator === '+') return current + operand;
    if (operator === '-') return current - operand;
    if (operator === '*') return current * operand;
    if (operator === '/') return operand === 0 ? null : current / operand;
    if (operator === '=') return operand;
    return null;
  }

  private applyResourceOperandOptions(operator: string, operand: number, options: { noReverse: boolean }): number {
    if (!options.noReverse) return operand;
    if (operator === '-' && 0 < operand) return 0;
    if (operator === '+' && operand < 0) return 0;
    if ((operator === '*' || operator === '/') && operand < 0) return 0;
    return operand;
  }

  private applyResourceResultOptions(next: number, resource: DataElement, options: { capMax: boolean }): number {
    if (!options.capMax) return next;

    let max = this.toNumber(resource.value);
    return max == null ? next : Math.min(next, max);
  }

  private formatResourceOperation(operator: string, operand: number): string {
    if (operator === '+') return 0 <= operand ? `+${operand}` : `${operand}`;
    return `${operator}${operand}`;
  }

  private sendSystemMessage(originalMessage: ChatMessage, tabIdentifier: string, text: string, gmText: string = '') {
    let chatTab = ObjectStore.instance.get<ChatTab>(tabIdentifier);
    if (!chatTab) return;

    let message: ChatMessageContext = {
      identifier: '',
      tabIdentifier: tabIdentifier,
      originFrom: originalMessage.from,
      from: 'System-RoomState',
      timestamp: originalMessage.timestamp + 1,
      imageIdentifier: '',
      tag: 'system room-state',
      name: 'Room',
      text: text,
      round: this.round,
      gmText: gmText,
    };
    chatTab.addMessage(message);
  }

  private sendMainSystemMessage(text: string) {
    let chatTab = ObjectStore.instance.get<ChatTab>('MainTab') ?? ChatTabList.instance.chatTabs[0];
    if (!chatTab) return;

    let now = Date.now();
    let latest = chatTab.latestTimeStamp;
    let message: ChatMessageContext = {
      identifier: '',
      tabIdentifier: chatTab.identifier,
      from: 'System-RoomState',
      timestamp: now <= latest ? latest + 1 : now,
      imageIdentifier: '',
      tag: 'system room-state action-done',
      name: 'Round',
      text: text,
      round: this.round,
    };
    chatTab.addMessage(message);
  }

  private sendRoundAnnouncement() {
    let chatTab = ObjectStore.instance.get<ChatTab>('MainTab') ?? ChatTabList.instance.chatTabs[0];
    if (!chatTab) return;

    let now = Date.now();
    let latest = chatTab.latestTimeStamp;
    let message: ChatMessageContext = {
      identifier: '',
      tabIdentifier: chatTab.identifier,
      from: 'System-RoomState',
      timestamp: now <= latest ? latest + 1 : now,
      imageIdentifier: '',
      tag: 'system room-state round',
      name: 'Round',
      text: `【${this.round}ラウンド目】`,
      round: this.round,
    };
    chatTab.addMessage(message);
  }

  private toNumber(value: number | string): number | null {
    let number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private isSameStatusName(effectStatusName: string, elementStatusName: string): boolean {
    return StringUtil.equals(effectStatusName.trim(), elementStatusName.trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth);
  }

  private effectKind(effect: Pick<BuffEffect | BuffTemplate | BuffEffectEntry, 'kind'>): BuffEffectKind {
    return effect.kind === 'note' ? 'note' : 'stat';
  }

  effectEntries(effect: Partial<BuffEffect | BuffTemplate>): BuffEffectEntry[] {
    if (Array.isArray(effect.effects) && 0 < effect.effects.length) {
      return this.normalizeEffectEntries(effect.effects);
    }

    return this.normalizeEffectEntries([{
      kind: this.effectKind(effect),
      statusName: effect.statusName ?? '',
      operator: effect.operator ?? '+',
      amount: Number(effect.amount ?? 0),
      description: effect.description ?? '',
    }]);
  }

  formatEffectEntries(entries: BuffEffectEntry[]): string {
    return entries.map(entry => entry.kind === 'note'
      ? entry.description ?? ''
      : `${entry.statusName}${entry.operator}${entry.amount}`
    ).join('; ');
  }

  private normalizeEffectEntries(entries: BuffEffectEntry[]): BuffEffectEntry[] {
    return (entries ?? []).map(entry => {
      let kind = this.effectKind(entry);
      let operator: BuffOperator = entry.operator === '-' || entry.operator === '*' ? entry.operator : '+';
      return {
        kind: kind,
        statusName: kind === 'note' ? '' : `${entry.statusName ?? ''}`.trim(),
        operator: operator,
        amount: kind === 'note' ? 0 : Number(entry.amount),
        description: kind === 'note' ? `${entry.description ?? ''}`.trim() : '',
      };
    }).filter(entry => entry.kind === 'note'
      ? 0 < (entry.description ?? '').length
      : 0 < entry.statusName.length && Number.isFinite(entry.amount));
  }

  private legacyEffectFields(entry: BuffEffectEntry): Pick<BuffTemplate, 'kind' | 'statusName' | 'operator' | 'amount' | 'description'> {
    return {
      kind: entry.kind,
      statusName: entry.statusName,
      operator: entry.operator,
      amount: entry.amount,
      description: entry.description ?? '',
    };
  }

  private isSameEffectContent(effect: BuffEffect, targetIdentifier: string, name: string, entries: BuffEffectEntry[]): boolean {
    if (effect.targetIdentifier !== targetIdentifier) return false;
    if (!this.isSameText(effect.name, name)) return false;
    return this.isSameEffectEntries(this.effectEntries(effect), entries);
  }

  private isSameEffectEntries(left: BuffEffectEntry[], right: BuffEffectEntry[]): boolean {
    if (left.length !== right.length) return false;

    let unmatched = right.slice();
    for (let entry of left) {
      let index = unmatched.findIndex(other => this.isSameEffectEntry(entry, other));
      if (index < 0) return false;
      unmatched.splice(index, 1);
    }
    return true;
  }

  private isSameEffectEntry(left: BuffEffectEntry, right: BuffEffectEntry): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === 'note') return this.isSameText(left.description ?? '', right.description ?? '');
    return this.isSameText(left.statusName, right.statusName)
      && left.operator === right.operator
      && Number(left.amount) === Number(right.amount);
  }

  private isSameText(a: string, b: string): boolean {
    return StringUtil.equals((a ?? '').trim(), (b ?? '').trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth);
  }
}
