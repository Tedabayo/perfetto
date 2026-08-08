import m from 'mithril';

export interface RepeatedPatternRow {
  readonly id: number;
  readonly name: string | null;
  readonly from_address: string | null;
  readonly to_address: string | null;
  readonly depth: number;
  readonly call_type: string | null;
}

let expandedPatternSignature: string | null = null;

interface PatternGroup {
  readonly signature: string;
  readonly name: string;
  readonly fromAddress: string | null;
  readonly toAddress: string | null;
  readonly depth: number;
  readonly callType: string | null;
  readonly count: number;
  readonly sliceIds: readonly number[];
}

function patternSignature(row: RepeatedPatternRow): string {
  return [
    row.name ?? '[unnamed]',
    row.from_address ?? '[from unavailable]',
    row.to_address ?? '[to unavailable]',
    String(row.depth),
    row.call_type ?? '[type unavailable]',
  ].join('|');
}

function shortAddress(address: string | null): string {
  if (address === null) return 'Unavailable';
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function renderRepeatedPatterns(
  rows: readonly RepeatedPatternRow[],
  onSelectSlice: (sliceId: number) => void,
): m.Children {
  const grouped = new Map<
    string,
    {
      row: RepeatedPatternRow;
      count: number;
      sliceIds: number[];
    }
  >();

  for (const row of rows) {
    const signature = patternSignature(row);
    const existing = grouped.get(signature);

    if (existing === undefined) {
      grouped.set(signature, {row, count: 1, sliceIds: [row.id]});
    } else {
      existing.count++;
      existing.sliceIds.push(row.id);
    }
  }

  const repeatedPatterns: PatternGroup[] = Array.from(grouped.values())
    .filter((group) => group.count > 1)
    .map((group) => ({
      signature: patternSignature(group.row),
      name: group.row.name ?? '[unnamed]',
      fromAddress: group.row.from_address,
      toAddress: group.row.to_address,
      depth: group.row.depth,
      callType: group.row.call_type,
      count: group.count,
      sliceIds: group.sliceIds,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return m(
    'div',
    {style: 'padding:16px;font-size:13px;'},
    m(
      'h2',
      {style: 'margin:0 0 6px;font-size:16px;font-weight:600;'},
      'Repeated Execution Patterns',
    ),
    m(
      'p',
      {style: 'margin:0 0 4px;color:#555;'},
      `${repeatedPatterns.length} repeated structural call patterns found.`,
    ),
    m(
      'p',
      {style: 'margin:0 0 16px;color:#777;font-size:12px;'},
      'Patterns group calls with the same function name, caller, target, ' +
        'depth, and call type when available. Repetition alone does not ' +
        'indicate a vulnerability.',
    ),

    repeatedPatterns.length === 0
      ? m('p', 'No repeated structural call patterns were found.')
      : m(
          'div',
          {style: 'overflow:auto;'},
          m(
            'table',
            {
              style:
                'width:100%;border-collapse:collapse;font-size:12px;' +
                'min-width:760px;',
            },
            m(
              'thead',
              m(
                'tr',
                [
                  'Function',
                  'Occurrences',
                  'Depth',
                  'Caller',
                  'Target',
                  'Call type',
                ].map((label) =>
                  m(
                    'th',
                    {
                      style:
                        'text-align:left;padding:7px 8px;' +
                        'border-bottom:1px solid #ccc;',
                    },
                    label,
                  ),
                ),
              ),
            ),
            m(
              'tbody',
              repeatedPatterns.flatMap((pattern) => {
                const expanded =
                  expandedPatternSignature === pattern.signature;

                const patternRow = m(
                  'tr',
                  {
                    style:
                      'border-bottom:1px solid #eee;cursor:pointer;',
                    onclick: () => {
                      expandedPatternSignature = expanded
                        ? null
                        : pattern.signature;
                    },
                  },
                  m(
                    'td',
                    {style: 'padding:7px 8px;font-weight:600;'},
                    `${expanded ? '▾' : '▸'} ${pattern.name}`,
                  ),
                  m(
                    'td',
                    {style: 'padding:7px 8px;'},
                    String(pattern.count),
                  ),
                  m(
                    'td',
                    {style: 'padding:7px 8px;'},
                    String(pattern.depth),
                  ),
                  m(
                    'td',
                    {
                      style:
                        'padding:7px 8px;font-family:monospace;',
                      title: pattern.fromAddress ?? 'Unavailable',
                    },
                    shortAddress(pattern.fromAddress),
                  ),
                  m(
                    'td',
                    {
                      style:
                        'padding:7px 8px;font-family:monospace;',
                      title: pattern.toAddress ?? 'Unavailable',
                    },
                    shortAddress(pattern.toAddress),
                  ),
                  m(
                    'td',
                    {style: 'padding:7px 8px;'},
                    pattern.callType ?? 'Unavailable',
                  ),
                );

                if (!expanded) return [patternRow];

                const occurrencesRow = m(
                  'tr',
                  m(
                    'td',
                    {
                      colspan: 6,
                      style:
                        'padding:8px 12px 12px 28px;' +
                        'border-bottom:1px solid #ddd;',
                    },
                    m(
                      'div',
                      {
                        style:
                          'margin-bottom:6px;color:#666;font-size:12px;',
                      },
                      'Occurrences — click a slice to select it in Perfetto:',
                    ),
                    pattern.sliceIds.map((sliceId) =>
                      m(
                        'button',
                        {
                          style:
                            'margin:0 6px 6px 0;padding:4px 8px;' +
                            'cursor:pointer;',
                          onclick: () => onSelectSlice(sliceId),
                        },
                        `slice[${sliceId}]`,
                      ),
                    ),
                  ),
                );

                return [patternRow, occurrencesRow];
              }),
            ),
          ),
        ),
  );
}
