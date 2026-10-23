import type { Diagnostic } from './diagnostics.ts';
import type { ItemPlan, Plan } from './plan.ts';

export interface Output {
  line(text?: string): void;
  error(text: string): void;
}

export interface Style {
  bold(s: string): string; dim(s: string): string; red(s: string): string; green(s: string): string;
  yellow(s: string): string; cyan(s: string): string;
}

const wrap = (on: boolean, a: number, b: number) => (s: string) => (on ? `\x1b[${a}m${s}\x1b[${b}m` : s);
export function makeStyle(colour: boolean): Style {
  return {
    bold: wrap(colour, 1, 22), dim: wrap(colour, 2, 22), red: wrap(colour, 31, 39), green: wrap(colour, 32, 39),
    yellow: wrap(colour, 33, 39), cyan: wrap(colour, 36, 39),
  };
}

export function consoleOutput(): { out: Output; style: Style } {
  const colour = !!process.stdout.isTTY && !process.env.NO_COLOR;
  return {
    out: { line: (t = '') => process.stdout.write(`${t}\n`), error: (t) => process.stderr.write(`${t}\n`) },
    style: makeStyle(colour),
  };
}

/** Collects lines in memory (tests). */
export function memoryOutput(): Output & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return { lines, line: (t = '') => lines.push(t), error: (t) => lines.push(t), text: () => lines.join('\n') };
}

export function printDiagnostics(out: Output, st: Style, diags: Diagnostic[]): void {
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of diags) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  for (const [file, list] of byFile) {
    out.line(st.bold(file || '(catalog)'));
    for (const d of list) {
      const tag = d.level === 'error' ? st.red('error  ') : st.yellow('warning');
      out.line(`  ${tag} ${d.path ? st.dim(`${d.path}: `) : ''}${d.message}`);
    }
  }
}

const SIGN = { create: '+', update: '~', remove: '-' } as const;

export function printPlan(out: Output, st: Style, plan: Plan): void {
  const colour = { create: st.green, update: st.yellow, remove: st.red } as const;
  let c = 0, u = 0, r = 0;
  for (const item of plan.items) {
    if (item.changes.length === 0 && item.blockers.length === 0) {
      if (item.kind !== 'attributes') out.line(`${st.dim('=')} ${item.kind} ${st.bold(item.key)} ${st.dim('unchanged')}`);
      continue;
    }
    out.line(`${item.isNew ? st.green('+') : st.yellow('~')} ${item.kind} ${st.bold(item.key)} ${st.dim(`(${item.file})`)}`);
    for (const ch of item.changes) {
      out.line(`    ${colour[ch.op](`${SIGN[ch.op]} ${ch.what}`)}${ch.detail ? st.dim(`  ${ch.detail}`) : ''}`);
      if (ch.op === 'create') c++; else if (ch.op === 'update') u++; else r++;
    }
    for (const b of item.blockers) out.line(`    ${st.red('! blocked:')} ${b}`);
  }
  out.line();
  out.line(`Plan: ${st.green(`${c} to create`)}, ${st.yellow(`${u} to update`)}, ${st.red(`${r} to remove`)}.`);
}

export function summariseItem(item: ItemPlan): string {
  return `${item.changes.length} change${item.changes.length === 1 ? '' : 's'}`;
}
