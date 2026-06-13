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

export interface BuffEffect {
  id: string;
  targetIdentifier: string;
  kind?: BuffEffectKind;
  name: string;
  statusName: string;
  operator: BuffOperator;
  amount: number;
  description?: string;
  remainingRounds: number;
  createdRound: number;
}

export interface BuffTemplate {
  id: string;
  ownerIdentifier: string;
  kind?: BuffEffectKind;
  name: string;
  statusName: string;
  operator: BuffOperator;
  amount: number;
  description?: string;
  durationRounds: number;
}

export interface CharacterEffectState {
  templates?: Partial<BuffTemplate>[];
  effects?: Partial<BuffEffect>[];
}

@SyncObject('room-state')
export class RoomState extends GameObject {
  private static readonly identifier = 'RoomState';

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
  @SyncVar() roomMasterUserId: string = '';
  @SyncVar() gmUserIds: string[] = [];

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

  addEffect(target: GameCharacter, name: string, statusName: string, operator: BuffOperator, amount: number, remainingRounds: number, kind: BuffEffectKind = 'stat', description: string = ''): BuffEffect | null {
    let duplicate = this.effects.find(effect => this.isSameEffect(effect, target.identifier, name, statusName, operator, amount, remainingRounds, kind, description));
    if (duplicate) return null;

    let newEffect: BuffEffect = {
      id: UUID.generateUuid(),
      targetIdentifier: target.identifier,
      kind: kind,
      name: name,
      statusName: statusName,
      operator: operator,
      amount: amount,
      description: description,
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
    this.grantGMInternal(userId);
  }

  isRoomMaster(userId: string = Network.peer.userId): boolean {
    return !!userId && this.roomMasterUserId === userId;
  }

  isGM(userId: string = Network.peer.userId): boolean {
    return !!userId && this.gmUserIds.includes(userId);
  }

  canManageGM(userId: string = Network.peer.userId): boolean {
    return this.isGM(userId);
  }

  grantGM(userId: string): boolean {
    if (!this.canManageGM() || !userId) return false;
    return this.grantGMInternal(userId);
  }

  revokeGM(userId: string): boolean {
    if (!this.canManageGM() || !userId || this.isRoomMaster(userId)) return false;
    if (!this.gmUserIds.includes(userId)) return false;
    this.gmUserIds = this.gmUserIds.filter(item => item !== userId);
    return true;
  }

  canAccessGMCharacter(character: GameCharacter): boolean {
    return !character.isGMCreated || this.isGM();
  }

  applyTemplateToSelected(template: BuffTemplate): number {
    let addedCount = 0;
    let targets = this.selectedCharacters();
    for (let target of targets) {
      if (this.addEffect(target, template.name, template.statusName, template.operator, template.amount, template.durationRounds, this.effectKind(template), template.description ?? '')) {
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
    return removedCount;
  }

  addTemplate(template: Omit<BuffTemplate, 'id'>): BuffTemplate {
    let created: BuffTemplate = {
      ...template,
      id: UUID.generateUuid(),
      kind: this.effectKind(template),
      amount: Number(template.amount),
      durationRounds: Math.floor(Number(template.durationRounds)),
    };
    this.buffTemplates = this.buffTemplates.concat(created);
    return created;
  }

  updateTemplate(template: BuffTemplate) {
    let updated: BuffTemplate = {
      ...template,
      kind: this.effectKind(template),
      amount: Number(template.amount),
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

  exportStateForCharacter(character: GameCharacter): CharacterEffectState {
    return {
      templates: this.templatesFor(character.identifier).map(template => ({
        kind: this.effectKind(template),
        name: template.name,
        statusName: template.statusName,
        operator: template.operator,
        amount: template.amount,
        description: template.description ?? '',
        durationRounds: template.durationRounds,
      })),
      effects: this.effects
        .filter(effect => effect.targetIdentifier === character.identifier)
        .map(effect => ({
          kind: this.effectKind(effect),
          name: effect.name,
          statusName: effect.statusName,
          operator: effect.operator,
          amount: effect.amount,
          description: effect.description ?? '',
          remainingRounds: effect.remainingRounds,
        })),
    };
  }

  importStateForCharacter(character: GameCharacter, state: CharacterEffectState | null): { templates: number, effects: number } {
    let imported = { templates: 0, effects: 0 };
    if (!state) return imported;

    for (let template of state.templates ?? []) {
      let normalized = this.normalizeTemplate(character.identifier, template);
      if (!normalized || this.hasSameTemplate(normalized)) continue;
      this.addTemplate(normalized);
      imported.templates++;
    }

    for (let effect of state.effects ?? []) {
      let normalized = this.normalizeEffect(effect);
      if (!normalized) continue;
      if (this.addEffect(character, normalized.name, normalized.statusName, normalized.operator, normalized.amount, normalized.remainingRounds, normalized.kind, normalized.description)) {
        imported.effects++;
      }
    }
    return imported;
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
      if (effect.operator === '*') {
        multipliers *= effect.amount;
      } else if (effect.operator === '+') {
        additions += effect.amount;
      } else if (effect.operator === '-') {
        additions -= effect.amount;
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
      && this.effectKind(effect) === 'stat'
      && (statusName == null || this.isSameStatusName(effect.statusName, statusName))
    );
  }

  selectedCharacters(): GameCharacter[] {
    let objects = TabletopSelectionService.instance?.objects ?? [];
    return objects.filter((object): object is GameCharacter => object instanceof GameCharacter);
  }

  private async onSendMessage(tabIdentifier: string, messageIdentifier: string) {
    let chatMessage = ObjectStore.instance.get<ChatMessage>(messageIdentifier);
    if (!chatMessage || !chatMessage.isSendFromSelf || chatMessage.isSystem) return;

    let text = (chatMessage.text ?? '').trim();
    if (await this.handleResourceCommand(text, chatMessage, tabIdentifier)) return;
    if (!text.startsWith('/')) return;

    if (this.handleBuffCommand(text, chatMessage, tabIdentifier)) return;
    if (this.handleRoundCommand(text, chatMessage, tabIdentifier)) return;
  }

  private async handleResourceCommand(text: string, chatMessage: ChatMessage, tabIdentifier: string): Promise<boolean> {
    if (!text.startsWith(':')) return false;

    let parsed = /^:\s*(.+?)\s*([+\-*/=])\s*(.+)$/.exec(text);
    if (!parsed) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'リソース操作書式: :HP-1d6 / :MP+2 / :HP=10');
      return true;
    }

    let source = ObjectStore.instance.get<GameCharacter>(chatMessage.sourceIdentifier);
    if (!(source instanceof GameCharacter)) {
      this.sendSystemMessage(chatMessage, tabIdentifier, 'リソース操作には、送信元にキャラコマを指定してください');
      return true;
    }

    let resourceName = parsed[1].trim();
    let operator = parsed[2];
    let options = this.parseResourceOptions(parsed[3].trim());
    let expression = options.expression;
    let shouldHideResourceChat = source.isStatusHidden;
    if (shouldHideResourceChat) {
      chatMessage.setAttribute('gmText', text);
      chatMessage.value = `:${resourceName} ??`;
    }
    let expressionForEvaluate = operator === '+' || operator === '-' ? operator + expression : expression;
    let operatorForCalculate = operator === '+' || operator === '-' ? '+' : operator;
    let resource = this.findNumberResource(source, resourceName);
    if (!resource) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `${source.name} に「${resourceName}」リソースは見つかりません`);
      return true;
    }

    let operand = await this.evaluateResourceExpression(expressionForEvaluate, chatMessage.tag);
    if (operand == null) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `式を数値として評価できません: ${expressionForEvaluate}`);
      return true;
    }
    operand = this.applyResourceOperandOptions(operator, operand, options);

