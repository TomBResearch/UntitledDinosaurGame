// The compliant shape: domain declarations carry no runtime import at all, and the consumer that
// needs replica classes names the schema module itself.
export type EntityId = string;

export interface PlayerState {
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
