import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { EventSystem } from '@udonarium/core/system';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RoomState } from '@udonarium/room-state';
import { TabletopObject } from '@udonarium/tabletop-object';
import { GameTableMaskScratchService } from 'service/game-table-mask-scratch.service';

@Component({
  selector: 'game-data-element, [game-data-element]',
  templateUrl: './game-data-element.component.html',
  styleUrls: ['./game-data-element.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GameDataElementComponent implements OnInit, OnChanges, OnDestroy {
  @Input() gameDataElement: DataElement = null;
  @Input() isEdit: boolean = false;
  @Input() isTagLocked: boolean = false;
  @Input() isValueLocked: boolean = false;

  private _name: string = '';
  get name(): string { return this._name; }
  set name(name: string) { this._name = name; this.setUpdateTimer(); }

  private _value: number | string = 0;
  get value(): number | string { return this._value; }
  set value(value: number | string) { this._value = value; this.setUpdateTimer(); }

  private _currentValue: number | string = 0;
  get currentValue(): number | string { return this._currentValue; }
  set currentValue(currentValue: number | string) { this._currentValue = currentValue; this.setUpdateTimer(); }

  get effectModifierText(): string {
    return this.effectModifierSummary()?.modifierText ?? '';
  }

  get effectModifiedValue(): string {
    return this.effectModifierSummary()?.modifiedValue ?? '';
  }

  private updateTimer: NodeJS.Timeout = null;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private gameTableMaskScratchService: GameTableMaskScratchService
  ) { }

  ngOnInit() {
    if (this.gameDataElement) this.setValues(this.gameDataElement);
  }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameDataElement?.identifier}`, event => {
        this.setValues(this.gameDataElement);
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/room-effect-state', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/room-state', event => {
        this.changeDetector.markForCheck();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.gameDataElement && this.gameDataElement.identifier === event.data.identifier) {
          this.changeDetector.markForCheck();
        }
        if (event.data.aliasName === 'room-effect-state') {
          this.changeDetector.markForCheck();
        }
      });
  }

  ngOnDestroy() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
      this.applyPendingValues();
    }
    EventSystem.unregister(this);
  }

  addElement() {
    this.gameDataElement.appendChild(DataElement.create('タグ', '', {}));
  }

  deleteElement() {
    this.gameDataElement.destroy();
  }

  upElement() {
    let parentElement = this.gameDataElement.parent;
    let index: number = parentElement.children.indexOf(this.gameDataElement);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.gameDataElement, prevElement);
    }
  }

  downElement() {
    let parentElement = this.gameDataElement.parent;
    let index: number = parentElement.children.indexOf(this.gameDataElement);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.gameDataElement);
    }
  }

  setElementType(type: string) {
    this.gameDataElement.setAttribute('type', type);
  }

  private setValues(object: DataElement) {
    this._name = object.name;
    this._currentValue = object.currentValue;
    this._value = object.value;
  }

  private effectModifierSummary(): { modifierText: string, modifiedValue: string } | null {
    if (!this.gameDataElement || 0 < this.gameDataElement.children.length) return null;
    let owner = this.ownerCharacter();
    if (!owner) return null;
    return RoomState.instance.effectModifierSummary(owner.identifier, this.gameDataElement);
  }

  private ownerCharacter(): GameCharacter | null {
    let owner = this.ownerTabletopObject();
    return owner instanceof GameCharacter ? owner : null;
  }

  private ownerTabletopObject(): TabletopObject | null {
    let node: ObjectNode = this.gameDataElement;
    while (node) {
      if (node.parent && !(node.parent instanceof DataElement)) {
        return node.parent instanceof TabletopObject ? node.parent : null;
      }
      node = node.parent;
    }
    return null;
  }

  private setUpdateTimer() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.applyPendingValues();
    }, 66);
  }

  private applyPendingValues() {
    if (!this.gameDataElement || this.isScratchMutationBlocked()) return;
    if (this.gameDataElement.name !== this.name) this.gameDataElement.name = this.name;
    if (this.gameDataElement.currentValue !== this.currentValue) this.gameDataElement.currentValue = this.currentValue;
    if (this.gameDataElement.value !== this.value) this.gameDataElement.value = this.value;
  }

  private isScratchMutationBlocked(): boolean {
    let owner = this.ownerTabletopObject();
    return owner instanceof GameTableMask
      && this.gameTableMaskScratchService.lockFor(owner.identifier) != null;
  }
}
