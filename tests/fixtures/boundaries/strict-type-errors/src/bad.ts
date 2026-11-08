// Every construct below must be rejected when compiled with tsconfig.base.json.

// noImplicitAny
export function implicitAny(value) {
  return value;
}

// noUncheckedIndexedAccess
export function uncheckedIndex(values: string[], index: number): string {
  return values[index].toUpperCase();
}

// exactOptionalPropertyTypes
interface Options {
  label?: string;
}

export function exactOptional(): Options {
  return { label: undefined };
}

// lib is ES2024 only: no DOM globals
export function domLeak(): number {
  return window.innerWidth;
}

// noImplicitReturns
export function missingReturn(value: number): number {
  if (value > 0) {
    return value;
  }
}
