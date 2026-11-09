// src/schema is the one place the pinned schema runtime is permitted inside @udg/protocol.
import { Schema } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  constructor(public readonly entityId: string) {
    super();
  }
}
