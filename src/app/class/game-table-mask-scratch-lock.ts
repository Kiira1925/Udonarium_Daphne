import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';

@SyncObject('game-table-mask-scratch-lock')
export class GameTableMaskScratchLock extends GameObject {
  @SyncVar() maskIdentifier: string = '';
  @SyncVar() ownerPeerId: string = '';
  @SyncVar() token: string = '';
  @SyncVar() generation: number = 0;
  @SyncVar() retiredTokens: string = '';

  override apply(context: ObjectContext) {
    let incoming = context?.syncData as Record<string, unknown>;
    let currentGeneration = GameTableMaskScratchLock.isValidGeneration(this.generation)
      ? this.generation
      : 0;
    let parsedIncomingGeneration = Number(incoming?.['generation']);
    let incomingGeneration = GameTableMaskScratchLock.isValidGeneration(parsedIncomingGeneration)
      ? parsedIncomingGeneration
      : 0;
    let preserveCurrentState = incomingGeneration < currentGeneration;

    let incomingRetiredTokens = typeof incoming?.['retiredTokens'] === 'string'
      ? incoming['retiredTokens'] as string
      : '';
    let incomingOwnerPeerId = typeof incoming?.['ownerPeerId'] === 'string'
      ? incoming['ownerPeerId'] as string
      : '';
    let incomingToken = typeof incoming?.['token'] === 'string'
      ? incoming['token'] as string
      : '';
    let retiredTokens = Array.from(new Set(
      this.retiredTokenList.concat(GameTableMaskScratchLock.parseRetiredTokens(incomingRetiredTokens))
    )).slice(-32);
    let mergedState = {
      ...incoming,
      maskIdentifier: typeof incoming?.['maskIdentifier'] === 'string' && incoming['maskIdentifier']
        ? incoming['maskIdentifier']
        : this.maskIdentifier,
      ownerPeerId: preserveCurrentState ? this.ownerPeerId : incomingOwnerPeerId,
      token: preserveCurrentState ? this.token : incomingToken,
      generation: Math.max(currentGeneration, incomingGeneration),
      retiredTokens: retiredTokens.join(','),
    };
    let shouldRepublishMergedState = preserveCurrentState
      || mergedState.retiredTokens !== incomingRetiredTokens;
    let previousVersion = this.version;

    super.apply({ ...context, syncData: mergedState });
    let incomingVersion = context.majorVersion + context.minorVersion;
    if (shouldRepublishMergedState
      && incomingVersion !== previousVersion
      && ObjectStore.instance.get(this.identifier) === this) {
      this.update();
    }
  }

  static identifierFor(maskIdentifier: string): string {
    return `GameTableMaskScratchLock_${maskIdentifier}`;
  }

  static create(maskIdentifier: string): GameTableMaskScratchLock {
    let lock = new GameTableMaskScratchLock(GameTableMaskScratchLock.identifierFor(maskIdentifier));
    lock.maskIdentifier = maskIdentifier;
    lock.initialize();
    return lock;
  }

  get isActive(): boolean {
    return 0 < this.ownerPeerId.length && 0 < this.token.length;
  }

  isOwnedBy(ownerPeerId: string, token: string, generation?: number): boolean {
    return this.isActive
      && this.ownerPeerId === ownerPeerId
      && this.token === token
      && (generation == null || this.generation === generation);
  }

  isRetired(token: string): boolean {
    return !!token && this.retiredTokenList.includes(token);
  }

  setOwner(ownerPeerId: string, token: string, generation: number = 0): boolean {
    if (!ownerPeerId
      || !token
      || !Number.isSafeInteger(generation)
      || generation < 0
      || this.isRetired(token)) {
      return false;
    }
    this.applyState(ownerPeerId, token, generation);
    return true;
  }

  retire(token: string): boolean {
    if (!token || this.isRetired(token)) return false;
    this.applyState(this.ownerPeerId, this.token, this.generation, token);
    return true;
  }

  ensureGenerationFloor(generationFloor: number): boolean {
    if (this.isActive
      || !Number.isSafeInteger(generationFloor)
      || generationFloor < 0) {
      return false;
    }
    if (generationFloor <= this.generation) return true;
    this.applyState('', '', generationFloor);
    return true;
  }

  private applyState(
    ownerPeerId: string,
    token: string,
    generation: number,
    retireToken: string = ''
  ) {
    let context = this.toContext();
    let retiredTokens = this.retiredTokenList;
    if (retireToken && !retiredTokens.includes(retireToken)) {
      retiredTokens.push(retireToken);
      retiredTokens = retiredTokens.slice(-32);
    }
    context.syncData = {
      ...context.syncData,
      ownerPeerId: ownerPeerId,
      token: token,
      generation: generation,
      retiredTokens: retiredTokens.join(','),
    };
    this.apply(context);
    this.update();
  }

  clear(): boolean;
  clear(ownerPeerId: string, token: string): boolean;
  clear(ownerPeerId: string, token: string, generation: number): boolean;
  clear(ownerPeerId?: string, token?: string, generation?: number): boolean {
    if ((ownerPeerId == null) !== (token == null)) return false;
    if (ownerPeerId != null && !this.isOwnedBy(ownerPeerId, token, generation)) return false;
    if (!this.isActive) return ownerPeerId == null;
    let generationFloor = this.generation < Number.MAX_SAFE_INTEGER
      ? this.generation + 1
      : this.generation;
    this.applyState('', '', generationFloor, this.token);
    return true;
  }

  private get retiredTokenList(): string[] {
    return GameTableMaskScratchLock.parseRetiredTokens(this.retiredTokens);
  }

  private static parseRetiredTokens(tokens: string): string[] {
    return tokens.split(',').filter(token => 0 < token.length);
  }

  private static isValidGeneration(generation: number): boolean {
    return Number.isSafeInteger(generation) && 0 <= generation;
  }
}
