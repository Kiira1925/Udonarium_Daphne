export type BuffOperator = '+' | '-' | '*';
export type BuffEffectKind = 'stat' | 'note';

export interface BuffEffectEntry {
  kind: BuffEffectKind;
  statusName: string;
  operator: BuffOperator;
  amount: number;
  description?: string;
}

export interface BuffEffect {
  id: string;
  targetIdentifier: string;
  effects?: BuffEffectEntry[];
  kind?: BuffEffectKind;
  name: string;
  statusName?: string;
  operator?: BuffOperator;
  amount?: number;
  description?: string;
  remainingRounds: number;
  createdRound: number;
}

export interface BuffTemplate {
  id: string;
  ownerIdentifier: string;
  effects?: BuffEffectEntry[];
  kind?: BuffEffectKind;
  name: string;
  statusName?: string;
  operator?: BuffOperator;
  amount?: number;
  description?: string;
  durationRounds: number;
}

