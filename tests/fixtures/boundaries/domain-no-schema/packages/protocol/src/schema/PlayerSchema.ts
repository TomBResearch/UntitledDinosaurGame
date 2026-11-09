import { Schema } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  constructor(public readonly entityId: string) {
    super();
  }
}
