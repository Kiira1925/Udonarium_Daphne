import { Component, ElementRef, OnInit, QueryList, ViewChildren } from '@angular/core';

import { PanelService } from 'service/panel.service';

type HelpTab = 'basic' | 'commands' | 'effects' | 'gm';

interface HelpTabDefinition {
  id: HelpTab;
  label: string;
  icon: string;
}

interface HelpSearchResult {
  tab: HelpTab;
  tabLabel: string;
  topicId: string;
  title: string;
  summary: string;
}

@Component({
  selector: 'help-page',
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.css']
})
export class HelpPageComponent implements OnInit {
  private static nextInstanceId = 0;
  private copyFeedbackId = 0;

  @ViewChildren('helpTabButton') private helpTabButtons: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('helpTopic') private helpTopics: QueryList<ElementRef<HTMLElement>>;

  readonly instanceId = ++HelpPageComponent.nextInstanceId;
  readonly tabs: readonly HelpTabDefinition[] = [
    { id: 'basic', label: '基本操作', icon: 'touch_app' },
    { id: 'commands', label: 'チャットコマンド', icon: 'terminal' },
    { id: 'effects', label: 'バフ・ラウンド', icon: 'timelapse' },
    { id: 'gm', label: 'GM・秘匿', icon: 'visibility' },
  ];

  selectedTab: HelpTab = 'basic';
  searchQuery = '';
  searchResults: HelpSearchResult[] = [];
  copiedCommand = '';
  copyStatus = '';

  constructor(
    private panelService: PanelService
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = 'ヘルプ');
  }

  selectTab(tab: HelpTab, moveFocus: boolean = false) {
    this.selectedTab = tab;
    this.panelService.scrollablePanel?.scrollTo({ top: 0 });

    if (moveFocus) {
      let index = this.tabs.findIndex(item => item.id === tab);
      setTimeout(() => this.helpTabButtons.get(index)?.nativeElement.focus());
    }
  }

  onTabKeydown(event: KeyboardEvent, index: number) {
    let nextIndex = index;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = this.tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.selectTab(this.tabs[nextIndex].id, true);
  }

  onSearchInput(event: Event) {
    this.searchQuery = (event.target as HTMLInputElement).value;
    this.updateSearchResults();
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
  }

  openTopic(tab: HelpTab, topicId: string) {
    this.selectedTab = tab;
    this.clearSearch();

    setTimeout(() => {
      let topic = this.helpTopics
        .map(item => item.nativeElement)
        .find(item =>
          item.dataset['helpTab'] === tab
          && item.dataset['helpTopic'] === topicId
        );
      if (!topic) return;

      topic.scrollIntoView({ block: 'start' });
      topic.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
  }

  async copyCommand(command: string) {
    let feedbackId = ++this.copyFeedbackId;
    try {
      await navigator.clipboard.writeText(command);
      if (this.copyFeedbackId !== feedbackId) return;
      this.copiedCommand = command;
      this.copyStatus = 'コマンドをコピーしました。';
      setTimeout(() => {
        if (this.copyFeedbackId !== feedbackId) return;
        this.copiedCommand = '';
        this.copyStatus = '';
      }, 1800);
    } catch (_error) {
      if (this.copyFeedbackId !== feedbackId) return;
      this.copiedCommand = '';
      this.copyStatus = 'コピーできませんでした。コードを選択してコピーしてください。';
      setTimeout(() => {
        if (this.copyFeedbackId !== feedbackId) return;
        this.copyStatus = '';
      }, 4000);
    }
  }

  tabButtonId(tab: HelpTab): string {
    return `help-${this.instanceId}-tab-${tab}`;
  }

  tabPanelId(tab: HelpTab): string {
    return `help-${this.instanceId}-panel-${tab}`;
  }

  trackByTab(_index: number, tab: HelpTabDefinition): HelpTab {
    return tab.id;
  }

  trackBySearchResult(_index: number, result: HelpSearchResult): string {
    return `${result.tab}-${result.topicId}`;
  }

  private updateSearchResults() {
    let terms = this.normalizeText(this.searchQuery)
      .split(/\s+/)
      .filter(term => 0 < term.length);
    if (terms.length < 1) {
      this.searchResults = [];
      return;
    }

    this.searchResults = this.helpTopics
      .map(item => item.nativeElement)
      .filter(topic => {
        let searchableText = this.normalizeText([
          topic.dataset['title'] ?? '',
          topic.dataset['keywords'] ?? '',
          topic.textContent ?? '',
        ].join(' '));
        return terms.every(term => searchableText.includes(term));
      })
      .map(topic => {
        let tab = topic.dataset['helpTab'] as HelpTab;
        return {
          tab: tab,
          tabLabel: this.tabs.find(item => item.id === tab)?.label ?? '',
          topicId: topic.dataset['helpTopic'] ?? '',
          title: topic.dataset['title'] ?? '',
          summary: topic.dataset['summary'] ?? '',
        };
      });
  }

  private normalizeText(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase('ja');
  }
}
