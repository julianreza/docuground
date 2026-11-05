export interface TableCell {
  tableTitle?: string | null;
  rowLabel?: string | null;
  rowId?: string | null;
  columnPath?: string | null;
  page: number;
  evidenceStatus: string;
}

export interface TableFragment<T extends TableCell> {
  title: string;
  page: number;
  pages?: number[];
  cells: T[];
}

export function groupTables<T extends TableCell>(items: readonly T[]): TableFragment<T>[] {
  const fragments = new Map<string, TableFragment<T>>();
  for (const item of items) {
    const title = item.tableTitle?.trim();
    if (!title || !item.rowLabel?.trim() || !item.columnPath?.trim() || item.evidenceStatus === 'rejected') continue;
    const key = JSON.stringify([item.page, title]);
    let fragment = fragments.get(key);
    if (!fragment) {
      fragment = { title, page: item.page, cells: [] };
      fragments.set(key, fragment);
    }
    fragment.cells.push(item);
  }
  return [...fragments.values()];
}

export function mergeTableFragments<T extends TableCell>(fragments: readonly TableFragment<T>[], pages: readonly { number: number; text: string }[]): TableFragment<T>[] {
  const sourcePages = new Map(pages.map((page) => [page.number, page.text]));
  const merged: TableFragment<T>[] = [];
  for (const fragment of fragments) {
    const tableNumber = (title: string) => title.match(/\btable\s+\d+\b/i)?.[0].replace(/\s+/g, ' ').toLowerCase();
    const previous = [...merged].reverse().find((candidate) => candidate.pages?.at(-1) === fragment.page - 1 && (candidate.title === fragment.title || (!!tableNumber(candidate.title) && tableNumber(candidate.title) === tableNumber(fragment.title))));
    const columns = (table: TableFragment<T>) => [...new Set(table.cells.map((cell) => cell.columnPath!.trim()))].sort();
    const title = (tableNumber(fragment.title) ?? fragment.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const continuation = new RegExp(`${title}\\s*\\(?continued\\)?`, 'i').test(sourcePages.get(fragment.page) ?? '');
    if (previous && continuation && JSON.stringify(columns(previous)) === JSON.stringify(columns(fragment))) {
      previous.cells.push(...fragment.cells);
      previous.pages!.push(fragment.page);
    } else {
      merged.push({ ...fragment, pages: [fragment.page], cells: [...fragment.cells] });
    }
  }
  return merged;
}

type PrintableCell = TableCell & {
  value: string | boolean | null;
  valueState?: string | null;
};

function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
}

export function renderTablesMarkdown<T extends PrintableCell>(tables: readonly TableFragment<T>[]): string {
  const sections: string[] = [];
  for (const table of tables) {
    const columns = [...new Set(table.cells.map((cell) => cell.columnPath!.trim()))];
    const noIdCounts = new Map<string, number>();
    for (const cell of table.cells) {
      if (cell.rowId?.trim()) continue;
      const key = JSON.stringify([cell.rowLabel!.trim(), cell.columnPath!.trim()]);
      noIdCounts.set(key, (noIdCounts.get(key) ?? 0) + 1);
    }
    const ambiguous = new Set(table.cells.filter((cell) => !cell.rowId?.trim() && (noIdCounts.get(JSON.stringify([cell.rowLabel!.trim(), cell.columnPath!.trim()])) ?? 0) > 1).map((cell) => cell.rowLabel!.trim()));
    const rows = new Map<string, { label: string; cells: T[]; ambiguous: boolean }>();
    table.cells.forEach((cell, index) => {
      const label = cell.rowLabel!.trim();
      const uncertain = !cell.rowId?.trim() && ambiguous.has(label);
      const key = JSON.stringify(uncertain ? ['ambiguous', index] : [cell.page, cell.rowId?.trim() || '', label]);
      const row = rows.get(key) ?? { label, cells: [], ambiguous: uncertain };
      row.cells.push(cell);
      rows.set(key, row);
    });
    const pageLabel = table.pages?.length ? table.pages.join(', ') : String(table.page);
    const lines = [`### ${escapeMarkdown(table.title)} · page ${pageLabel}`, '', `| Row | ${columns.map(escapeMarkdown).join(' | ')} |`, `| --- | ${columns.map(() => '---').join(' | ')} |`];
    for (const row of rows.values()) {
      const values = columns.map((column) => row.cells
        .filter((cell) => cell.columnPath!.trim() === column)
        .map((cell) => {
          const value = cell.value === null ? `[${(cell.valueState || 'unavailable').toUpperCase()}]` :
            typeof cell.value === 'boolean' ? (cell.value ? 'Selected' : 'Not selected') : cell.value;
          const estimate = cell.valueState === 'estimated' ? ' [ESTIMATED]' : '';
          const review = cell.evidenceStatus === 'needs_review' || row.ambiguous ? ' [NEEDS REVIEW]' : '';
          return `${escapeMarkdown(value + estimate + review)} (p. ${cell.page})`;
        }).join(' / ') || '');
      lines.push(`| ${escapeMarkdown(row.label)} | ${values.join(' | ')} |`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}
