import { BuffEffect, BuffEffectEntry } from './buff-effect';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { StringUtil, CompareOption } from './core/system/util/string-util';

@SyncObject('room-effect-state')
export class RoomEffectState extends GameObject {
  @SyncVar() targetIdentifier: string = '';
  @SyncVar() battleSequence: number = 0;
  @SyncVar() name: string = '';
  @SyncVar() entries: BuffEffectEntry[] = [];
  @SyncVar() createdRound: number = 0;
  @SyncVar() expiresAtRound: number = 0;
  @SyncVar() active: boolean = true;

  static create(targetIdentifier: string, battleSequence: number, name: string, entries: BuffEffectEntry[], createdRound: number, durationRounds: number): RoomEffectState {
    let identifier = RoomEffectState.identifierFor(targetIdentifier, battleSequence, name, entries);
    let state = new RoomEffectState(identifier);
    state.targetIdentifier = targetIdentifier;
    state.battleSequence = battleSequence;
    state.name = name;
    state.entries = entries.map(entry => ({ ...entry }));
    state.createdRound = createdRound;
    state.expiresAtRound = createdRound + durationRounds;
    state.active = true;
    state.initialize();
    return state;
  }

  static identifierFor(targetIdentifier: string, battleSequence: number, name: string, entries: BuffEffectEntry[]): string {
    let normalizedName = StringUtil.normalize(name.trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth);
    let normalizedEntries = entries.map(entry => entry.kind === 'note'
      ? `note:${StringUtil.normalize((entry.description ?? '').trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth)}`
      : `stat:${StringUtil.normalize(entry.statusName.trim(), CompareOption.IgnoreCase | CompareOption.IgnoreWidth)}:${entry.operator}:${Number(entry.amount)}`
    ).sort();
    let source = `${targetIdentifier}|${battleSequence}|${normalizedName}|${normalizedEntries.join('|')}`;
    return `RoomEffect_${RoomEffectState.fnv1a64(source)}`;
  }

  refresh(createdRound: number, durationRounds: number) {
    this.active = true;
    this.createdRound = createdRound;
    this.expiresAtRound = createdRound + durationRounds;
  }

  toBuffEffect(round: number): BuffEffect {
    let first = this.entries[0];
    return {
      id: this.identifier,
      targetIdentifier: this.targetIdentifier,
      effects: this.entries.map(entry => ({ ...entry })),
      kind: first?.kind ?? 'stat',
      name: this.name,
      statusName: first?.statusName ?? '',
      operator: first?.operator ?? '+',
      amount: first?.amount ?? 0,
      description: first?.description ?? '',
      remainingRounds: Math.max(0, this.expiresAtRound - round),
      createdRound: this.createdRound,
    };
  }

  private static fnv1a64(source: string): string {
    let hash = 0xcbf29ce484222325n;
    let prime = 0x100000001b3n;
    for (let byte of new TextEncoder().encode(source)) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
  }
}
