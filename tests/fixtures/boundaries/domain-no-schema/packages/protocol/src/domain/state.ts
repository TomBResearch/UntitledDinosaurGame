// The violation this fixture exists to catch: the engine-free domain acquiring a schema runtime by
// both available routes. A direct dependency on the runtime, and a relative import of the sibling
// schema modules, are both invisible to the package-level schema rule because neither crosses a
// package boundary.
import { Schema } from '@colyseus/schema';
import { PlayerSchema } from '../schema/PlayerSchema.js';

export type EntityId = string;

export const project = (id: EntityId): PlayerSchema => new PlayerSchema(id) as unknown as PlayerSchema;
export const definition = Schema;
