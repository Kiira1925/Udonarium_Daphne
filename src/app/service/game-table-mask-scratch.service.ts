import { Injectable } from '@angular/core';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { EventSystem, Network } from '@udonarium/core/system';
import { UUID } from '@udonarium/core/system/util/uuid';
import { GameTableMaskScratchLock } from '@udonarium/game-table-mask-scratch-lock';
import {
  GameTableMask,
  GameTableMaskScratchArea,
  GameTableMaskScratchMode
} from '@udonarium/game-table-mask';
import { RoomState } from '@udonarium/room-state';

type ScratchRequestKind = 'lock' | 'commit' | 'release';
type ScratchRequestOutcome = boolean | null;

interface ScratchLockRequest {
  maskIdentifier: string;
  token: string;
  generation: number;
}

interface ScratchCommitRequest extends ScratchLockRequest {
  area: GameTableMaskScratchArea;
  mode?: GameTableMaskScratchMode;
}

interface ScratchRequestResult extends ScratchLockRequest {
  kind: ScratchRequestKind;
  granted: boolean;
}

interface PendingScratchRequest {
  coordinatorPeerId: string;
  resolve: (outcome: ScratchRequestOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingScratchRelease extends ScratchLockRequest {
  ownerPeerId: string;
  coordinatorPeerId: string;
  wasObservedOwned: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
}

const lockRequestEvent = 'REQUEST_GAME_TABLE_MASK_SCRATCH_LOCK';
const commitRequestEvent = 'REQUEST_GAME_TABLE_MASK_SCRATCH_COMMIT';
const releaseRequestEvent = 'REQUEST_GAME_TABLE_MASK_SCRATCH_RELEASE';
const requestResultEvent = 'RESULT_GAME_TABLE_MASK_SCRATCH_REQUEST';

@Injectable({
  providedIn: 'root'
})
export class GameTableMaskScratchService {
  private pendingRequests: Map<string, PendingScratchRequest> = new Map();
  private pendingReleases: Map<string, PendingScratchRelease> = new Map();
  private completedCommitTokens: Set<string> = new Set();
  private terminalLockTokens: Set<string> = new Set();
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private localEditReservation: ScratchLockRequest | null = null;
  private isInitialized: boolean = false;
  private lastLocalPeerId: string = '';
  private coordinatorReadyAfter: number = 0;

  initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.lastLocalPeerId = Network.peerId;

    EventSystem.register(this)
      .on<ScratchLockRequest>(lockRequestEvent, event => this.handleLockRequest(event.data, event.sendFrom))
      .on<ScratchCommitRequest>(commitRequestEvent, event => this.handleCommitRequest(event.data, event.sendFrom))
      .on<ScratchLockRequest>(releaseRequestEvent, event => this.handleReleaseRequest(event.data, event.sendFrom))
      .on<ScratchRequestResult>(requestResultEvent, event => this.handleRequestResult(event.data, event.sendFrom))
      .on(`UPDATE_GAME_OBJECT/aliasName/${GameTableMaskScratchLock.aliasName}`, event => {
        this.handleLockUpdated(event.data.identifier);
      })
      .on('OPEN_NETWORK', event => this.handleNetworkOpen(event.data.peerId))
      .on('CLOSE_NETWORK', event => this.handleNetworkClose(event.data.peerId))
      .on('DISCONNECT_PEER', event => this.handlePeerDisconnect(event.data.peerId))
      .on('CONNECT_PEER', event => {
        this.cancelDisconnectCleanup(event.data.peerId);
        this.deferCoordinatorReadiness(1500);
        this.flushPendingReleases();
      })
      .on('SYNCHRONIZE_GAME_OBJECT', event => {
        if (!event.isSendFromSelf) this.deferCoordinatorReadiness(1000);
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (!event.isSendFromSelf && performance.now() < this.coordinatorReadyAfter) {
          this.deferCoordinatorReadiness(500);
        }
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (event.data.aliasName === GameTableMask.aliasName || event.data.aliasName.length < 1) {
          this.clearOrphanedLocks();
        }
      })
      .on('XML_LOADED', -100, event => {
        if (event.data.xmlElement?.tagName !== 'room') return;
        this.resetScratchStateForRoomLoad();
        this.deferCoordinatorReadiness(1000);
      });
  }

  destroy() {
    if (!this.isInitialized) return;
    this.isInitialized = false;
    EventSystem.unregister(this);
    for (let request of this.pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.resolve(null);
    }
    this.pendingRequests.clear();
    for (let release of this.pendingReleases.values()) {
      if (release.timeout) clearTimeout(release.timeout);
    }
    this.pendingReleases.clear();
    this.completedCommitTokens.clear();
    this.terminalLockTokens.clear();
    for (let timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.localEditReservation = null;
    this.lastLocalPeerId = '';
    this.coordinatorReadyAfter = 0;
  }

  lockFor(maskIdentifier: string): GameTableMaskScratchLock | null {
    let lock = ObjectStore.instance.get<GameTableMaskScratchLock>(
      GameTableMaskScratchLock.identifierFor(maskIdentifier)
    );
    return lock && this.isCurrentLock(lock) ? lock : null;
  }

  isOwnedByMe(maskIdentifier: string, token?: string, generation?: number): boolean {
    let lock = this.lockFor(maskIdentifier);
    if (!lock || lock.ownerPeerId !== Network.peerId) return false;
    return (token == null || lock.token === token)
      && (generation == null || lock.generation === generation);
  }

  async acquire(maskIdentifier: string): Promise<string | null> {
    if (!maskIdentifier) return null;
    if (this.localEditReservation) return null;

    let mask = ObjectStore.instance.get<GameTableMask>(maskIdentifier);
    if (!(mask instanceof GameTableMask)
      || !GameTableMask.isValidScratchLockGeneration(mask.scratchLockGeneration)) {
      return null;
    }

    let anotherOwnLock = ObjectStore.instance.getObjects(GameTableMaskScratchLock)
      .find(lock => this.isCurrentLock(lock)
        && lock.ownerPeerId === Network.peerId
        && lock.maskIdentifier !== maskIdentifier);
    if (anotherOwnLock) return null;

    let lock = this.lockFor(maskIdentifier);
    if (lock && lock.ownerPeerId !== Network.peerId && this.isPeerOnline(lock.ownerPeerId)) return null;
    if (lock?.ownerPeerId === Network.peerId) {
      this.localEditReservation = {
        maskIdentifier: maskIdentifier,
        token: lock.token,
        generation: lock.generation,
      };
      return lock.token;
    }

    let token = UUID.generateUuid();
    let generation = mask.scratchLockGeneration;
    this.localEditReservation = {
      maskIdentifier: maskIdentifier,
      token: token,
      generation: generation,
    };
    let outcome = await this.sendRequest('lock', lockRequestEvent, {
      maskIdentifier: maskIdentifier,
      token: token,
      generation: generation,
    });
    if (outcome === true) {
      await this.waitFor(() => this.isOwnedByMe(maskIdentifier, token), 500);
    }
    let ownedLock = this.lockFor(maskIdentifier);
    if (ownedLock?.isOwnedBy(Network.peerId, token)) {
      if (this.localEditReservation?.maskIdentifier === maskIdentifier
        && this.localEditReservation.token === token) {
        this.localEditReservation.generation = ownedLock.generation;
      }
      return token;
    }

    if (outcome !== false) {
      this.release(maskIdentifier, token);
    } else {
      this.clearLocalEditReservation(maskIdentifier, token);
    }
    return null;
  }

  async commit(
    maskIdentifier: string,
    token: string,
    area: GameTableMaskScratchArea,
    mode: GameTableMaskScratchMode = 'reveal'
  ): Promise<ScratchRequestOutcome> {
    if (!maskIdentifier || !token) return false;
    let reservation = this.localEditReservation;
    let lock = this.lockFor(maskIdentifier);
    let generation = reservation?.maskIdentifier === maskIdentifier && reservation.token === token
      ? reservation.generation
      : lock?.isOwnedBy(Network.peerId, token) ? lock.generation : -1;
    if (!GameTableMask.isValidScratchLockGeneration(generation)) return false;

    let outcome = await this.sendRequest('commit', commitRequestEvent, {
      maskIdentifier: maskIdentifier,
      token: token,
      generation: generation,
      area: area,
      mode: mode,
    });
    if (this.wasCommitted(maskIdentifier, token)) {
      this.clearLocalEditReservation(maskIdentifier, token);
      return true;
    }
    if (outcome !== null) {
      this.clearLocalEditReservation(maskIdentifier, token);
      return outcome;
    }

    let committed = await this.waitFor(() => this.wasCommitted(maskIdentifier, token), 750);
    if (committed) this.clearLocalEditReservation(maskIdentifier, token);
    return committed ? true : null;
  }

  release(maskIdentifier: string, token: string) {
    if (!maskIdentifier || !token) return;
    let key = this.pendingReleaseKey(maskIdentifier, token);
    let existing = this.pendingReleases.get(key);
    let reservation = this.localEditReservation;
    let lock = this.lockFor(maskIdentifier);
    let generation = existing?.generation
      ?? (reservation?.maskIdentifier === maskIdentifier && reservation.token === token
        ? reservation.generation
        : lock?.isOwnedBy(Network.peerId, token) ? lock.generation : -1);
    if (!GameTableMask.isValidScratchLockGeneration(generation)) return;

    this.clearLocalEditReservation(maskIdentifier, token);
    if (existing?.timeout) clearTimeout(existing.timeout);

    let request: PendingScratchRelease = {
      maskIdentifier: maskIdentifier,
      token: token,
      generation: generation,
      ownerPeerId: Network.peerId,
      coordinatorPeerId: '',
      wasObservedOwned: lock?.isOwnedBy(Network.peerId, token, generation) ?? false,
      timeout: null,
    };
    this.pendingReleases.set(key, request);
    this.trimPendingReleases();
    this.flushPendingRelease(request);
  }

  private sendRequest(
    kind: ScratchRequestKind,
    eventName: string,
    data: ScratchLockRequest | ScratchCommitRequest
  ): Promise<ScratchRequestOutcome> {
    let key = this.pendingKey(kind, data.maskIdentifier, data.token);
    let existing = this.pendingRequests.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.resolve(false);
      this.pendingRequests.delete(key);
    }

    let coordinatorPeerId = this.coordinatorPeerId;
    if (!coordinatorPeerId) return Promise.resolve(null);

    return new Promise<ScratchRequestOutcome>(resolve => {
      let timeout = setTimeout(() => {
        let pending = this.pendingRequests.get(key);
        if (!pending) return;
        this.pendingRequests.delete(key);
        pending.resolve(null);
      }, 3000);
      this.pendingRequests.set(key, {
        coordinatorPeerId: coordinatorPeerId,
        resolve: resolve,
        timeout: timeout,
      });
      EventSystem.call(eventName, data, coordinatorPeerId);
    });
  }

  private handleLockRequest(request: ScratchLockRequest, sendFrom: string) {
    if (!this.isCoordinator || !this.isValidRequest(request, sendFrom)) return;
    if (!this.isCoordinatorReady) {
      this.sendResult('lock', request, false, sendFrom);
      return;
    }

    let mask = ObjectStore.instance.get<GameTableMask>(request.maskIdentifier);
    let knownLock = ObjectStore.instance.get<GameTableMaskScratchLock>(
      GameTableMaskScratchLock.identifierFor(request.maskIdentifier)
    );
    if (mask instanceof GameTableMask
      && knownLock
      && mask.scratchLockGeneration < knownLock.generation) {
      let lockGenerationFloor = knownLock.isActive
        ? knownLock.generation
        : Math.min(Number.MAX_SAFE_INTEGER, knownLock.generation + 1);
      mask.ensureScratchLockGenerationAtLeast(lockGenerationFloor);
    }
    if (mask instanceof GameTableMask
      && knownLock?.isOwnedBy(sendFrom, request.token)
      && this.isCurrentLock(knownLock)) {
      this.sendResult('lock', request, true, sendFrom);
      return;
    }
    if (!(mask instanceof GameTableMask) || mask.scratchLockGeneration !== request.generation) {
      this.sendResult('lock', request, false, sendFrom);
      return;
    }

    let requestKey = this.completedCommitKey(request.maskIdentifier, request.token);
    if (this.terminalLockTokens.has(requestKey) || knownLock?.isRetired(request.token)) {
      this.sendResult('lock', request, false, sendFrom);
      return;
    }

    let lock = knownLock ?? this.getOrCreateLock(request.maskIdentifier);
    if (lock.isActive) {
      if (lock.generation !== mask.scratchLockGeneration) {
        lock.clear();
      } else if (lock.isOwnedBy(sendFrom, request.token, request.generation)) {
        this.sendResult('lock', request, true, sendFrom);
        return;
      } else if (this.isPeerOnline(lock.ownerPeerId)) {
        this.sendResult('lock', request, false, sendFrom);
        return;
      } else {
        lock.clear();
      }
    }

    let grantedGeneration = request.generation + 1;
    let granted = GameTableMask.isValidScratchLockGeneration(grantedGeneration)
      && lock.setOwner(sendFrom, request.token, grantedGeneration);
    if (granted && !mask.advanceScratchLockGeneration(request.generation)) {
      lock.clear(sendFrom, request.token, grantedGeneration);
      granted = false;
    }
    this.sendResult('lock', request, granted, sendFrom);
  }

  private handleCommitRequest(request: ScratchCommitRequest, sendFrom: string) {
    if (!this.isCoordinator || !this.isValidRequest(request, sendFrom)) return;
    let mode: GameTableMaskScratchMode = request.mode ?? 'reveal';
    if (mode !== 'reveal' && mode !== 'restore') {
      this.sendResult('commit', request, false, sendFrom);
      return;
    }
    if (!this.isCoordinatorReady) {
      this.sendResult('commit', request, false, sendFrom);
      return;
    }

    let mask = ObjectStore.instance.get<GameTableMask>(request.maskIdentifier);
    let commitKey = this.completedCommitKey(request.maskIdentifier, request.token);
    if (mask instanceof GameTableMask
      && (mask.scratchCommitToken === request.token || this.completedCommitTokens.has(commitKey))) {
      this.lockFor(request.maskIdentifier)?.clear(sendFrom, request.token, request.generation);
      this.sendResult('commit', request, true, sendFrom);
      return;
    }

    let lock = this.lockFor(request.maskIdentifier);
    if (!(mask instanceof GameTableMask)
      || mask.scratchLockGeneration !== request.generation
      || !lock?.isOwnedBy(sendFrom, request.token, request.generation)) {
      this.sendResult('commit', request, false, sendFrom);
      return;
    }

    let committed = mask.commitScratchArea(request.area, request.token, request.generation, mode);
    if (committed) {
      this.rememberCompletedCommit(commitKey);
      this.rememberTerminalLockToken(commitKey);
      lock.clear(sendFrom, request.token, request.generation);
    }
    this.sendResult('commit', request, committed, sendFrom);
  }

  private handleReleaseRequest(request: ScratchLockRequest, sendFrom: string) {
    if (!this.isCoordinator || !this.isValidRequest(request, sendFrom)) return;
    if (!this.isCoordinatorReady) return;
    this.rememberTerminalLockToken(this.completedCommitKey(request.maskIdentifier, request.token));
    let lock = this.getOrCreateLock(request.maskIdentifier);
    let mask = ObjectStore.instance.get<GameTableMask>(request.maskIdentifier);
    let ownsRequestedLock = lock.isOwnedBy(sendFrom, request.token);
    let releaseGeneration = ownsRequestedLock ? lock.generation : request.generation;

    if (mask instanceof GameTableMask
      && mask.scratchLockGeneration === releaseGeneration
      && (ownsRequestedLock || !lock.isActive)) {
      mask.advanceScratchLockGeneration(releaseGeneration);
    }
    if (ownsRequestedLock) {
      lock.clear(sendFrom, request.token, lock.generation);
    } else {
      lock.retire(request.token);
    }
    if (!lock.isActive && mask instanceof GameTableMask) {
      lock.ensureGenerationFloor(mask.scratchLockGeneration);
    }
    this.sendResult('release', request, true, sendFrom);
  }

  private handleRequestResult(result: ScratchRequestResult, sendFrom: string) {
    if (result.kind === 'release') {
      let releaseKey = this.pendingReleaseKey(result.maskIdentifier, result.token);
      let release = this.pendingReleases.get(releaseKey);
      if (!release || release.coordinatorPeerId !== sendFrom) return;
      if (release.timeout) clearTimeout(release.timeout);
      this.pendingReleases.delete(releaseKey);
      return;
    }

    let key = this.pendingKey(result.kind, result.maskIdentifier, result.token);
    let pending = this.pendingRequests.get(key);
    if (!pending || pending.coordinatorPeerId !== sendFrom) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(key);
    pending.resolve(result.granted);
  }

  private resetScratchStateForRoomLoad() {
    this.localEditReservation = null;
    this.completedCommitTokens.clear();
    this.terminalLockTokens.clear();
    let roomLoadGenerationSeed = Math.floor(Date.now() * 1000 + Math.random() * 1000);
    for (let mask of ObjectStore.instance.getObjects(GameTableMask)) {
      let generationFloor = Math.max(
        roomLoadGenerationSeed,
        Math.min(Number.MAX_SAFE_INTEGER, mask.scratchLockGeneration + 1)
      );
      mask.ensureScratchLockGenerationAtLeast(generationFloor);
    }
    for (let lock of ObjectStore.instance.getObjects(GameTableMaskScratchLock)) {
      if (lock.isActive) {
        this.rememberTerminalLockToken(this.completedCommitKey(lock.maskIdentifier, lock.token));
        this.terminateLock(lock);
      }
      let mask = ObjectStore.instance.get<GameTableMask>(lock.maskIdentifier);
      if (mask instanceof GameTableMask) {
        lock.ensureGenerationFloor(mask.scratchLockGeneration);
      }
    }
  }

  private handleNetworkOpen(peerId: string) {
    if (this.lastLocalPeerId && this.lastLocalPeerId !== peerId) {
      this.clearLocksOwnedBy(this.lastLocalPeerId);
    }
    this.lastLocalPeerId = peerId;
    if (Network.peer?.isRoom || 0 < Network.peerIds.length) {
      this.deferCoordinatorReadiness(1500);
    }
    this.localEditReservation = null;
    this.rejectPendingRequests();
    this.flushPendingReleases();
  }

  private handleNetworkClose(peerId: string) {
    this.clearLocksOwnedBy(peerId);
    this.lastLocalPeerId = peerId;
    this.localEditReservation = null;
    this.rejectPendingRequests();
  }

  private handlePeerDisconnect(peerId: string) {
    this.cancelDisconnectCleanup(peerId);
    this.disconnectTimers.set(peerId, setTimeout(() => {
      this.disconnectTimers.delete(peerId);
      if (!this.isCoordinator || this.isPeerOnline(peerId)) return;
      for (let lock of ObjectStore.instance.getObjects(GameTableMaskScratchLock)) {
        if (lock.ownerPeerId === peerId) this.terminateLock(lock);
      }
    }, 1000));
  }

  private cancelDisconnectCleanup(peerId: string) {
    let timer = this.disconnectTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.disconnectTimers.delete(peerId);
  }

  private clearOrphanedLocks() {
    if (!this.isCoordinator) return;
    for (let lock of ObjectStore.instance.getObjects(GameTableMaskScratchLock)) {
      if (lock.isActive && !ObjectStore.instance.get<GameTableMask>(lock.maskIdentifier)) {
        this.terminateLock(lock);
      }
    }
  }

  private clearLocksOwnedBy(peerId: string) {
    if (!peerId) return;
    for (let lock of ObjectStore.instance.getObjects(GameTableMaskScratchLock)) {
      if (lock.ownerPeerId === peerId) this.terminateLock(lock);
    }
  }

  private terminateLock(lock: GameTableMaskScratchLock) {
    if (!lock.isActive) return;
    let mask = ObjectStore.instance.get<GameTableMask>(lock.maskIdentifier);
    if (mask instanceof GameTableMask
      && mask.scratchLockGeneration === lock.generation) {
      mask.advanceScratchLockGeneration(lock.generation);
    }
    lock.clear();
  }

  private isCurrentLock(lock: GameTableMaskScratchLock): boolean {
    if (!lock.isActive) return false;
    let mask = ObjectStore.instance.get<GameTableMask>(lock.maskIdentifier);
    return mask instanceof GameTableMask
      && mask.scratchLockGeneration <= lock.generation;
  }

  private rejectPendingRequests() {
    for (let request of this.pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.resolve(null);
    }
    this.pendingRequests.clear();
  }

  private handleLockUpdated(identifier: string) {
    for (let [key, release] of this.pendingReleases) {
      if (identifier !== GameTableMaskScratchLock.identifierFor(release.maskIdentifier)) continue;
      let lock = ObjectStore.instance.get<GameTableMaskScratchLock>(identifier);
      if (lock?.isOwnedBy(release.ownerPeerId, release.token, release.generation)) {
        release.wasObservedOwned = true;
        this.flushPendingRelease(release);
      } else if (release.wasObservedOwned) {
        if (release.timeout) clearTimeout(release.timeout);
        this.pendingReleases.delete(key);
      }
    }
  }

  private flushPendingReleases() {
    for (let release of this.pendingReleases.values()) this.flushPendingRelease(release);
  }

  private flushPendingRelease(release: PendingScratchRelease) {
    if (release.timeout) clearTimeout(release.timeout);
    let coordinatorPeerId = this.coordinatorPeerId;
    release.coordinatorPeerId = coordinatorPeerId;
    release.timeout = setTimeout(() => {
      let key = this.pendingReleaseKey(release.maskIdentifier, release.token);
      if (this.pendingReleases.get(key) === release) this.flushPendingRelease(release);
    }, 3000);
    if (coordinatorPeerId) {
      EventSystem.call(releaseRequestEvent, {
        maskIdentifier: release.maskIdentifier,
        token: release.token,
        generation: release.generation,
      }, coordinatorPeerId);
    }
  }

  private wasCommitted(maskIdentifier: string, token: string): boolean {
    let mask = ObjectStore.instance.get<GameTableMask>(maskIdentifier);
    return mask instanceof GameTableMask && mask.scratchCommitToken === token;
  }

  private waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) return Promise.resolve(true);
    return new Promise(resolve => {
      let startedAt = performance.now();
      let timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve(true);
        } else if (timeoutMs <= performance.now() - startedAt) {
          clearInterval(timer);
          resolve(false);
        }
      }, 25);
    });
  }

  private rememberCompletedCommit(key: string) {
    this.completedCommitTokens.add(key);
    if (this.completedCommitTokens.size <= 256) return;
    let oldest = this.completedCommitTokens.values().next().value;
    if (oldest) this.completedCommitTokens.delete(oldest);
  }

  private rememberTerminalLockToken(key: string) {
    this.terminalLockTokens.add(key);
    if (this.terminalLockTokens.size <= 256) return;
    let oldest = this.terminalLockTokens.values().next().value;
    if (oldest) this.terminalLockTokens.delete(oldest);
  }

  private trimPendingReleases() {
    while (256 < this.pendingReleases.size) {
      let oldestKey = this.pendingReleases.keys().next().value;
      if (!oldestKey) return;
      let oldest = this.pendingReleases.get(oldestKey);
      if (oldest?.timeout) clearTimeout(oldest.timeout);
      this.pendingReleases.delete(oldestKey);
    }
  }

  private getOrCreateLock(maskIdentifier: string): GameTableMaskScratchLock {
    let identifier = GameTableMaskScratchLock.identifierFor(maskIdentifier);
    let lock = ObjectStore.instance.get<GameTableMaskScratchLock>(identifier);
    if (lock) return lock;

    GameTableMaskScratchLock.create(maskIdentifier);
    return ObjectStore.instance.get<GameTableMaskScratchLock>(identifier);
  }

  private isValidRequest(request: ScratchLockRequest, sendFrom: string): boolean {
    return typeof request?.maskIdentifier === 'string'
      && 0 < request.maskIdentifier.length
      && typeof request?.token === 'string'
      && 0 < request.token.length
      && GameTableMask.isValidScratchLockGeneration(request?.generation)
      && this.isPeerOnline(sendFrom);
  }

  isPeerOnline(peerId: string): boolean {
    return peerId === Network.peerId
      || Network.peers.some(peer => peer.peerId === peerId && peer.isOpen);
  }

  private sendResult(kind: ScratchRequestKind, request: ScratchLockRequest, granted: boolean, sendTo: string) {
    EventSystem.call<ScratchRequestResult, string>(requestResultEvent, {
      kind: kind,
      maskIdentifier: request.maskIdentifier,
      token: request.token,
      generation: request.generation,
      granted: granted,
    }, sendTo);
  }

  private pendingKey(kind: ScratchRequestKind, maskIdentifier: string, token: string): string {
    return `${kind}/${maskIdentifier}/${token}`;
  }

  private pendingReleaseKey(maskIdentifier: string, token: string): string {
    return `${maskIdentifier}/${token}`;
  }

  private completedCommitKey(maskIdentifier: string, token: string): string {
    return `${maskIdentifier}/${token}`;
  }

  private clearLocalEditReservation(maskIdentifier: string, token: string) {
    if (this.localEditReservation?.maskIdentifier === maskIdentifier
      && this.localEditReservation.token === token) {
      this.localEditReservation = null;
    }
  }

  private deferCoordinatorReadiness(milliseconds: number) {
    this.coordinatorReadyAfter = Math.max(
      this.coordinatorReadyAfter,
      performance.now() + milliseconds
    );
  }

  private get isCoordinatorReady(): boolean {
    return this.coordinatorReadyAfter <= performance.now()
      && !ObjectSynchronizer.instance.hasActiveSynchronizationTasks;
  }

  private get coordinatorPeerId(): string {
    let localPeer = Network.peer;
    if (!localPeer?.isRoom) {
      let peerIds = [Network.peerId]
        .concat(Network.peers.filter(peer => peer.isOpen).map(peer => peer.peerId))
        .filter(peerId => typeof peerId === 'string' && 0 < peerId.length)
        .sort();
      return peerIds[0] ?? '';
    }

    // 参加者ごとの接続一覧から選出すると分断時に二重化するため、
    // ルーム内では作成者のpeerだけを仲裁候補とする。不在時は新規操作を許可しない。
    let roomMasterUserId = RoomState.instance.roomMasterUserId;
    if (!roomMasterUserId) return '';
    return [localPeer]
      .concat(Network.peers)
      .filter(peer => peer.isOpen && peer.userId === roomMasterUserId)
      .map(peer => peer.peerId)
      .sort()[0] ?? '';
  }

  private get isCoordinator(): boolean {
    return this.coordinatorPeerId === Network.peerId;
  }
}