    let current = this.toNumber(resource.currentValue);
    if (current == null) current = 0;

    let next = this.calculateResourceValue(current, operatorForCalculate, operand);
    if (next == null) {
      this.sendSystemMessage(chatMessage, tabIdentifier, `リソース操作に失敗しました: ${operator}${expression}`);
      return true;
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
    return true;
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
      this.sendSystemMessage(chatMessage, tabIdentifier, 'バフ書式: /buff バフ名/ステータス+数値/効果時間');
      return true;
    }

    let targets = this.selectedCharacters();
    if (targets.length < 1) {
      this.sendSystemMessage(chatMessage, tabIdentifier, '対象コマが選択されていません');
      return true;
    }

    let addedCount = 0;
    for (let target of targets) {
      if (this.addEffect(target, parsed.name, parsed.statusName, parsed.operator, parsed.amount, parsed.durationRounds, parsed.kind, parsed.description)) {
        addedCount++;
      }
    }

    this.sendSystemMessage(chatMessage, tabIdentifier, `${parsed.name}: ${parsed.statusName}${parsed.operator}${parsed.amount} / 残り${parsed.durationRounds}R を${addedCount}体に付与`);
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
    let effect = /^(.+?)([+\-*])(-?\d+(?:\.\d+)?)$/.exec(effectText);
    let duration = Number(durationText);
    if (!Number.isFinite(duration) || duration < 1) return null;

    if (!effect) {
      return {
        kind: 'note',
        name: name,
        statusName: '',
        operator: '+',
        amount: 0,
        description: effectText,
        durationRounds: Math.floor(duration),
      };
    }

