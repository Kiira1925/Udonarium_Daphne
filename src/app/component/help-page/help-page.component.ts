import { Component, OnInit } from '@angular/core';

import { PanelService } from 'service/panel.service';

type HelpTab = 'basic' | 'commands' | 'effects' | 'gm';

@Component({
  selector: 'help-page',
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.css']
})
export class HelpPageComponent implements OnInit {
  selectedTab: HelpTab = 'basic';

  constructor(
    private panelService: PanelService
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = 'ヘルプ');
  }
}
