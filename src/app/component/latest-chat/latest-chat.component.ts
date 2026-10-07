import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ChatMessage } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { EventSystem } from '@udonarium/core/system';
import { ChatMessageService } from 'service/chat-message.service';

// Room commands and their comments stay in the chat log rather than the stage.
export function isLatestChatCandidate(message: ChatMessage): boolean {
  const text = (message.text ?? '').trim();
  return message.isDisplayable && !message.isSystem && !!text
    && !text.startsWith(':') && !/^\/(?:buff|round|exclude)(?:\s|$)/i.test(text);
}

export function latestChatMessage(messages: ChatMessage[]): ChatMessage | null {
  return messages.filter(isLatestChatCandidate).reduce((latest, message) => {
    if (!latest || message.index > latest.index
      || (message.index === latest.index && message.identifier > latest.identifier)) return message;
    return latest;
  }, null as ChatMessage | null);
}

export function latestChatResults(messages: ChatMessage[], original: ChatMessage): ChatMessage[] {
  if (!original) return [];
  return messages.filter(message => message.isDicebot && message.isDisplayable
    && message.parent === original.parent && message.replyToIdentifier === original.identifier)
    .sort((a, b) => a.index - b.index || a.identifier.localeCompare(b.identifier));
}

export function latestChatText(message: ChatMessage): string {
  return message.isSecret && !message.isSendFromSelf ? '（シークレットダイス）' : message.text;
}

@Component({
  selector: 'latest-chat',
  templateUrl: './latest-chat.component.html',
  styleUrls: ['./latest-chat.component.css']
})
export class LatestChatComponent implements OnInit, OnDestroy {
  message: ChatMessage = null;
  results: ChatMessage[] = [];
  private dismissedIdentifier: string = '';
  private updateTimer: ReturnType<typeof setTimeout> = null;

  get visible(): boolean {
    return this.chatMessageService.latestChatEnabled && !!this.message
      && this.message.identifier !== this.dismissedIdentifier;
  }

  get imageUrl(): string { return this.message?.image?.url ?? ''; }
  get tabName(): string { return (this.message?.parent as ChatTab)?.name ?? ''; }
  displayText = latestChatText;

  constructor(public chatMessageService: ChatMessageService, private ngZone: NgZone) { }

  ngOnInit() {
    EventSystem.register(this)
      .on('MESSAGE_ADDED', () => this.scheduleUpdate())
      .on(`UPDATE_GAME_OBJECT/aliasName/${ChatMessage.aliasName}`, () => this.scheduleUpdate())
      .on('DELETE_GAME_OBJECT', () => this.scheduleUpdate());
    this.scheduleUpdate();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.updateTimer !== null) clearTimeout(this.updateTimer);
  }

  dismiss() { this.dismissedIdentifier = this.message?.identifier ?? ''; }

  private scheduleUpdate() {
    if (this.updateTimer !== null) return;
    // Coalesce synchronization events and wait for messages to be attached to their tabs.
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const messages = ChatTabList.instance.chatTabs.flatMap(tab => tab.chatMessages);
      this.ngZone.run(() => {
        this.message = latestChatMessage(messages);
        this.results = latestChatResults(messages, this.message);
      });
    }, 0);
  }
}
