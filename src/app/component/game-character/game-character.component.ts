import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { EventSystem, Network } from '@udonarium/core/system';
import { ResourceChangeEvent } from '@udonarium/core/system/event/observer';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GameCharacter } from '@udonarium/game-character';
import { BuffEffect, RoomState } from '@udonarium/room-state';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { EffectManagementComponent } from 'component/effect-management/effect-management.component';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopActionService } from 'service/tabletop-action.service';

@Component({
  selector: 'game-character',
  templateUrl: './game-character.component.html',
  styleUrls: ['./game-character.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('bounceInOut', [
      transition('void => *', [
        animate('600ms ease', keyframes([
          style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
          style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
          style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
          style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
          style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
        ]))
      ]),
      transition('* => void', [
        animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
      ])
    ])
  ]
})
export class GameCharacterComponent implements OnChanges, OnDestroy {
  @Input() gameCharacter: GameCharacter = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.gameCharacter.name; }
  get size(): number { return MathUtil.clampMin(this.gameCharacter.size); }
  get imageSize(): number { return this.size * this.gameCharacter.imageScale; }
  get imageFile(): ImageFile { return this.gameCharacter.imageFile; }
  get rotate(): number { return this.gameCharacter.rotate; }
  set rotate(rotate: number) { this.gameCharacter.rotate = rotate; }
  get roll(): number { return this.gameCharacter.roll; }
  set roll(roll: number) { this.gameCharacter.roll = roll; }

  get selectionState(): SelectionState { return this.selectionService.state(this.gameCharacter); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }
  get activeEffects(): BuffEffect[] {
    return RoomState.instance.effects.filter(effect => effect.targetIdentifier === this.gameCharacter.identifier);
  }
  get isRoundActive(): boolean { return 0 < RoomState.instance.round; }
  get isActionDone(): boolean { return RoomState.instance.isActionDone(this.gameCharacter); }
  get isActionExcluded(): boolean { return RoomState.instance.isActionExcluded(this.gameCharacter); }
  get canAccessCharacter(): boolean { return RoomState.instance.canAccessGMCharacter(this.gameCharacter); }

  gridSize: number = 50;

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  rollOption: RotableOption = {};
  private isDestroyed: boolean = false;
  private isViewUpdateQueued: boolean = false;
  resourceChanges: (ResourceChangeEvent & { id: number; lane: number; text: string })[] = [];
  private resourceChangeSequence: number = 0;
  private resourceChangeTimers = new Map<number, ReturnType<typeof setTimeout>>();

  get visibleResourceChanges() {
    if (!this.canAccessCharacter) return [];
    return this.resourceChanges.filter(change =>
      !(change.isStatusHidden || this.gameCharacter.isStatusHidden) || RoomState.instance.isGM());
  }

  constructor(
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService,
    private tabletopActionService: TabletopActionService
  ) { }

  ngOnChanges(): void {
    this.clearResourceChanges();
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('RESOURCE_VALUE_CHANGED', event => this.showResourceChange(event.data))
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameCharacter?.identifier}`, event => {
        this.requestViewUpdate();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.gameCharacter?.identifier}`, event => {
        this.requestViewUpdate();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.requestViewUpdate();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.requestViewUpdate();
      })
      .on(`UPDATE_SELECTION/identifier/${this.gameCharacter?.identifier}`, event => {
        this.requestViewUpdate();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.shouldRefreshForSharedState(event.data.aliasName, event.data.identifier)) {
          this.requestViewUpdate();
        }
      })
      .on('UPDATE_GAME_OBJECT/identifier/RoomState', event => {
        this.requestViewUpdate();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/room-effect-state', event => {
        this.requestViewUpdate();
      })
      .on('UPDATE_GAME_OBJECT/aliasName/character-action-state', event => {
        this.requestViewUpdate();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (event.data.aliasName === 'room-effect-state' || event.data.aliasName === 'character-action-state') {
          this.requestViewUpdate();
        }
      });
    this.movableOption = {
      tabletopObject: this.gameCharacter,
      transformCssOffset: 'translateZ(1.0px)',
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.gameCharacter
    };
    this.rollOption = {
      tabletopObject: this.gameCharacter,
      targetPropertyName: 'roll',
    };
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.clearResourceChanges();
    EventSystem.unregister(this);
  }

  private showResourceChange(change: ResourceChangeEvent) {
    if (change.characterIdentifier !== this.gameCharacter?.identifier
      || !Number.isFinite(change.delta) || change.delta === 0 || !this.canAccessCharacter
      || ((change.isStatusHidden || this.gameCharacter.isStatusHidden) && !RoomState.instance.isGM())) return;

    let id = ++this.resourceChangeSequence;
    let lane = 0;
    while (this.resourceChanges.some(item => item.lane === lane)) lane++;
    this.resourceChanges.push({ ...change, id: id, lane: lane, text: (change.delta > 0 ? '+' : '') + change.delta });
    this.resourceChangeTimers.set(id, setTimeout(() => this.removeResourceChange(id), 1700));
    this.requestViewUpdate();
  }

  removeResourceChange(id: number) {
    clearTimeout(this.resourceChangeTimers.get(id));
    this.resourceChangeTimers.delete(id);
    this.resourceChanges = this.resourceChanges.filter(change => change.id !== id);
    this.requestViewUpdate();
  }

  private clearResourceChanges() {
    this.resourceChangeTimers.forEach(timer => clearTimeout(timer));
    this.resourceChangeTimers.clear();
    this.resourceChanges = [];
  }

  private requestViewUpdate() {
    if (this.isDestroyed) return;
    this.changeDetector.markForCheck();
    if (this.isViewUpdateQueued) return;

    this.isViewUpdateQueued = true;
    Promise.resolve().then(() => {
      this.isViewUpdateQueued = false;
      if (!this.isDestroyed) this.changeDetector.detectChanges();
    });
  }

  private shouldRefreshForSharedState(aliasName: string, identifier: string): boolean {
    return identifier === 'RoomState'
      || aliasName === 'room-effect-state'
      || aliasName === 'character-action-state';
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e: any) {
    console.log('Dragstart Cancel !!!!');
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !e.ctrlKey) return;
    e.stopPropagation();
    e.preventDefault();

    this.selectionService.toggle(this.gameCharacter);
    SoundEffect.playLocal(PresetSound.selectionStart);
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    let position = this.pointerDeviceService.pointers[0];

    let menuActions: ContextMenuAction[] = [];
    menuActions = menuActions.concat(this.makeSelectionContextMenu());
    menuActions = menuActions.concat(this.makeContextMenu());
    this.contextMenuService.open(position, menuActions, this.name);
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.piecePick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.piecePut);
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.objects.length < 1) return [];

    let actions: ContextMenuAction[] = [];

    let objectPosition = {
      x: this.gameCharacter.location.x + (this.gameCharacter.size * this.gridSize) / 2,
      y: this.gameCharacter.location.y + (this.gameCharacter.size * this.gridSize) / 2,
      z: this.gameCharacter.posZ
    };
    actions.push({ name: 'ここに集める', action: () => this.selectionService.congregate(objectPosition) });
    let choiceAction = this.tabletopActionService.makeSelectionChoiceContextMenuAction();
    if (choiceAction) actions.push(choiceAction);

    if (this.isSelected) {
      let selectedCharacter = () => this.selectionService.objects.filter(object => object.aliasName === this.gameCharacter.aliasName) as GameCharacter[];
      actions.push(
        {
          name: '選択したキャラクター', action: null, subActions: [
            {
              name: 'すべて共有イベントリに移動', action: () => {
                selectedCharacter().forEach(gameCharacter => {
                  gameCharacter.setLocation('common')
                  this.selectionService.remove(gameCharacter);
                });
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: 'すべて個人イベントリに移動', action: () => {
                selectedCharacter().forEach(gameCharacter => {
                  gameCharacter.setLocation(Network.peerId);
                  this.selectionService.remove(gameCharacter);
                });
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: 'すべて墓場に移動', action: () => {
                selectedCharacter().forEach(gameCharacter => {
                  gameCharacter.setLocation('graveyard');
                  this.selectionService.remove(gameCharacter);
                });
                SoundEffect.play(PresetSound.sweep);
              }
            },
          ]
        }
      );
    }
    actions.push(ContextMenuSeparator);
    return actions;
  }

  private makeContextMenu(): ContextMenuAction[] {
    let actions: ContextMenuAction[] = [];

    if (this.canAccessCharacter) {
      actions.push({ name: '詳細を表示', action: () => { this.showDetail(this.gameCharacter); } });
      actions.push({ name: 'チャットパレットを表示', action: () => { this.showChatPalette(this.gameCharacter) } });
      actions.push({ name: '効果管理を開く', action: () => { this.showEffectManagement(this.gameCharacter) } });
    }
    if (this.isRoundActive) {
      actions.push({
        name: this.isActionDone && !this.isActionExcluded ? '未行動に戻す' : '行動完了にする',
        subMenuTitle: '',
        action: this.isActionExcluded ? null : () => {
          RoomState.instance.setActionDoneForCharacters(this.actionDoneTargets(), !this.isActionDone, true);
        },
        subActions: [{
          name: this.isActionExcluded ? '除外を解除する' : 'ラウンド進行の行動判定から除外する',
          action: () => {
            RoomState.instance.setActionExcludedForCharacters(this.actionDoneTargets(), !this.isActionExcluded, true);
          }
        }]
      });
    }
    actions.push(ContextMenuSeparator);
    actions.push({
      name: '共有イベントリに移動', action: () => {
        this.gameCharacter.setLocation('common');
        SoundEffect.play(PresetSound.piecePut);
      }
    });
    actions.push({
      name: '個人イベントリに移動', action: () => {
        this.gameCharacter.setLocation(Network.peerId);
        SoundEffect.play(PresetSound.piecePut);
      }
    });
    actions.push({
      name: '墓場に移動', action: () => {
        this.gameCharacter.setLocation('graveyard');
        SoundEffect.play(PresetSound.sweep);
      }
    });
    actions.push(ContextMenuSeparator);
    actions.push({
      name: 'コピーを作る', action: () => {
        let cloneObject = this.gameCharacter.clone();
        cloneObject.markAsCreatedBy(Network.peer.userId, RoomState.instance.isGM() || this.gameCharacter.isGMCreated);
        cloneObject.location.x += this.gridSize;
        cloneObject.location.y += this.gridSize;
        cloneObject.update();
        SoundEffect.play(PresetSound.piecePut);
      }
    });
    return actions;
  }

  private showDetail(gameObject: GameCharacter) {
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = 'キャラクターシート';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 400, top: coordinate.y - 300, width: 800, height: 600 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  private actionDoneTargets(): GameCharacter[] {
    if (!this.isSelected) return [this.gameCharacter];

    let selectedCharacters = this.selectionService.objects
      .filter((object): object is GameCharacter => object instanceof GameCharacter);
    return 1 < selectedCharacters.length ? selectedCharacters : [this.gameCharacter];
  }

  private showChatPalette(gameObject: GameCharacter) {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 615, height: 350 };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  private showEffectManagement(gameObject: GameCharacter) {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { width: 430, height: 620, left: coordinate.x - 100, top: coordinate.y - 300 };
    let component = this.panelService.open<EffectManagementComponent>(EffectManagementComponent, option);
    component.openForCharacter(gameObject);
  }

  formatEffectBadge(effect: BuffEffect): string {
    return `${effect.name} ${RoomState.instance.formatDuration(effect)}`;
  }

  formatEffectBadgeDetail(effect: BuffEffect): string {
    let content = RoomState.instance.formatEffectEntries(RoomState.instance.effectEntries(effect));
    let duration = RoomState.instance.formatDuration(effect);
    return content.length < 1 ? `${effect.name} ${duration}` : `${effect.name}: ${content} / ${duration}`;
  }
}
