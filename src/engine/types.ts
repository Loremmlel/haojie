/* types.ts · Game/GameDeps 纯类型（UI 无副作用导入——只含类型 import，运行时零依赖） */
import type { GameState, GameEvent, ChoiceResult, Chooser, ChoiceSpec, Session, Piece } from './state.ts';
import type { Cell } from './data.ts';

export interface GameDeps { choose?: Chooser }

export interface Game {
  readonly state: GameState;
  readonly events: GameEvent[];         // 同一数组引用，供 FX 游标消费
  canUndo(): boolean;
  undo(): boolean;
  deployFollower(handIdx: number, x: number, y: number): Promise<boolean>;
  discardUnplaceable(handIdx: number): boolean;
  storeHandSpell(handIdx: number): Promise<boolean>;
  castHandSpell(handIdx: number, got: ChoiceResult): Promise<boolean>;
  castStored(idx: number, got: ChoiceResult): Promise<boolean>;
  doMove(uid: number, x: number, y: number): Promise<boolean>;
  doAttack(uid: number, targetUid: number): Promise<boolean>;
  useSkill(uid: number): Promise<boolean>;
  endTurn(): Promise<void>;
  rules: {
    moveTargets(p: Piece): Cell[];
    attackTargets(p: Piece): Piece[];
    healTargets(p: Piece): Piece[];
    deployCells(defId: number, owner: number): Cell[];
    skillInfo(p: Piece): SkillInfo | null;
    effActions(p: Piece): number;
    effRange(p: Piece): number;
    bigCharge(p: Piece): number;
  };
}

export interface HandlerCtx { choose: Chooser }

export interface SkillInfo {
  label: string;
  usable(p: Piece): boolean;
  targetSpec(st: GameState, p: Piece): ChoiceSpec;
  exec(ctx: HandlerCtx, s: Session, p: Piece, got: ChoiceResult): Promise<void>;
}
