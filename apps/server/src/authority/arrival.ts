/**
 * Ingest order and copy-on-record (P03-a, P03-g).
 *
 * `arrivalOrdinal` is the server-private monotonic counter the cutoff is taken from (P03-b). A
 * message is copied into a frozen, JSON-safe record at intake: the pinned codec reuses mutable
 * buffers, so a queued observation that shares a live object would let a later decode rewrite
 * history (P03-g "Copy-on-record").
 */

import { canonicalHash } from '@udg/config';
import type { EntityId, Generation, SessionEpoch } from '@udg/protocol';

import {
  MAX_ARRIVAL_ORDINAL,
  RENDERED_INVALID_PREFIX,
  type ArrivalOrdinal,
  type ArrivalRecord,
  type ControlKind,
  type MessageKind,
  type ObservationKind,
  type RenderedValue,
} from './types.js';

/** Strictly monotonic ingest counter. At the bound it refuses rather than wraps (P03-a). */
export class ArrivalOrder {
  #counter: ArrivalOrdinal = 0;

  get current(): ArrivalOrdinal {
    return this.#counter;
  }

  get exhausted(): boolean {
    return this.#counter >= MAX_ARRIVAL_ORDINAL;
  }

  /** Reserve the next ordinal, or report the bound. Never wraps. */
  next(): ArrivalOrdinal | 'exhausted' {
    if (this.exhausted) return 'exhausted';
    this.#counter += 1;
    return this.#counter;
  }
}

const describeType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'number' && !Number.isFinite(value as number)) return `non-finite ${String(value)}`;
  if (type === 'number' && Object.is(value as number, -0)) return 'negative zero';
  return type;
};

/** Render one decoded value so the journal can re-run screening from the record alone (AC-20). */
export const renderValue = (value: unknown): RenderedValue => {
  const type = typeof value;
  if (value === null) return { kind: 'value', value: null };
  if (type === 'string' || type === 'boolean') return { kind: 'value', value: value as string | boolean };
  if (type === 'number') {
    const numeric = value as number;
    if (Number.isFinite(numeric)) return { kind: 'value', value: numeric };
    return { kind: 'invalid', type: describeType(value), render: `${RENDERED_INVALID_PREFIX}${String(value)}>` };
  }
  if (type === 'bigint') {
    return { kind: 'invalid', type: 'bigint', render: `${RENDERED_INVALID_PREFIX}${String(value)}>` };
  }
  return { kind: 'invalid', type: describeType(value), render: `${RENDERED_INVALID_PREFIX}${type}>` };
};

/**
 * The non-finite numbers, addressed by the rendering that stands for them.
 *
 * JSON cannot carry them, which is exactly why they are rendered as markers; a replay has to put the
 * number back, or the re-rendered field would say something different from the field that was refused.
 */
const NON_FINITE_BY_RENDER: Readonly<Record<string, number>> = Object.freeze({
  [`${RENDERED_INVALID_PREFIX}NaN>`]: Number.NaN,
  [`${RENDERED_INVALID_PREFIX}Infinity>`]: Number.POSITIVE_INFINITY,
  [`${RENDERED_INVALID_PREFIX}-Infinity>`]: Number.NEGATIVE_INFINITY,
});

/**
 * The value a replay substitutes for a rendered field.
 *
 * Lossless for JSON-representable values and for the non-finite numbers, which are what a decoded payload
 * actually produces when it is malformed. A rendered object, function or bigint has no JSON representation
 * to come back from, so it replays as its render string: screening still refuses it with the same code,
 * because a string is no more a finite number than the object was, and that residual difference is
 * recorded rather than papered over.
 */
export const replayValue = (rendered: RenderedValue): unknown => {
  if (rendered.kind === 'value') return rendered.value;
  const numeric = NON_FINITE_BY_RENDER[rendered.render];
  return numeric ?? rendered.render;
};

export const renderPayload = (
  raw: Readonly<Record<string, unknown>>,
): { readonly rendered: Readonly<Record<string, RenderedValue>>; readonly malformed: readonly string[] } => {
  const rendered: Record<string, RenderedValue> = {};
  const malformed: string[] = [];
  for (const key of Object.keys(raw).sort()) {
    const value = renderValue(raw[key]);
    rendered[key] = value;
    if (value.kind === 'invalid') malformed.push(key);
  }
  return { rendered: Object.freeze(rendered), malformed: Object.freeze(malformed) };
};

/** Rebuild the payload a screening pass would have received, from a rendered record. */
export const payloadFromRendered = (rendered: Readonly<Record<string, RenderedValue>>): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(rendered)) {
    payload[key] = replayValue(rendered[key] as RenderedValue);
  }
  return payload;
};

