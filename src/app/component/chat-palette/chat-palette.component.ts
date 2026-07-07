import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ChatPalette } from '@udonarium/chat-palette';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { DiceBot } from '@udonarium/dice-bot';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomState } from '@udonarium/room-state';
import { ChatInputComponent } from 'component/chat-input/chat-input.component';
import { ChatMessageService } from 'service/chat-message.service';
import { PanelService } from 'service/panel.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';

@Component({
  selector: 'chat-palette',
  templateUrl: './chat-palette.component.html',
  styleUrls: ['./chat-palette.component.css']
})
export class ChatPaletteComponent implements OnInit, OnDestroy {
  @ViewChild('chatInput', { static: true }) chatInputComponent: ChatInputComponent;
  @ViewChild('chatPlette') chatPletteElementRef: ElementRef<HTMLSelectElement>;
  @Input() character: GameCharacter = null;

  get palette(): ChatPalette { return this.character?.chatPalette ?? null; }

  private _gameType: string = '';
  get gameType(): string { return !this._gameType ? 'DiceBot' : this._gameType; };
  set gameType(gameType: string) {
    this._gameType = gameType;
    if (this.character?.chatPalette) this.character.chatPalette.dicebot = gameType;
  };

  get sendFrom(): string { return this.character?.identifier ?? ''; }
  set sendFrom(sendFrom: string) {
    this.onSelectedCharacter(sendFrom);
  }

  chatTabidentifier: string = '';
  text: string = '';
  sendTo: string = '';

  isEdit: boolean = false;
  editPalette: string = '';

  private doubleClickTimer: NodeJS.Timeout = null;
  private isDestroyed: boolean = false;
  private isViewUpdateQueued: boolean = false;

  get diceBotInfos() { return DiceBot.diceBotInfos }

  get chatTab(): ChatTab { return ObjectStore.instance.get<ChatTab>(this.chatTabidentifier); }
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }
  get otherPeers(): PeerCursor[] { return ObjectStore.instance.getObjects(PeerCursor); }
  get roomState(): RoomState { return RoomState.instance; }
  get isRoundActive(): boolean { return 0 < this.roomState.round; }
  get isActionDone(): boolean { return this.character ? this.roomState.isActionDone(this.character) : false; }

  constructor(
    public chatMessageService: ChatMessageService,
    private panelService: PanelService,
    private selectionService: TabletopSelectionService,
    private changeDetector: ChangeDetectorRef
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.updatePanelTitle());
    this.chatTabidentifier = this.chatMessageService.chatTabs?.[0]?.identifier ?? '';
    this.gameType = this.character?.chatPalette ? this.character.chatPalette.dicebot : '';
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.character && this.character.identifier === event.data.identifier) {
          this.panelService.close();
        }
        if (this.chatTabidentifier === event.data.identifier) {
          this.chatTabidentifier = this.chatMessageService.chatTabs?.[0]?.identifier ?? '';
        }
      })
      .on('UPDATE_GAME_OBJECT/identifier/RoomState', event => {
        this.closeIfForbidden();
        this.requestViewUpdate();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.shouldRefreshForSharedState(event.data.aliasName, event.data.identifier)) {
          this.closeIfForbidden();
          this.requestViewUpdate();
        }
      })
      .on('UPDATE_GAME_OBJECT/aliasName/character-action-state', event => {
        this.requestViewUpdate();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (event.data.aliasName === 'character-action-state') this.requestViewUpdate();
      });
    this.closeIfForbidden();
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    EventSystem.unregister(this);
    if (this.isEdit) this.toggleEditMode();
  }

  updatePanelTitle() {
    if (!this.character) return;
    this.panelService.title = this.character.name + ' のチャットパレット';
  }

  onSelectedCharacter(identifier: string) {
    if (this.isEdit) this.toggleEditMode();
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      if (!RoomState.instance.canAccessGMCharacter(object)) return;
      this.character = object;
      let gameType = this.character.chatPalette ? this.character.chatPalette.dicebot : '';
      if (0 < gameType.length) this.gameType = gameType;
    }
    this.updatePanelTitle();
  }

  private closeIfForbidden() {
    if (this.character && !RoomState.instance.canAccessGMCharacter(this.character)) {
      this.panelService.close();
    }
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
      || aliasName === 'character-action-state';
  }

  selectPalette(line: string) {
    this.text = line;
  }

  clickPalette(line: string) {
    if (this.doubleClickTimer && this.text === line) {
      clearTimeout(this.doubleClickTimer);
      this.doubleClickTimer = null;
      this.chatInputComponent.sendChat(null);
    } else {
      this.text = line;
      this.doubleClickTimer = setTimeout(() => { this.doubleClickTimer = null }, 400);
    }
  }

  sendChat(value: { text: string, gameType: string, sendFrom: string, sendTo: string }) {
    if (this.chatTab && this.palette) {
      for (let character of this.rollCharacters) {
        let text = this.palette.evaluate(value.text, character.rootDataElement);
        this.chatMessageService.sendMessage(this.chatTab, text, value.gameType, character.identifier, value.sendTo);
      }
    }
  }

  private get rollCharacters(): GameCharacter[] {
    if (!this.character) return [];
    let selectedCharacters = this.selectionService.objects
      .filter(object => object instanceof GameCharacter) as GameCharacter[];

    if (selectedCharacters.some(character => character.identifier === this.character.identifier)) {
      return selectedCharacters;
    }
    return [this.character];
  }

  resetPletteSelect() {
    if (!this.chatPletteElementRef.nativeElement) return;
    this.chatPletteElementRef.nativeElement.selectedIndex = -1;
  }

  toggleEditMode() {
    if (!this.palette) return;
    this.isEdit = this.isEdit ? false : true;
    if (this.isEdit) {
      this.editPalette = this.palette.value + '';
    } else {
      this.palette.setPalette(this.editPalette);
    }
  }

  toggleActionDone() {
    if (!this.character) return;
    this.roomState.toggleActionDone(this.character);
  }
}
