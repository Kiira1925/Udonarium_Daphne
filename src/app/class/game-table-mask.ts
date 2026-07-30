import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectContext } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';

export interface GameTableMaskScratchArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

@SyncObject('table-mask')
export class GameTableMask extends TabletopObject {
  @SyncVar() isLock: boolean = false;
  @SyncVar() scratchData: string = '';
  @SyncVar() scratchCommitToken: string = '';
  @SyncVar() scratchLockGeneration: number = 0;

  get name(): string { return this.getCommonValue('name', ''); }
  get width(): number { return this.getCommonValue('width', 1); }
  get height(): number { return this.getCommonValue('height', 1); }
  get scratchAreas(): GameTableMaskScratchArea[] {
    return GameTableMask.parseScratchData(this.scratchData, this.width, this.height);
  }
  get opacity(): number {
    let element = this.getElement('opacity', this.commonDataElement);
    let num = element ? <number>element.currentValue / <number>element.value : 1;
    return Number.isNaN(num) ? 1 : num;
  }

  override apply(context: ObjectContext) {
    let syncData = context?.syncData as { attributes?: Record<string, unknown> };
    let incomingAttributes = syncData?.attributes ?? {};
    let currentGeneration = GameTableMask.isValidScratchLockGeneration(this.scratchLockGeneration)
      ? this.scratchLockGeneration
      : 0;
    let parsedIncomingGeneration = Number(incomingAttributes['scratchLockGeneration']);
    let incomingGeneration = GameTableMask.isValidScratchLockGeneration(parsedIncomingGeneration)
      ? parsedIncomingGeneration
      : 0;
    let scratchLockGeneration = Math.max(currentGeneration, incomingGeneration);

    let currentScratchData = typeof this.scratchData === 'string' ? this.scratchData : '';
    let incomingScratchData = typeof incomingAttributes['scratchData'] === 'string'
      ? incomingAttributes['scratchData'] as string
      : '';
    let scratchData = GameTableMask.mergeScratchData(currentScratchData, incomingScratchData);

    let currentCommitToken = typeof this.scratchCommitToken === 'string' ? this.scratchCommitToken : '';
    let incomingCommitToken = typeof incomingAttributes['scratchCommitToken'] === 'string'
      ? incomingAttributes['scratchCommitToken'] as string
      : '';
    let scratchCommitToken = incomingGeneration < currentGeneration || !incomingCommitToken
      ? currentCommitToken
      : incomingCommitToken;
    let shouldRepublishMergedState = currentGeneration > incomingGeneration
      || scratchData !== incomingScratchData
      || scratchCommitToken !== incomingCommitToken;
    let previousVersion = this.version;

    super.apply({
      ...context,
      syncData: {
        ...syncData,
        attributes: {
          ...incomingAttributes,
          scratchData: scratchData,
          scratchCommitToken: scratchCommitToken,
          scratchLockGeneration: scratchLockGeneration,
        },
      },
    });
    let incomingVersion = context.majorVersion + context.minorVersion;
    if (shouldRepublishMergedState
      && incomingVersion !== previousVersion
      && ObjectStore.instance.get(this.identifier) === this) {
      this.update();
    }
  }

  static create(name: string, width: number, height: number, opacity: number, identifier?: string): GameTableMask {
    let object: GameTableMask = null;

    if (identifier) {
      object = new GameTableMask(identifier);
    } else {
      object = new GameTableMask();
    }
    object.createDataElements();

    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('opacity', opacity, { type: 'numberResource', currentValue: opacity }, 'opacity_' + object.identifier));
    object.initialize();

