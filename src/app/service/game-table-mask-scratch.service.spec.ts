import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameTableMaskScratchLock } from '@udonarium/game-table-mask-scratch-lock';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RoomState } from '@udonarium/room-state';

import { GameTableMaskScratchService } from './game-table-mask-scratch.service';

describe('GameTableMaskScratchService arbitration', () => {
  let service: GameTableMaskScratchService;
  let originalConnection: any;

  beforeEach(() => {
    service = new GameTableMaskScratchService();
    originalConnection = (Network as any).connection;
    (Network as any).connection = fakeConnection('peer-a', 'user-a', false, [
      fakePeer('peer-b', 'user-b'),
      fakePeer('peer-c', 'user-c'),
    ]);
    spyOn(EventSystem, 'call');
  });

  afterEach(() => {
    RoomState.instance.roomMasterUserId = '';
    (Network as any).connection = originalConnection;
  });

  it('grants only the first peer while a mask is being edited', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let firstRequest = lockRequest(mask, 'token-b');
    let secondRequest = lockRequest(mask, 'token-c');

    (service as any).handleLockRequest(firstRequest, 'peer-b');
    (service as any).handleLockRequest(secondRequest, 'peer-c');

    let lock = service.lockFor(mask.identifier);
    expect(lock?.ownerPeerId).toBe('peer-b');
    expect(lock?.token).toBe('token-b');
  });

  it('accepts a commit only from the peer that owns the matching token', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let request = lockRequest(mask, 'token-b');
    (service as any).handleLockRequest(request, 'peer-b');
    request = {
      ...request,
      generation: service.lockFor(mask.identifier)!.generation,
    };

    (service as any).handleCommitRequest({
      ...request,
      token: 'token-c',
      area: { x: 0, y: 0, width: 1, height: 1 },
    }, 'peer-c');
    expect(mask.scratchData).toBe('');

    (service as any).handleCommitRequest({
      ...request,
      area: { x: 1, y: 1, width: 2, height: 2 },
    }, 'peer-b');
    expect(mask.scratchData).toBe('1,1,2,2');
    expect(mask.scratchCommitToken).toBe('token-b');
    expect(service.lockFor(mask.identifier)).toBeNull();
  });

  it('does not let a delayed release clear a newer lock token', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let oldRequest = lockRequest(mask, 'old-token');
    (service as any).handleLockRequest(oldRequest, 'peer-b');
    (service as any).handleReleaseRequest(oldRequest, 'peer-b');
    (service as any).handleLockRequest(lockRequest(mask, 'new-token'), 'peer-b');

    (service as any).handleReleaseRequest(oldRequest, 'peer-b');

    expect(service.lockFor(mask.identifier)?.token).toBe('new-token');
  });

  it('does not revive a token when its release arrived before a delayed lock request', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let request = lockRequest(mask, 'released-token');

    (service as any).handleReleaseRequest(request, 'peer-b');
    (service as any).handleLockRequest(request, 'peer-b');

    expect(service.lockFor(mask.identifier)).toBeNull();
  });

  it('keeps a retired token rejected after the coordinator service is recreated', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let request = lockRequest(mask, 'retired-token');
    (service as any).handleReleaseRequest(request, 'peer-b');

    service = new GameTableMaskScratchService();
    (service as any).handleLockRequest(request, 'peer-b');

    expect(service.lockFor(mask.identifier)).toBeNull();
  });

  it('does not roll back a synchronized lock generation floor', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let lock = GameTableMaskScratchLock.create(mask.identifier);
    let staleContext = lock.toContext();
    lock.setOwner('peer-b', 'old-token', 5);
    lock.clear('peer-b', 'old-token', 5);

    lock.apply(staleContext);

    expect(lock.generation).toBe(6);
    expect(lock.isActive).toBe(false);
    expect(lock.isRetired('old-token')).toBe(true);
  });

  it('does not let a losing release invalidate the active lock generation', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let activeRequest = lockRequest(mask, 'active-token');
    (service as any).handleLockRequest(activeRequest, 'peer-b');

    (service as any).handleReleaseRequest({
      ...activeRequest,
      token: 'losing-token',
    }, 'peer-c');

    expect(mask.scratchLockGeneration).toBe(service.lockFor(mask.identifier)!.generation);
    expect(service.lockFor(mask.identifier)?.token).toBe('active-token');
  });

  it('advances the generation when an offline owner is replaced', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let oldRequest = lockRequest(mask, 'old-token');
    (service as any).handleLockRequest(oldRequest, 'peer-b');

    (Network as any).connection = fakeConnection('peer-a', 'user-a', false, [
      fakePeer('peer-c', 'user-c'),
    ]);
    (service as any).handleLockRequest(lockRequest(mask, 'new-token'), 'peer-c');

    expect(mask.scratchLockGeneration).toBe(2);
    expect(service.lockFor(mask.identifier)?.token).toBe('new-token');

    (Network as any).connection = fakeConnection('peer-a', 'user-a', false, [
      fakePeer('peer-b', 'user-b'),
      fakePeer('peer-c', 'user-c'),
    ]);
    (service as any).handleLockRequest(oldRequest, 'peer-b');
    expect(service.lockFor(mask.identifier)?.token).toBe('new-token');
  });

  it('keeps an orphaned lock generation as the floor for a recreated mask', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let identifier = mask.identifier;
    (service as any).handleLockRequest(lockRequest(mask, 'old-token'), 'peer-b');

    ObjectStore.instance.remove(mask);
    (service as any).clearOrphanedLocks();
    let retiredFloor = ObjectStore.instance.get<GameTableMaskScratchLock>(
      GameTableMaskScratchLock.identifierFor(identifier)
    )!.generation;
    let recreatedMask = GameTableMask.create('recreated', 4, 4, 100, identifier);
    let staleRequest = {
      maskIdentifier: identifier,
      token: 'stale-token',
      generation: retiredFloor,
    };
    (service as any).handleLockRequest(staleRequest, 'peer-c');

    expect(recreatedMask.scratchLockGeneration).toBe(3);
    expect(service.lockFor(identifier)).toBeNull();

    (service as any).handleLockRequest(lockRequest(recreatedMask, 'fresh-token'), 'peer-c');
    expect(service.lockFor(identifier)?.token).toBe('fresh-token');
    expect(recreatedMask.scratchLockGeneration).toBe(4);
  });

  it('rejects an old generation after long use and a fresh lock store', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let oldestRequest = lockRequest(mask, 'oldest-token');

    for (let index = 0; index < 40; index++) {
      let request = lockRequest(mask, `token-${index}`);
      (service as any).handleLockRequest(request, 'peer-b');
      (service as any).handleReleaseRequest(request, 'peer-b');
    }
    expect(mask.scratchLockGeneration).toBe(80);

    ObjectStore.instance.get<GameTableMaskScratchLock>(
      GameTableMaskScratchLock.identifierFor(mask.identifier)
    )?.destroy();
    service = new GameTableMaskScratchService();
    (service as any).handleLockRequest(oldestRequest, 'peer-b');

    expect(service.lockFor(mask.identifier)).toBeNull();
    expect(mask.scratchLockGeneration).toBe(80);
  });

  it('moves every mask to a fresh generation when a room is loaded', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let delayedRequest = lockRequest(mask, 'delayed-token');

    (service as any).resetScratchStateForRoomLoad();
    (service as any).handleLockRequest(delayedRequest, 'peer-b');

    expect(mask.scratchLockGeneration).toBeGreaterThan(delayedRequest.generation);
    expect(service.lockFor(mask.identifier)).toBeNull();
  });

  it('allows only one local scratch editing reservation at a time', async () => {
    let firstMask = GameTableMask.create('first', 4, 4, 100);
    let secondMask = GameTableMask.create('second', 4, 4, 100);
    (service as any).handleLockRequest(lockRequest(firstMask, 'local-token'), 'peer-a');

    expect(await service.acquire(secondMask.identifier)).toBeNull();
  });

  it('treats a repeated commit token as the same completed operation', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let lock = lockRequest(mask, 'token-b');
    (service as any).handleLockRequest(lock, 'peer-b');
    lock = {
      ...lock,
      generation: service.lockFor(mask.identifier)!.generation,
    };

    let request = {
      ...lock,
      area: { x: 0, y: 0, width: 2, height: 2 },
    };
    (service as any).handleCommitRequest(request, 'peer-b');
    (service as any).handleCommitRequest(request, 'peer-b');

    expect(mask.scratchData).toBe('0,0,2,2');
    expect(mask.scratchCommitToken).toBe('token-b');
  });

  it('does not commit while a new coordinator is still synchronizing', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    let request = lockRequest(mask, 'token-b');
    (service as any).handleLockRequest(request, 'peer-b');
    let commitRequest = {
      ...request,
      generation: service.lockFor(mask.identifier)!.generation,
      area: { x: 0, y: 0, width: 1, height: 1 },
    };
    (service as any).coordinatorReadyAfter = performance.now() + 1000;

    (service as any).handleCommitRequest(commitRequest, 'peer-b');

    expect(mask.scratchData).toBe('');
    expect(service.lockFor(mask.identifier)?.token).toBe('token-b');
  });

  it('does not wait forever for an orphaned synchronization request', () => {
    let synchronizer = ObjectSynchronizer.instance as any;
    let originalRequestMap = synchronizer.requestMap;
    let originalTasks = synchronizer.tasks;
    synchronizer.requestMap = new Map([['orphan', {
      identifier: 'orphan',
      version: 1,
      holderIds: ['disconnected-peer'],
      ttl: 1,
    }]]);
    synchronizer.tasks = [];

    try {
      expect((service as any).isCoordinatorReady).toBe(true);
    } finally {
      synchronizer.requestMap = originalRequestMap;
      synchronizer.tasks = originalTasks;
    }
  });

  it('lets only the room master peer arbitrate room locks', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    RoomState.instance.roomMasterUserId = 'master-user';
    (Network as any).connection = fakeConnection('peer-b', 'user-b', true, [
      fakePeer('peer-master', 'master-user'),
    ]);

    (service as any).handleLockRequest(lockRequest(mask, 'token-b'), 'peer-b');
    expect(service.lockFor(mask.identifier)).toBeNull();

    (Network as any).connection = fakeConnection('peer-master', 'master-user', true, [
      fakePeer('peer-b', 'user-b'),
    ]);
    (service as any).handleLockRequest(lockRequest(mask, 'token-b'), 'peer-b');

    expect(service.lockFor(mask.identifier)?.ownerPeerId).toBe('peer-b');
  });

  it('uses one deterministic coordinator for a private peer connection', () => {
    let mask = GameTableMask.create('test', 4, 4, 100);
    (Network as any).connection = fakeConnection('peer-b', 'user-b', false, [
      fakePeer('peer-a', 'user-a'),
    ]);

    (service as any).handleLockRequest(lockRequest(mask, 'token-b'), 'peer-b');
    expect(service.lockFor(mask.identifier)).toBeNull();

    (Network as any).connection = fakeConnection('peer-a', 'user-a', false, [
      fakePeer('peer-b', 'user-b'),
    ]);
    (service as any).handleLockRequest(lockRequest(mask, 'token-b'), 'peer-b');

    expect(service.lockFor(mask.identifier)?.ownerPeerId).toBe('peer-b');
  });
});

function lockRequest(mask: GameTableMask, token: string) {
  return {
    maskIdentifier: mask.identifier,
    token: token,
    generation: mask.scratchLockGeneration,
  };
}

function fakeConnection(peerId: string, userId: string, isRoom: boolean, peers: any[]): any {
  return {
    peerId: peerId,
    peerIds: peers.map(peer => peer.peerId),
    peer: {
      ...fakePeer(peerId, userId),
      isRoom: isRoom,
    },
    peers: peers,
  };
}

function fakePeer(peerId: string, userId: string): any {
  return {
    peerId: peerId,
    userId: userId,
    isOpen: true,
    isRoom: true,
  };
}
