import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';

@SyncObject('character-action-state')
export class CharacterActionState extends GameObject {
  @SyncVar() characterIdentifier: string = '';
  @SyncVar() battleSequence: number = 0;
  @SyncVar() completedRound: number = 0;
  @SyncVar() excluded: boolean = false;

  static identifierFor(characterIdentifier: string): string {
    return `CharacterAction_${characterIdentifier}`;
  }

  static create(characterIdentifier: string, battleSequence: number, completedRound: number, excluded: boolean = false): CharacterActionState {
    let state = new CharacterActionState(CharacterActionState.identifierFor(characterIdentifier));
    state.characterIdentifier = characterIdentifier;
    state.battleSequence = battleSequence;
    state.completedRound = completedRound;
    state.excluded = excluded;
    state.initialize();
    return state;
  }

  setCompleted(battleSequence: number, completedRound: number) {
    let context = this.toContext();
    context.syncData = {
      ...context.syncData,
      battleSequence: battleSequence,
      completedRound: completedRound,
      excluded: this.battleSequence === battleSequence && this.excluded === true,
    };
    this.apply(context);
    this.update();
  }

  setExcluded(battleSequence: number, excluded: boolean) {
    let context = this.toContext();
    context.syncData = {
      ...context.syncData,
      battleSequence: battleSequence,
      completedRound: 0,
      excluded: excluded,
    };
    this.apply(context);
    this.update();
  }
}