    return object;
  }

  addScratchArea(area: GameTableMaskScratchArea): boolean {
    return this.applyScratchArea(area, '');
  }

  commitScratchArea(
    area: GameTableMaskScratchArea,
    commitToken: string,
    expectedGeneration: number = this.scratchLockGeneration
  ): boolean {
    if (!commitToken) return false;
    if (!GameTableMask.isValidScratchLockGeneration(expectedGeneration)
      || this.scratchLockGeneration !== expectedGeneration) {
      return false;
    }
    return this.applyScratchArea(area, commitToken, expectedGeneration + 1);
  }

  advanceScratchLockGeneration(expectedGeneration: number): boolean {
    if (!GameTableMask.isValidScratchLockGeneration(expectedGeneration)
      || this.scratchLockGeneration !== expectedGeneration
      || Number.MAX_SAFE_INTEGER <= expectedGeneration) {
      return false;
    }

    let context = this.toContext();
    let syncData = context.syncData as { attributes?: Record<string, unknown> };
    context.syncData = {
      ...syncData,
      attributes: {
        ...syncData.attributes,
        scratchLockGeneration: expectedGeneration + 1,
      },
    };
    this.apply(context);
    this.update();
    return true;
  }

  ensureScratchLockGenerationAtLeast(generationFloor: number): boolean {
    if (!GameTableMask.isValidScratchLockGeneration(generationFloor)) return false;
    if (generationFloor <= this.scratchLockGeneration) return true;

    let context = this.toContext();
    let syncData = context.syncData as { attributes?: Record<string, unknown> };
    context.syncData = {
      ...syncData,
      attributes: {
        ...syncData.attributes,
        scratchLockGeneration: generationFloor,
      },
    };
    this.apply(context);
    this.update();
    return true;
  }

  private applyScratchArea(
    area: GameTableMaskScratchArea,
    commitToken: string,
    nextLockGeneration?: number
  ): boolean {
    let normalized = GameTableMask.normalizeScratchArea(area, this.width, this.height);
    if (!normalized) return false;
    if (nextLockGeneration != null
      && !GameTableMask.isValidScratchLockGeneration(nextLockGeneration)) {
      return false;
    }

    let areas = GameTableMask.compactScratchAreas(this.scratchAreas.concat(normalized));
    let context = this.toContext();
    let syncData = context.syncData as { attributes?: Record<string, unknown> };
    context.syncData = {
      ...syncData,
      attributes: {
        ...syncData.attributes,
        scratchData: GameTableMask.encodeScratchData(areas),
        scratchCommitToken: commitToken,
        ...(nextLockGeneration == null ? {} : { scratchLockGeneration: nextLockGeneration }),
      },
    };
    this.apply(context);
    this.update();
    return true;
  }

  static isValidScratchLockGeneration(generation: number): boolean {
    return Number.isSafeInteger(generation) && 0 <= generation;
  }

  static parseScratchData(scratchData: string, maskWidth: number, maskHeight: number): GameTableMaskScratchArea[] {
    if (typeof scratchData !== 'string' || scratchData.length < 1) return [];

    let areas: GameTableMaskScratchArea[] = [];
    for (let item of scratchData.split(';')) {
      let values = item.split(',').map(value => Number(value));
      if (values.length !== 4) continue;

      let area = GameTableMask.normalizeScratchArea({
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
      }, maskWidth, maskHeight);
      if (area) areas.push(area);
    }
    return GameTableMask.compactScratchAreas(areas);
  }

  static encodeScratchData(areas: GameTableMaskScratchArea[]): string {
    return areas
      .slice()
      .sort((left, right) => left.y - right.y || left.x - right.x || left.height - right.height || left.width - right.width)
      .map(area => `${area.x},${area.y},${area.width},${area.height}`)
      .join(';');
  }

  private static mergeScratchData(current: string, incoming: string): string {
    if (!current) return incoming;
    if (!incoming) return current;
    let maximumGridSize = Number.MAX_SAFE_INTEGER;
    return GameTableMask.encodeScratchData(GameTableMask.parseScratchData(
      `${current};${incoming}`,
      maximumGridSize,
      maximumGridSize
    ));
  }

  static normalizeScratchArea(
    area: GameTableMaskScratchArea,
    maskWidth: number,
    maskHeight: number
  ): GameTableMaskScratchArea | null {
    let values = [area?.x, area?.y, area?.width, area?.height, maskWidth, maskHeight].map(value => Number(value));
    if (values.some(value => !Number.isFinite(value))) return null;

    let [x, y, width, height] = values;
    let columns = Math.max(1, Math.ceil(maskWidth));
    let rows = Math.max(1, Math.ceil(maskHeight));
    let left = Math.max(0, Math.floor(x));
    let top = Math.max(0, Math.floor(y));
    let right = Math.min(columns, Math.ceil(x + width));
    let bottom = Math.min(rows, Math.ceil(y + height));
    if (right <= left || bottom <= top) return null;

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  private static compactScratchAreas(areas: GameTableMaskScratchArea[]): GameTableMaskScratchArea[] {
    let compacted = areas.filter((area, index, source) =>
      !source.some((other, otherIndex) =>
        otherIndex !== index
        && GameTableMask.containsScratchArea(other, area)
        && (!GameTableMask.containsScratchArea(area, other) || otherIndex < index)
      )
    );

    let merged = true;
    while (merged) {
      merged = false;
      outer:
      for (let leftIndex = 0; leftIndex < compacted.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < compacted.length; rightIndex++) {
          let area = GameTableMask.mergeScratchAreas(compacted[leftIndex], compacted[rightIndex]);
          if (!area) continue;

          compacted.splice(rightIndex, 1);
          compacted[leftIndex] = area;
          merged = true;
          break outer;
        }
      }
    }
    return compacted;
  }

  private static containsScratchArea(container: GameTableMaskScratchArea, area: GameTableMaskScratchArea): boolean {
    return container.x <= area.x
      && container.y <= area.y
      && area.x + area.width <= container.x + container.width
      && area.y + area.height <= container.y + container.height;
  }

  private static mergeScratchAreas(
    left: GameTableMaskScratchArea,
    right: GameTableMaskScratchArea
  ): GameTableMaskScratchArea | null {
    if (left.y === right.y && left.height === right.height) {
      let start = Math.min(left.x, right.x);
      let end = Math.max(left.x + left.width, right.x + right.width);
      if (Math.max(left.x, right.x) <= Math.min(left.x + left.width, right.x + right.width)) {
        return { x: start, y: left.y, width: end - start, height: left.height };
      }
    }
    if (left.x === right.x && left.width === right.width) {
      let start = Math.min(left.y, right.y);
      let end = Math.max(left.y + left.height, right.y + right.height);
      if (Math.max(left.y, right.y) <= Math.min(left.y + left.height, right.y + right.height)) {
        return { x: left.x, y: start, width: left.width, height: end - start };
      }
    }
    return null;
  }
}