    return {
      kind: 'stat',
      name: name,
      statusName: effect[1].trim(),
      operator: effect[2] as BuffOperator,
      amount: Number(effect[3]),
      description: '',
      durationRounds: Math.floor(duration),
    };
  }

  private removeCharacterState(targetIdentifier: string) {
    this.removeEffectsByTarget(targetIdentifier);
    this.removeTemplatesByOwner(targetIdentifier);
  }

  private removeEffectsByTarget(targetIdentifier: string) {
    if (!this.effects.some(effect => effect.targetIdentifier === targetIdentifier)) return;
    this.effects = this.effects.filter(effect => effect.targetIdentifier !== targetIdentifier);
  }

  private removeTemplatesByOwner(ownerIdentifier: string) {
    if (!this.buffTemplates.some(template => template.ownerIdentifier === ownerIdentifier)) return;
    this.buffTemplates = this.buffTemplates.filter(template => template.ownerIdentifier !== ownerIdentifier);
  }

  private normalizeTemplate(ownerIdentifier: string, template: Partial<BuffTemplate>): Omit<BuffTemplate, 'id'> | null {
    let durationRounds = Math.floor(Number(template.durationRounds));
    let kind: BuffEffectKind = template.kind === 'note' ? 'note' : 'stat';
    let normalized: Omit<BuffTemplate, 'id'> = {
      ownerIdentifier: ownerIdentifier,
      kind: kind,
      name: `${template.name ?? ''}`.trim(),
      statusName: kind === 'note' ? '' : `${template.statusName ?? ''}`.trim(),
      operator: this.normalizeOperator(template.operator),
      amount: Number(template.amount),
      description: `${template.description ?? ''}`.trim(),
      durationRounds: durationRounds,
    };
    if (normalized.name.length < 1 || !Number.isFinite(durationRounds) || durationRounds < 1) return null;
    if (kind === 'note') return normalized.description.length ? normalized : null;
    return normalized.statusName.length && Number.isFinite(normalized.amount) ? normalized : null;
  }

  private normalizeEffect(effect: Partial<BuffEffect>): Omit<BuffEffect, 'id' | 'targetIdentifier' | 'createdRound'> | null {
    let remainingRounds = Math.floor(Number(effect.remainingRounds));
    let kind: BuffEffectKind = effect.kind === 'note' ? 'note' : 'stat';
    let normalized: Omit<BuffEffect, 'id' | 'targetIdentifier' | 'createdRound'> = {
      kind: kind,
      name: `${effect.name ?? ''}`.trim(),
      statusName: kind === 'note' ? '' : `${effect.statusName ?? ''}`.trim(),
      operator: this.normalizeOperator(effect.operator),
      amount: Number(effect.amount),
      description: `${effect.description ?? ''}`.trim(),
      remainingRounds: remainingRounds,
    };
    if (normalized.name.length < 1 || !Number.isFinite(remainingRounds) || remainingRounds < 1) return null;
    if (kind === 'note') return normalized.description.length ? normalized : null;
    return normalized.statusName.length && Number.isFinite(normalized.amount) ? normalized : null;
  }

  private normalizeOperator(operator: BuffOperator | string): BuffOperator {
    return operator === '-' || operator === '*' ? operator : '+';
  }

  private hasSameTemplate(template: Omit<BuffTemplate, 'id'>): boolean {
    return this.templatesFor(template.ownerIdentifier).some(item =>
      this.effectKind(item) === template.kind
      && this.isSameText(item.name, template.name)
      && item.durationRounds === template.durationRounds
      && (template.kind === 'note'
        ? this.isSameText(item.description ?? '', template.description ?? '')
        : this.isSameText(item.statusName, template.statusName)
          && item.operator === template.operator
          && Number(item.amount) === Number(template.amount))
    );
  }

  private grantGMInternal(userId: string): boolean {
    if (this.gmUserIds.includes(userId)) return false;
    this.gmUserIds = this.gmUserIds.concat(userId);
    return true;
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

  private effectKind(effect: Pick<BuffEffect | BuffTemplate, 'kind'>): BuffEffectKind {
    return effect.kind === 'note' ? 'note' : 'stat';
  }

  private isSameEffect(effect: BuffEffect, targetIdentifier: string, name: string, statusName: string, operator: BuffOperator, amount: number, remainingRounds: number, kind: BuffEffectKind, description: string): boolean {
    if (effect.targetIdentifier !== targetIdentifier) return false;
    if (this.effectKind(effect) !== kind) return false;
    if (!this.isSameText(effect.name, name)) return false;
    if (effect.remainingRounds !== remainingRounds) return false;

    if (kind === 'note') return this.isSameText(effect.description ?? '', description);

    return this.isSameText(effect.statusName, statusName)
      && effect.operator === operator
      && Number(effect.amount) === Number(amount);
  }

  private isSameText(a: string, b: string): boolean {
    return StringUtil.equals((a ?? '').trim(), (b ?? '').trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth);
  }
}
