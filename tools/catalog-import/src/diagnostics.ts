export type Level = 'error' | 'warning';

export interface Diagnostic {
  level: Level;
  /** Manifest file (relative to the catalog directory), or '' for catalog-wide problems. */
  file: string;
  /** Dotted path inside the manifest, e.g. `option_prices.SEK.led-lights`. */
  path: string;
  message: string;
}

export class Diagnostics {
  readonly items: Diagnostic[] = [];
  error(file: string, path: string, message: string): void { this.items.push({ level: 'error', file, path, message }); }
  warn(file: string, path: string, message: string): void { this.items.push({ level: 'warning', file, path, message }); }
  get errors(): Diagnostic[] { return this.items.filter((d) => d.level === 'error'); }
  get warnings(): Diagnostic[] { return this.items.filter((d) => d.level === 'warning'); }
  get ok(): boolean { return this.errors.length === 0; }
}

/** Thrown for a failure that should stop the run with exit code 1 (bad input, rejected import). */
export class ImportError extends Error {
  constructor(message: string, readonly diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = 'ImportError';
  }
}
