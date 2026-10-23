/** Plural forms per Intl.PluralRules category; `other` is mandatory and the fallback. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** Literal message tree → the same shape with plain strings, which every locale must satisfy. */
export type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { readonly [K in keyof T]: Widen<T[K]> };

/** Dotted paths to string or plural leaves (arrays are reached through `m`, not `t`). */
export type MessagePath<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends { other: string }
      ? `${P}${K}`
      : T[K] extends readonly unknown[]
        ? never
        : MessagePath<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Params = Record<string, string | number>;
