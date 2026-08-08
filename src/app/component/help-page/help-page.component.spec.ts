import { CommonModule } from '@angular/common';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';

import { PanelService } from 'service/panel.service';
import { HelpPageComponent } from './help-page.component';

describe('HelpPageComponent', () => {
  let component: HelpPageComponent;
  let fixture: ComponentFixture<HelpPageComponent>;
  let panelService: {
    title: string;
    scrollablePanel: {
      scrollTo: jasmine.Spy;
    };
  };

  beforeEach(async () => {
    panelService = {
      title: '',
      scrollablePanel: {
        scrollTo: jasmine.createSpy('scrollTo'),
      },
    };

    await TestBed.configureTestingModule({
      declarations: [HelpPageComponent],
      imports: [CommonModule],
      providers: [
        { provide: PanelService, useValue: panelService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the basic tab as the initial accessible tab', () => {
    let root = fixture.nativeElement as HTMLElement;
    let tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    expect(tabs.length).toBe(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it('moves focus and selection between tabs with the arrow keys', fakeAsync(() => {
    let root = fixture.nativeElement as HTMLElement;
    let firstTab = root.querySelector<HTMLButtonElement>('[role="tab"]');
    let event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });

    firstTab.dispatchEvent(event);
    fixture.detectChanges();
    tick();

    expect(component.selectedTab).toBe('commands');
    expect(event.defaultPrevented).toBeTrue();
    expect(panelService.scrollablePanel.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(document.activeElement).toBe(root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]);
    expect(root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')?.id)
      .toBe(component.tabPanelId('commands'));
  }));

  it('searches topics from every tab and opens the selected result', fakeAsync(() => {
    let root = fixture.nativeElement as HTMLElement;
    let input = root.querySelector<HTMLInputElement>('input[type="search"]');
    input.value = 'ＧＭ　画面共有';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    let result = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.search-results li button')
    ).find(button => button.textContent?.includes('GMモード'));
    expect(result.textContent).toContain('GMモード');

    result.click();
    fixture.detectChanges();
    tick();

    expect(component.selectedTab).toBe('gm');
    expect(component.searchQuery).toBe('');
    expect(root.querySelector('.search-results')).toBeNull();
    expect(root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')?.id)
      .toBe(component.tabPanelId('gm'));
  }));

  it('keeps the newest clipboard result when copy promises settle out of order', async () => {
    let resolveFirst!: () => void;
    let rejectSecond!: (reason?: unknown) => void;
    let firstWrite = new Promise<void>(resolve => resolveFirst = resolve);
    let secondWrite = new Promise<void>((_resolve, reject) => rejectSecond = reject);
    spyOn(navigator.clipboard, 'writeText').and.returnValues(firstWrite, secondWrite);

    let firstCopy = component.copyCommand('/round +1');
    let secondCopy = component.copyCommand('/round -1');
    rejectSecond(new Error('clipboard unavailable'));
    await secondCopy;

    expect(component.copiedCommand).toBe('');
    expect(component.copyStatus).toContain('コピーできませんでした');

    resolveFirst();
    await firstCopy;

    expect(component.copiedCommand).toBe('');
    expect(component.copyStatus).toContain('コピーできませんでした');
  });
});
