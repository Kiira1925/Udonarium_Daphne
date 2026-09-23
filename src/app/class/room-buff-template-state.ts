import { BuffDurationType, BuffEffectEntry, BuffTemplate } from './buff-effect';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { UUID } from './core/system/util/uuid';

@SyncObject('room-buff-template-state')
export class RoomBuffTemplateState extends GameObject {
  @SyncVar() ownerIdentifier: string = '';
  @SyncVar() name: string = '';
  @SyncVar() entries: BuffEffectEntry[] = [];
  @SyncVar() durationType: BuffDurationType = 'round';
  @SyncVar() durationRounds: number = 1;
  @SyncVar() resourceCommands: string[] = [];

  static create(ownerIdentifier: string, name: string, entries: BuffEffectEntry[], durationRounds: number, identifier: string = UUID.generateUuid(), resourceCommands: string[] = [], durationType: BuffDurationType = 'round'): RoomBuffTemplateState {
    let state = new RoomBuffTemplateState(identifier);
    state.ownerIdentifier = ownerIdentifier;
    state.name = name;
    state.entries = entries.map(entry => ({ ...entry }));
    state.durationType = durationType;
    state.durationRounds = durationRounds;
    state.resourceCommands = resourceCommands.slice();
    state.initialize();
    return state;
  }

  updateFrom(template: Omit<BuffTemplate, 'id'>) {
    let context = this.toContext();
    context.syncData = {
      ...context.syncData,
      ownerIdentifier: template.ownerIdentifier,
      name: template.name,
      entries: (template.effects ?? []).map(entry => ({ ...entry })),
      durationType: template.durationType === 'instant' ? 'instant' : 'round',
      durationRounds: template.durationRounds,
      resourceCommands: (template.resourceCommands ?? []).slice(),
    };
    this.apply(context);
    this.update();
  }

  toBuffTemplate(): BuffTemplate {
    let first = this.entries[0];
    return {
      id: this.identifier,
      ownerIdentifier: this.ownerIdentifier,
      effects: this.entries.map(entry => ({ ...entry })),
      kind: first?.kind ?? 'stat',
      name: this.name,
      statusName: first?.statusName ?? '',
      operator: first?.operator ?? '+',
      amount: first?.amount ?? 0,
      description: first?.description ?? '',
      durationType: this.durationType === 'instant' ? 'instant' : 'round',
      durationRounds: this.durationRounds,
      resourceCommands: this.resourceCommands.slice(),
    };
  }
}

