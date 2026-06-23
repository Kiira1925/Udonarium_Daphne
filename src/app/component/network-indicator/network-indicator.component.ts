import { AfterViewInit, Component, ElementRef, OnDestroy } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';

@Component({
  selector: 'network-indicator',
  templateUrl: './network-indicator.component.html',
  styleUrls: ['./network-indicator.component.css']
})
export class NetworkIndicatorComponent implements AfterViewInit, OnDestroy {
  private timer: NodeJS.Timeout = null;
  private healthTimer: NodeJS.Timeout = null;
  private needRepeat = false;
  private isTransferActive = false;
  private unhealthySince: Map<string, number> = new Map();
  private healthySamples = 0;

  isSyncWarning = false;
  warningText = '';

  constructor(private elementRef: ElementRef) { }

  ngAfterViewInit() {
    let repeatFunc = () => {
      if (this.needRepeat) {
        this.timer = setTimeout(repeatFunc, 650);
        this.needRepeat = false;
      } else {
        this.timer = null;
        this.isTransferActive = false;
        this.updateDisplay();
      }
    };

    EventSystem.register(this)
      .on('*', event => {
        if (this.needRepeat || Network.bandwidthUsage < 3 * 1024) return;
        if (this.timer === null) {
          this.isTransferActive = true;
          this.updateDisplay();
          this.timer = setTimeout(repeatFunc, 650);
        } else {
          this.needRepeat = true;
        }
      });
    this.healthTimer = setInterval(() => this.updateNetworkHealth(), 1000);
    this.updateNetworkHealth();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.timer) clearTimeout(this.timer);
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  private updateNetworkHealth() {
    let now = Date.now();
    let unhealthyPeers = Network.peers.filter(peer =>
      !peer.isOpen
      || 1500 < peer.session.ping
      || (0 < peer.session.health && peer.session.health < 0.8)
    );
    let unhealthyIds = new Set(unhealthyPeers.map(peer => peer.peerId));

    for (let peer of Network.peers) {
      if (unhealthyIds.has(peer.peerId)) {
        if (!this.unhealthySince.has(peer.peerId)) this.unhealthySince.set(peer.peerId, now);
      } else {
        this.unhealthySince.delete(peer.peerId);
      }
    }

    let warningPeers = unhealthyPeers.filter(peer => now - (this.unhealthySince.get(peer.peerId) ?? now) >= 5000);
    if (warningPeers.length) {
      this.isSyncWarning = true;
      this.healthySamples = 0;
      this.warningText = `同期遅延の可能性: ${warningPeers.map(peer => peer.userId || peer.peerId).join(', ')}`;
    } else if (this.isSyncWarning && unhealthyPeers.length < 1) {
      this.healthySamples++;
      if (3 <= this.healthySamples) {
        this.isSyncWarning = false;
        this.warningText = '';
        this.healthySamples = 0;
      }
    }
    this.updateDisplay();
  }

  private updateDisplay() {
    this.elementRef.nativeElement.style.display = this.isTransferActive || this.isSyncWarning ? 'block' : 'none';
  }
}
