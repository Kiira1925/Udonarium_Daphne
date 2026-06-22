import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { BuffEffect, BuffEffectEntry, BuffEffectKind, BuffOperator, BuffTemplate, RoomState } from '@udonarium/room-state';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';

import { PanelService } from 'service/panel.service';

interface EffectGroup {
  character: GameCharacter;
  effects: BuffEffect[];
}

interface TemplateForm {
  id: string;
  ownerIdentifier: string;
  name: string;
  effects: BuffEffectEntry[];
  durationRounds: number;
}

@Component({
  selector: 'effect-management',
  templateUrl: './effect-management.component.html',
  styleUrls: ['./effect-management.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EffectManagementComponent implements OnInit, OnDestroy {
  selectedOwnerIdentifier: string = '';
  editingTemplate: TemplateForm = this.createTemplateForm('');
  message: string = '';

  get roomState(): RoomState { return RoomState.instance; }
  get round(): number { return this.roomState.round; }
  get canManageRound(): boolean { return this.roomState.isGM(); }
  get actionDoneCount(): number { return this.roomState.actionDoneCount(); }
  get actionTargetCount(): number { return this.roomState.actionTargetCount(); }
  get canAdvanceRound(): boolean { return this.canManageRound && this.roomState.canAdvanceRound(); }
  get operators(): BuffOperator[] { return ['+', '-', '*']; }
  get effectKinds(): BuffEffectKind[] { return ['stat', 'note']; }

  get characters(): GameCharacter[] {
    return ObjectStore.instance.getObjects(GameCharacter)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get selectedOwner(): GameCharacter {
    return ObjectStore.instance.get<GameCharacter>(this.selectedOwnerIdentifier);
  }

  get selectedTemplates(): BuffTemplate[] {
    return this.selectedOwnerIdentifier ? this.roomState.templatesFor(this.selectedOwnerIdentifier) : [];
  }

  get selectedTargets(): GameCharacter[] {
    return this.roomState.selectedCharacters();
  }

  get effectGroups(): EffectGroup[] {
    let groups: EffectGroup[] = [];
    for (let effect of this.roomState.effects) {
      let character = ObjectStore.instance.get<GameCharacter>(effect.targetIdentifier);
      if (!(character instanceof GameCharacter)) continue;

      let group = groups.find(item => item.character === character);
      if (!group) {
        group = { character: character, effects: [] };
        groups.push(group);
      }
      group.effects.push(effect);
    }
    return groups.sort((a, b) => a.character.name.localeCompare(b.character.name));
  }

  get orphanEffects(): BuffEffect[] {
    return this.roomState.effects.filter(effect => !(ObjectStore.instance.get(effect.targetIdentifier) instanceof GameCharacter));
  }

  get canSaveTemplate(): boolean {
    if (!this.editingTemplate.ownerIdentifier
      || this.editingTemplate.name.trim().length < 1
      || !Number.isFinite(Number(this.editingTemplate.durationRounds))
      || Number(this.editingTemplate.durationRounds) < 1) {
      return false;
    }

    return 0 < this.editingTemplate.effects.length
      && this.editingTemplate.effects.every(effect => effect.kind === 'note'
        ? 0 < (effect.description ?? '').trim().length
        : 0 < effect.statusName.trim().length && Number.isFinite(Number(effect.amount)));
  }

  constructor(
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = '効果管理');
    this.ensureSelectedOwner();
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/aliasName/${GameCharacter.aliasName}`, event => {
        this.ensureSelectedOwner();
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/identifier/RoomState', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/room-effect-state', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/room-buff-template-state', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/character-action-state', event => {
        this.changeDetector.markForCheck();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (event.data.aliasName === GameCharacter.aliasName) this.ensureSelectedOwner();
        if (event.data.aliasName === GameCharacter.aliasName
          || event.data.aliasName === 'room-effect-state'
          || event.data.aliasName === 'room-buff-template-state'
          || event.data.aliasName === 'character-action-state') {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_SELECTION', event => {
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  openForCharacter(character: GameCharacter) {
    if (!(character instanceof GameCharacter)) return;
    this.selectedOwnerIdentifier = character.identifier;
    this.editingTemplate = this.createTemplateForm(character.identifier);
    this.message = '';
    this.changeDetector.markForCheck();
  }

  incrementRound() {
    if (!this.canManageRound) {
      this.message = 'ラウンド操作はGMモード中のユーザーのみ実行できます';
      return;
    }
    if (!this.roomState.canAdvanceRound()) {
      this.message = `未行動のテーブル上コマがあります（${this.actionDoneCount}/${this.actionTargetCount}）。全員が行動完了になるまでラウンドを進められません`;
      return;
    }
    this.roomState.incrementRound(1);
    this.message = '';
  }

  resetBattle() {
    if (!this.canManageRound) {
      this.message = 'ラウンド操作はGMモード中のユーザーのみ実行できます';
      return;
    }
    this.roomState.resetBattle();
  }

  removeEffect(effect: BuffEffect) {
    this.roomState.removeEffect(effect.id);
  }

  onOwnerChange(ownerIdentifier: string) {
    this.selectedOwnerIdentifier = ownerIdentifier;
    this.editingTemplate = this.createTemplateForm(ownerIdentifier);
    this.message = '';
  }

  newTemplate() {
    this.editingTemplate = this.createTemplateForm(this.selectedOwnerIdentifier);
    this.message = '';
  }

  editTemplate(template: BuffTemplate) {
    this.editingTemplate = {
      id: template.id,
      ownerIdentifier: template.ownerIdentifier,
      name: template.name,
      effects: this.roomState.effectEntries(template).map(effect => ({ ...effect })),
      durationRounds: template.durationRounds,
    };
    this.message = '';
  }

  saveTemplate() {
    if (!this.canSaveTemplate) {
      this.message = 'テンプレートの入力内容を確認してください';
      return;
    }

    let template: TemplateForm = {
      ...this.editingTemplate,
      name: this.editingTemplate.name.trim(),
      effects: this.editingTemplate.effects.map(effect => ({
        kind: effect.kind,
        statusName: effect.kind === 'stat' ? effect.statusName.trim() : '',
        operator: effect.kind === 'stat' ? effect.operator : '+',
        amount: effect.kind === 'stat' ? Number(effect.amount) : 0,
        description: effect.kind === 'note' ? (effect.description ?? '').trim() : '',
      })),
      durationRounds: Math.floor(Number(this.editingTemplate.durationRounds)),
    };

    if (template.id) {
      this.roomState.updateTemplate({
        ...template,
        ...this.legacyEffectFields(template.effects[0]),
      });
      this.message = 'テンプレートを更新しました';
    } else {
      this.roomState.addTemplate({
        ownerIdentifier: template.ownerIdentifier,
        name: template.name,
        effects: template.effects,
        ...this.legacyEffectFields(template.effects[0]),
        durationRounds: template.durationRounds,
      });
      this.message = 'テンプレートを追加しました';
    }
    this.editingTemplate = this.createTemplateForm(this.selectedOwnerIdentifier);
  }

  removeTemplate(template: BuffTemplate) {
    this.roomState.removeTemplate(template.id);
    if (this.editingTemplate.id === template.id) this.newTemplate();
    this.message = 'テンプレートを削除しました';
  }

  applyTemplate(template: BuffTemplate) {
    let count = this.roomState.applyTemplateToSelected(template);
    this.message = count
      ? `${template.name} を${count}体に付与しました`
      : '対象コマが選択されていません';
  }

  addTemplateEffect() {
    this.editingTemplate.effects.push(this.createEffectForm());
  }

  removeTemplateEffect(index: number) {
    if (this.editingTemplate.effects.length <= 1) return;
    this.editingTemplate.effects.splice(index, 1);
  }

  formatEffect(effect: BuffEffect | BuffTemplate): string {
    return this.roomState.effectEntries(effect).map(entry => {
      if (entry.kind === 'note') return entry.description ?? '';
      let sign = entry.operator === '*' ? 'x' : entry.operator;
      return `${entry.statusName} ${sign}${entry.amount}`;
    }).join(' / ');
  }

  effectKindLabel(kind: BuffEffectKind): string {
    return kind === 'note' ? '自由記述' : 'ステータス補正';
  }

  trackByEffect(_index: number, effect: BuffEffect): string {
    return effect.id;
  }

  trackByTemplate(_index: number, template: BuffTemplate): string {
    return template.id;
  }

  trackByGroup(_index: number, group: EffectGroup): string {
    return group.character.identifier;
  }

  trackByCharacter(_index: number, character: GameCharacter): string {
    return character.identifier;
  }

  private ensureSelectedOwner() {
    let characters = this.characters;
    if (characters.length < 1) {
      this.selectedOwnerIdentifier = '';
      this.editingTemplate = this.createTemplateForm('');
      return;
    }
    if (!this.selectedOwnerIdentifier || !characters.some(character => character.identifier === this.selectedOwnerIdentifier)) {
      this.selectedOwnerIdentifier = characters[0].identifier;
      this.editingTemplate = this.createTemplateForm(this.selectedOwnerIdentifier);
    }
  }

  private createTemplateForm(ownerIdentifier: string): TemplateForm {
    return {
      id: '',
      ownerIdentifier: ownerIdentifier,
      name: '',
      effects: [this.createEffectForm()],
      durationRounds: 1,
    };
  }

  private createEffectForm(): BuffEffectEntry {
    return {
      kind: 'stat',
      statusName: '',
      operator: '+',
      amount: 1,
      description: '',
    };
  }

  private legacyEffectFields(effect: BuffEffectEntry) {
    return {
      kind: effect.kind,
      statusName: effect.statusName,
      operator: effect.operator,
      amount: effect.amount,
      description: effect.description ?? '',
    };
  }
}