const readDeclaredNumber = (raw: Readonly<Record<string, unknown>>, key: string): number | null => {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const readDeclaredBoolean = (raw: Readonly<Record<string, unknown>>, key: string): boolean | null => {
  const value = raw[key];
  return typeof value === 'boolean' ? value : null;
};

/** The journal's observation kind: a `directIntent: false` frame is a keepalive observation (P03-f). */
export const observationKindFor = (kind: MessageKind, raw: Readonly<Record<string, unknown>>): ObservationKind => {
  switch (kind) {
    case 'direct':
      return readDeclaredBoolean(raw, 'directIntent') === false ? 'keepalive' : 'direct';
    case 'moveTo':
      return 'moveTo';
    case 'cancelPath':
      return 'cancel';
    case 'unknownMessage':
      return 'unknownMessage';
  }
};

/** The message class a payload belongs to, decided on its declared field set (protocol.md 4.2). */
export const classify = (raw: unknown): MessageKind => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'unknownMessage';
  const keys = new Set(Object.keys(raw as Record<string, unknown>));
  const direct =
    keys.size === 5 &&
    keys.has('sessionEpoch') &&
    keys.has('generation') &&
    keys.has('directIntent') &&
    keys.has('moveX') &&
    keys.has('moveZ');
  if (direct) return 'direct';
  const moveTo =
    keys.size === 6 &&
    keys.has('requestId') &&
    keys.has('sessionEpoch') &&
    keys.has('generation') &&
    keys.has('x') &&
    keys.has('y') &&
    keys.has('z');
  if (moveTo) return 'moveTo';
  const cancel =
    keys.size === 3 && keys.has('requestId') && keys.has('sessionEpoch') && keys.has('generation');
  if (cancel) return 'cancelPath';
  return 'unknownMessage';
};

export interface BuildArrivalInput {
  readonly ordinal: ArrivalOrdinal;
  readonly entityId: EntityId;
  readonly raw: unknown;
  readonly receivedAtMs: number;
  /**
   * The field-by-field rendering to record instead of deriving one from `raw` (replay only).
   *
   * JSON cannot carry an object, an array or a bigint, so a message that arrived with one of those is
   * journalled as an `invalid` field descriptor. Reconstructing a payload from that descriptor and rendering
   * it again would describe the field differently the second time - the artefact would say "object" on the
   * first run and "string" on the replay - and the replay would no longer reproduce the record it replays.
   *
   * Only the replay path supplies this, from the record it was handed; no client message can, because the
   * transport adapter calls `ingest` with the payload alone. A tampered artefact can say anything about its
   * own fields, which is no more than a tampered artefact can already say about its payload.
   */
  readonly rendered?: Readonly<Record<string, RenderedValue>>;
}

/** Copy a decoded message into the frozen record the queues and the journal hold. */
export const buildArrival = (input: BuildArrivalInput): ArrivalRecord => {
  const kind = classify(input.raw);
  const source: Record<string, unknown> =
    typeof input.raw === 'object' && input.raw !== null && !Array.isArray(input.raw)
      ? { ...(input.raw as Record<string, unknown>) }
      : { value: input.raw };
  const derived = renderPayload(source);
  const rendered = input.rendered === undefined ? derived.rendered : Object.freeze({ ...input.rendered });
  const malformed = input.rendered === undefined
    ? derived.malformed
    : Object.freeze(Object.keys(input.rendered).filter((key) => input.rendered?.[key]?.kind === 'invalid'));
  return Object.freeze({
    ordinal: input.ordinal,
    entityId: input.entityId,
    kind,
    control: null,
    declaredEpoch: readDeclaredNumber(source, 'sessionEpoch'),
    declaredGeneration: readDeclaredNumber(source, 'generation'),
    observationKind: observationKindFor(kind, source),
    raw: rendered,
    rawHash: canonicalHash(rendered),
    receivedAtMs: input.receivedAtMs,
    malformed,
  });
};

export interface BuildControlArrivalInput {
  readonly ordinal: ArrivalOrdinal;
  readonly entityId: EntityId;
  readonly control: ControlKind;
  readonly sessionEpoch: SessionEpoch | null;
  readonly receivedAtMs: number;
}

/** Lifecycle travels the same queue as messages, so stage L sees it inside the frozen set (P03-b/c). */
export const buildControlArrival = (input: BuildControlArrivalInput): ArrivalRecord => {
  const source: Record<string, unknown> = { control: input.control, sessionEpoch: input.sessionEpoch };
  const { rendered, malformed } = renderPayload(source);
  return Object.freeze({
    ordinal: input.ordinal,
    entityId: input.entityId,
    kind: 'unknownMessage' as MessageKind,
    control: input.control,
    declaredEpoch: input.sessionEpoch,
    declaredGeneration: null,
    observationKind: 'control' as ObservationKind,
    raw: rendered,
    rawHash: canonicalHash(rendered),
    receivedAtMs: input.receivedAtMs,
    malformed,
  });
};

/** The `requestId` a payload declares, without validating it: an unparsable identity must stay visible. */
export const declaredRequestId = (arrival: ArrivalRecord): string | null => {
  const rendered = arrival.raw['requestId'];
  if (rendered === undefined || rendered.kind !== 'value') return null;
  return typeof rendered.value === 'string' ? rendered.value : null;
};

/** The declared generation, narrowed to the domain the journal records. */
export const declaredGeneration = (arrival: ArrivalRecord): Generation | null =>
  arrival.declaredGeneration === null ? null : arrival.declaredGeneration;
