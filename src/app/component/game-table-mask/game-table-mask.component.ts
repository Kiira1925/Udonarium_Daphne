import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { EventSystem, Network } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GameTableMaskScratchLock } from '@udonarium/game-table-mask-scratch-lock';
import { GameTableMask, GameTableMaskScratchArea } from '@udonarium/game-table-mask';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { CoordinateService } from 'service/coordinate.service';
import { GameTableMaskScratchService } from 'service/game-table-mask-scratch.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';

@Component({
  selector: 'game-table-mask',
  templateUrl: './game-table-mask.component.html',
  styleUrls: ['./game-table-mask.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GameTableMaskComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() gameTableMask: GameTableMask = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.gameTableMask.name; }
  get width(): number { return MathUtil.clampMin(this.gameTableMask.width); }
  get height(): number { return MathUtil.clampMin(this.gameTableMask.height); }
  get opacity(): number { return this.gameTableMask.opacity; }
  get imageFile(): ImageFile { return this.gameTableMask.imageFile; }
  get scratchAreas(): GameTableMaskScratchArea[] { return this.gameTableMask.scratchAreas; }
  get isLock(): boolean { return this.gameTableMask.isLock; }
  set isLock(isLock: boolean) { this.gameTableMask.isLock = isLock; }

  get scratchLock(): GameTableMaskScratchLock | null {
    return this.scratchService.lockFor(this.gameTableMask?.identifier);
  }
  get isScratchLocked(): boolean {
    return this.isScratchLockPending || this.isScratchEditing || this.scratchLock != null;
  }
  get isScratchLockedByOther(): boolean {
    let lock = this.scratchLock;
    return lock != null
      && lock.ownerPeerId !== Network.peerId
      && this.scratchService.isPeerOnline(lock.ownerPeerId);
  }
  get scratchLockOwnerName(): string {
    let lock = this.scratchLock;
    if (!lock) return '';
    if (lock.ownerPeerId === Network.peerId) return '自分';
    return PeerCursor.findByPeerId(lock.ownerPeerId)?.name || '他のユーザー';
  }
  get scratchLockStatusText(): string {
    let lock = this.scratchLock;
    if (!lock) return '';
    if (lock.ownerPeerId === Network.peerId) return '自分のスクラッチ編集ロックを保持中';
    if (this.scratchService.isPeerOnline(lock.ownerPeerId)) return `${this.scratchLockOwnerName} が編集中`;
    return '切断されたユーザーの編集ロックが残っています';
  }
  get scratchMaskId(): string {
    return `table-mask-scratch-${(this.gameTableMask?.identifier ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }
  get scratchViewBox(): string { return `0 0 ${this.width} ${this.height}`; }
  get scratchColumns(): number { return Math.max(1, Math.ceil(this.width)); }
  get scratchRows(): number { return Math.max(1, Math.ceil(this.height)); }

  get selectionState(): SelectionState { return this.selectionService.state(this.gameTableMask); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  get scratchSelection(): GameTableMaskScratchArea | null {
    if (!this.scratchSelectionStart || !this.scratchSelectionEnd) return null;
    let left = Math.min(this.scratchSelectionStart.x, this.scratchSelectionEnd.x);
    let top = Math.min(this.scratchSelectionStart.y, this.scratchSelectionEnd.y);
    let right = Math.max(this.scratchSelectionStart.x, this.scratchSelectionEnd.x);
    let bottom = Math.max(this.scratchSelectionStart.y, this.scratchSelectionEnd.y);
    return {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    };
  }
  get scratchSelectionLabel(): string {
    let area = this.scratchSelection;
    if (!area) return '公開する範囲をドラッグで選択';
    return `${area.width} × ${area.height} グリッドを選択中`;
  }

  gridSize: number = 50;

  movableOption: MovableOption = {};

  isScratchEditing: boolean = false;
  isScratchLockPending: boolean = false;
  isScratchCommitting: boolean = false;

  private input: InputHandler = null;
  private scratchLockToken: string = '';
  private scratchSelectionStart: { x: number, y: number } | null = null;
  private scratchSelectionEnd: { x: number, y: number } | null = null;
  private scratchPointerId: number | null = null;
  private isDestroyed: boolean = false;

  constructor(
    private ngZone: NgZone,
    private tabletopActionService: TabletopActionService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService,
    private coordinateService: CoordinateService,
    private scratchService: GameTableMaskScratchService,
    private modalService: ModalService,
  ) { }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameTableMask?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.gameTableMask?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${PeerCursor.aliasName}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_SELECTION/identifier/${this.gameTableMask?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${GameTableMaskScratchLock.aliasName}`, event => {
        if (event.data.identifier !== GameTableMaskScratchLock.identifierFor(this.gameTableMask?.identifier)) return;
        if (this.isScratchEditing
          && !this.isScratchCommitting
          && !this.scratchService.isOwnedByMe(this.gameTableMask.identifier, this.scratchLockToken)) {
          this.finishScratchEditing(true);
          this.showScratchMessage('スクラッチ編集を終了しました', '他のユーザーへ編集ロックが移ったため、選択内容は確定されていません。');
        }
        this.changeDetector.markForCheck();
      })
      .on('CLOSE_NETWORK', event => {
        if (this.isScratchEditing) this.finishScratchEditing(false);
        this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.gameTableMask,
      transformCssOffset: 'translateZ(0.15px)',
      colideLayers: ['terrain']
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    this.finishScratchEditing(true);
    this.input?.destroy();
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.input.cancel();

    // TODO:もっと良い方法考える
    if (this.isLock || this.isScratchLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    let menuPosition = this.pointerDeviceService.pointers[0];

    let menuActions: ContextMenuAction[] = [];
    if (this.isScratchLocked && !this.isScratchEditing) {
      menuActions = this.makeScratchLockContextMenu();
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }

    this.contextMenuService.open(menuPosition, menuActions, this.name);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(e: KeyboardEvent) {
    if (!this.isScratchEditing || this.isScratchCommitting) return;
    e.preventDefault();
    this.cancelScratchEditing();
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnterKey(e: KeyboardEvent) {
    if (!this.isScratchEditing || this.isScratchCommitting || !this.scratchSelection) return;
    let target = e.target as HTMLElement;
    if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    e.preventDefault();
    void this.confirmScratchEditing();
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
  }

  async startScratchEditing() {
    if (this.isScratchEditing || this.isScratchLockPending || this.isScratchLockedByOther) return;

    this.isScratchLockPending = true;
    this.changeDetector.markForCheck();
    let token = await this.scratchService.acquire(this.gameTableMask.identifier);
    this.isScratchLockPending = false;

    if (this.isDestroyed) {
      if (token) this.scratchService.release(this.gameTableMask.identifier, token);
      return;
    }
    if (!token) {
      this.changeDetector.markForCheck();
      this.showScratchMessage('スクラッチ編集を開始できません', '他のユーザーが操作中か、編集ロックの取得がタイムアウトしました。');
      return;
    }

    this.scratchLockToken = token;
    this.scratchSelectionStart = null;
    this.scratchSelectionEnd = null;
    this.isScratchEditing = true;
    SoundEffect.play(PresetSound.selectionStart);
    this.changeDetector.markForCheck();
  }

  async confirmScratchEditing() {
    let area = this.scratchSelection;
    if (!area || !this.isScratchEditing || this.isScratchCommitting) return;

    this.isScratchCommitting = true;
    this.changeDetector.markForCheck();
    let committed = await this.scratchService.commit(this.gameTableMask.identifier, this.scratchLockToken, area);
    this.isScratchCommitting = false;

    if (this.isDestroyed) return;
    if (committed === true) {
      this.finishScratchEditing(false);
      SoundEffect.play(PresetSound.unlock);
    } else if (committed === false) {
      this.finishScratchEditing(true);
      this.showScratchMessage('スクラッチ範囲を確定できません', '編集ロックが失われたため、選択内容は公開されていません。');
    } else {
      this.finishScratchEditing(true);
      this.showScratchMessage(
        'スクラッチ範囲の確定結果を確認できません',
        '通信がタイムアウトしました。公開済みの可能性があるため、マップマスクの表示を確認してください。'
      );
    }
    this.changeDetector.markForCheck();
  }

  cancelScratchEditing() {
    if (!this.isScratchEditing || this.isScratchCommitting) return;
    this.finishScratchEditing(true);
    SoundEffect.play(PresetSound.unlock);
  }

  onScratchPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (!this.isScratchEditing || this.isScratchCommitting || e.button !== 0) return;
    if (!e.isPrimary || (this.scratchPointerId != null && this.scratchPointerId !== e.pointerId)) return;
    e.preventDefault();

    let element = e.currentTarget as HTMLElement;
    element.setPointerCapture(e.pointerId);
    let cell = this.scratchCellAt(e, element);
    this.scratchPointerId = e.pointerId;
    this.scratchSelectionStart = cell;
    this.scratchSelectionEnd = cell;
    this.changeDetector.markForCheck();
  }

  onScratchPointerMove(e: PointerEvent) {
    e.stopPropagation();
    if (this.scratchPointerId !== e.pointerId || !this.scratchSelectionStart) return;
    e.preventDefault();
    this.scratchSelectionEnd = this.scratchCellAt(e, e.currentTarget as HTMLElement);
    this.changeDetector.markForCheck();
  }

  onScratchPointerUp(e: PointerEvent) {
    e.stopPropagation();
    if (this.scratchPointerId !== e.pointerId) return;
    e.preventDefault();

    this.scratchSelectionEnd = this.scratchCellAt(e, e.currentTarget as HTMLElement);
    this.scratchPointerId = null;
    let element = e.currentTarget as HTMLElement;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    this.changeDetector.markForCheck();
  }

  onScratchPointerCancel(e: PointerEvent) {
    e.stopPropagation();
    if (this.scratchPointerId !== e.pointerId) return;
    e.preventDefault();

    this.scratchPointerId = null;
    let element = e.currentTarget as HTMLElement;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    this.changeDetector.markForCheck();
  }

  suppressScratchContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();
  }

  suppressScratchGesture(e: Event) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.objects.length < 1) return [];

    let actions: ContextMenuAction[] = [];

    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    actions.push({ name: 'ここに集める', action: () => this.selectionService.congregate(objectPosition) });

    if (this.isSelected) {
      let selectedGameTableMasks = () => this.selectionService.objects
        .filter(object => object.aliasName === this.gameTableMask.aliasName)
        .filter(object => !this.scratchService.lockFor(object.identifier)) as GameTableMask[];
      actions.push(
        {
          name: '選択したマップマスク', action: null, subActions: [
            {
              name: 'すべて固定する', action: () => {
                selectedGameTableMasks().forEach(gameTableMask => gameTableMask.isLock = true);
                SoundEffect.play(PresetSound.lock);
              }
            },
            {
              name: 'すべてのコピーを作る', action: () => {
                selectedGameTableMasks().forEach(gameTableMask => {
                  let cloneObject = gameTableMask.clone();
                  cloneObject.location.x += this.gridSize;
                  cloneObject.location.y += this.gridSize;
                  cloneObject.isLock = false;
                  if (gameTableMask.parent) gameTableMask.parent.appendChild(cloneObject);
                });
                SoundEffect.play(PresetSound.cardPut);
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
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    let actions: ContextMenuAction[] = [];
    actions.push((this.isLock
      ? {
        name: '固定解除', action: () => {
          if (!this.canModifyMask()) return;
          this.isLock = false;
          SoundEffect.play(PresetSound.unlock);
        }
      }
      : {
        name: '固定する', action: () => {
          if (!this.canModifyMask()) return;
          this.isLock = true;
          SoundEffect.play(PresetSound.lock);
        }
      }
    ));
    if (!this.isLock) {
      actions.push(ContextMenuSeparator);
      actions.push({
        name: '重なり順を一番上に', action: () => {
          if (!this.canModifyMask()) return;
          let parent = this.gameTableMask.parent;
          if (parent) parent.appendChild(this.gameTableMask);
        }
      });
      actions.push({
        name: '重なり順を一番下に', action: () => {
          if (!this.canModifyMask()) return;
          let parent = this.gameTableMask.parent;
          if (parent) parent.prependChild(this.gameTableMask);
        }
      });
    }
    actions.push(ContextMenuSeparator);
    actions.push({ name: 'スクラッチで一部公開', action: () => { void this.startScratchEditing(); } });
    actions.push({
      name: 'マップマスクを編集', action: () => {
        if (!this.canModifyMask()) return;
        this.showDetail(this.gameTableMask);
      }
    });
    actions.push({
      name: 'コピーを作る', action: () => {
        if (!this.canModifyMask()) return;
        let cloneObject = this.gameTableMask.clone();
        cloneObject.location.x += this.gridSize;
        cloneObject.location.y += this.gridSize;
        cloneObject.isLock = false;
        if (this.gameTableMask.parent) this.gameTableMask.parent.appendChild(cloneObject);
        SoundEffect.play(PresetSound.cardPut);
      }
    });
    actions.push({
      name: '削除する', action: () => {
        if (!this.canModifyMask()) return;
        this.gameTableMask.destroy();
        SoundEffect.play(PresetSound.sweep);
      }
    });
    actions.push(ContextMenuSeparator);
    actions.push({ name: 'オブジェクト作成', action: null, subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition) });
    return actions;
  }

  private makeScratchLockContextMenu(): ContextMenuAction[] {
    if (this.isScratchLockPending) {
      return [{ name: 'スクラッチ編集ロックを取得中…', action: null }];
    }

    let lock = this.scratchLock;
    if (!lock) return [{ name: 'スクラッチ編集中', action: null }];
    if (lock.ownerPeerId !== Network.peerId) {
      if (!this.scratchService.isPeerOnline(lock.ownerPeerId)) {
        return [{
          name: '古い編集ロックを回収してスクラッチを開始',
          action: () => { void this.startScratchEditing(); }
        }];
      }
      return [{ name: `${this.scratchLockOwnerName} がスクラッチ編集中`, action: null }];
    }
    return [
      { name: 'スクラッチ編集を再開', action: () => { void this.startScratchEditing(); } },
      {
        name: 'スクラッチ編集をキャンセル', action: () => {
          this.scratchService.release(this.gameTableMask.identifier, lock.token);
        }
      },
    ];
  }

  private scratchCellAt(e: PointerEvent, element: HTMLElement): { x: number, y: number } {
    let local = this.coordinateService.convertToLocal({ x: e.pageX, y: e.pageY, z: 0 }, element);
    return {
      x: Math.max(0, Math.min(this.scratchColumns - 1, Math.floor(local.x / this.gridSize))),
      y: Math.max(0, Math.min(this.scratchRows - 1, Math.floor(local.y / this.gridSize))),
    };
  }

  private finishScratchEditing(releaseLock: boolean) {
    let token = this.scratchLockToken;
    this.scratchLockToken = '';
    this.scratchSelectionStart = null;
    this.scratchSelectionEnd = null;
    this.scratchPointerId = null;
    this.isScratchEditing = false;
    this.isScratchCommitting = false;
    if (releaseLock && token && this.gameTableMask) {
      this.scratchService.release(this.gameTableMask.identifier, token);
    }
    if (!this.isDestroyed) this.changeDetector.markForCheck();
  }

  private canModifyMask(): boolean {
    return !this.scratchService.lockFor(this.gameTableMask.identifier);
  }

  private showScratchMessage(title: string, text: string) {
    void this.modalService.open(TextViewComponent, { title: title, text: text });
  }

  private showDetail(gameObject: GameTableMask) {
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = 'マップマスク設定';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 200, top: coordinate.y - 150, width: 400, height: 300 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }
}
