import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';

@SyncObject('character-action-state')
export class CharacterActionState extends GameObject {
  @SyncVar() characterIdentifier: string = '';
  @SyncVar() battleSequence: number = 0;
  @SyncVar() completedRound: number = 0;

  static identifierFor(characterIdentifier: string): string {
    return `CharacterAction_${characterIdentifier}`;
  }

  static create(characterIdentifier: string, battleSequence: number, completedRound: number): CharacterActionState {
    let state = new CharacterActionState(CharacterActionState.identifierFor(characterIdentifier));
    state.characterIdentifier = characterIdentifier;
    state.battleSequence = battleSequence;
    state.completedRound = completedRound;
    state.initialize();
    return state;
  }

  setCompleted(battleSequence: number, completedRound: number) {
    this.battleSequence = battleSequence;
    this.completedRound = completedRound;
  }
}

