import m from 'mithril';

export interface MoneyFlowRow {
  readonly id: number;
  readonly call_index: number;
  readonly name: string | null;
  readonly from_address: string | null;
  readonly to_address: string | null;
  readonly token_symbol: string | null;
  readonly token_contract: string | null;
  readonly transfer_amount: string | null;
  readonly transfer_amount_raw: string | null;
  readonly value_eth: string | null;
  readonly has_transfer_metadata: number;
  readonly has_native_value: number;
  readonly has_realized_native_value: number | null;
}

interface TransferRecord {
  readonly sliceId: number;
  readonly callIndex: number;
  readonly operation: string;
  readonly sender: string;
  readonly receiver: string;
  readonly asset: string;
  readonly amount: string;
  readonly amountIsRaw: boolean;
}

interface GraphNode {
  readonly address: string;
  readonly x: number;
  readonly y: number;
  readonly colour: string;
}

interface GraphEdge {
  readonly sender: string;
  readonly receiver: string;
  readonly label: string;
  readonly tooltip: string;
  readonly sliceIds: readonly number[];
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

let selectedAsset = 'All assets';
let edgeLabelMode: 'Compact' | 'Exact' = 'Compact';

function shortenAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function fallbackAsset(tokenContract: string | null): string {
  if (!tokenContract) return 'Unknown asset';
  return shortenAddress(tokenContract);
}

function compactAmount(amount: string): string {
  const numeric = Number(amount);

  if (!Number.isFinite(numeric)) {
    return amount.length > 12 ? `${amount.slice(0, 10)}…` : amount;
  }

  if (Math.abs(numeric) >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(3)}B`;
  }

  if (Math.abs(numeric) >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(3)}M`;
  }

  if (Math.abs(numeric) >= 1_000) {
    return numeric.toLocaleString(undefined, {
      maximumFractionDigits: 3,
    });
  }

  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function toTransferRecords(
  rows: readonly MoneyFlowRow[],
): TransferRecord[] {
  return rows
    .filter(
      (row) =>
        row.has_transfer_metadata > 0 ||
        row.has_realized_native_value === 1 ||
        (
          row.has_realized_native_value === null &&
          row.has_native_value > 0
        ),
    )
    .map((row) => {
      const tokenSymbol = row.token_symbol?.trim();
      const asset =
        tokenSymbol && tokenSymbol.length > 0
          ? tokenSymbol
          : row.has_native_value > 0
            ? 'ETH'
            : fallbackAsset(row.token_contract);

      const transferAmount = row.transfer_amount?.trim();
      const rawTransferAmount = row.transfer_amount_raw?.trim();
      const nativeAmount = row.value_eth?.trim();

      const hasNormalizedTransferAmount =
        transferAmount !== undefined &&
        transferAmount.length > 0;

      const hasRawTransferAmount =
        rawTransferAmount !== undefined &&
        rawTransferAmount.length > 0;

      const amount =
        hasNormalizedTransferAmount
          ? transferAmount
          : hasRawTransferAmount
            ? rawTransferAmount
            : nativeAmount && nativeAmount.length > 0
              ? nativeAmount
              : '0';

      const amountIsRaw =
        !hasNormalizedTransferAmount &&
        hasRawTransferAmount;

      return {
        sliceId: row.id,
        callIndex: row.call_index,
        operation: row.name ?? 'Unknown operation',
        sender: row.from_address ?? 'Unknown sender',
        receiver: row.to_address ?? 'Unknown receiver',
        asset,
        amount,
        amountIsRaw,
      };
    })
    .sort((a, b) => a.callIndex - b.callIndex);
}

function nodeColour(
  address: string,
  transfers: readonly TransferRecord[],
): string {
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return '#D64545';
  }

  const sends = transfers.some(
    (transfer) => transfer.sender === address,
  );
  const receives = transfers.some(
    (transfer) => transfer.receiver === address,
  );

  if (sends && receives) return '#2F6FE4';
  if (sends) return '#F39A05';
  return '#2A9D68';
}

function buildNodes(
  transfers: readonly TransferRecord[],
): GraphNode[] {
  const addresses = Array.from(
    new Set(
      transfers.flatMap((transfer) => [
        transfer.sender,
        transfer.receiver,
      ]),
    ),
  );

  const width = 920;
  const height = 520;
  const centreX = width / 2;
  const centreY = height / 2 + 12;
  const radiusX = Math.min(330, 115 + addresses.length * 23);
  const radiusY = Math.min(205, 90 + addresses.length * 15);

  return addresses.map((address, index) => {
    const angle =
      -Math.PI / 2 + (index * Math.PI * 2) / addresses.length;

    return {
      address,
      x: centreX + Math.cos(angle) * radiusX,
      y: centreY + Math.sin(angle) * radiusY,
      colour: nodeColour(address, transfers),
    };
  });
}

function buildEdges(
  transfers: readonly TransferRecord[],
): GraphEdge[] {
  if (
    selectedAsset === 'All assets' &&
    edgeLabelMode === 'Compact'
  ) {
    const grouped = new Map<
      string,
      {
        sender: string;
        receiver: string;
        records: TransferRecord[];
      }
    >();

    for (const transfer of transfers) {
      const key = `${transfer.sender}|${transfer.receiver}`;
      const current = grouped.get(key);

      if (current) {
        current.records.push(transfer);
      } else {
        grouped.set(key, {
          sender: transfer.sender,
          receiver: transfer.receiver,
          records: [transfer],
        });
      }
    }

    return Array.from(grouped.values()).map((group) => {
      const count = group.records.length;

      return {
        sender: group.sender,
        receiver: group.receiver,
        label: `${count} ${count === 1 ? 'transfer' : 'transfers'}`,
        sliceIds: group.records.map((record) => record.sliceId),
        tooltip: group.records
          .map(
            (record) =>
              `#${record.callIndex}: ${record.amount} ${record.asset}`,
          )
          .join('\n'),
      };
    });
  }

  return transfers.map((transfer) => ({
    sender: transfer.sender,
    receiver: transfer.receiver,
    sliceIds: [transfer.sliceId],
    label:
      edgeLabelMode === 'Exact'
        ? `#${transfer.callIndex}: ${transfer.amount}${
            transfer.amountIsRaw ? ' raw units' : ''
          } ${transfer.asset}`
        : `#${transfer.callIndex}: ${
            transfer.amountIsRaw
              ? transfer.amount
              : compactAmount(transfer.amount)
          }${transfer.amountIsRaw ? ' raw units' : ''} ${transfer.asset}`,
    tooltip:
      `Call #${transfer.callIndex}\n` +
      `${transfer.sender} → ${transfer.receiver}\n` +
      `${transfer.amount}${
        transfer.amountIsRaw ? ' raw units' : ''
      } ${transfer.asset}\n` +
      `Operation: ${transfer.operation}`,
  }));
}

function edgePath(
  sender: GraphNode,
  receiver: GraphNode,
  edgeIndex: number,
): string {
  const dx = receiver.x - sender.x;
  const dy = receiver.y - sender.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));

  const unitX = dx / distance;
  const unitY = dy / distance;

  const startX = sender.x + unitX * 24;
  const startY = sender.y + unitY * 24;
  const endX = receiver.x - unitX * 28;
  const endY = receiver.y - unitY * 28;

  const middleX = (startX + endX) / 2;
  const middleY = (startY + endY) / 2;

  const normalX = -unitY;
  const normalY = unitX;
  const bend = ((edgeIndex % 5) - 2) * 13;

  const controlX = middleX + normalX * bend;
  const controlY = middleY + normalY * bend;

  return [
    `M ${startX} ${startY}`,
    `Q ${controlX} ${controlY}`,
    `${endX} ${endY}`,
  ].join(' ');
}

function renderLegendItem(colour: string, label: string) {
  return m(
    'div',
    {
      style:
        'display:flex;align-items:center;gap:6px;' +
        'font-size:12px;font-weight:500;',
    },
    [
      m('span', {
        style:
          `display:inline-block;width:11px;height:11px;` +
          `border-radius:50%;background:${colour};`,
      }),
      m('span', label),
    ],
  );
}

function renderGraph(
  transfers: readonly TransferRecord[],
  onSelectSlice: (sliceId: number) => void,
) {
  const nodes = buildNodes(transfers);
  const edges = buildEdges(transfers);
  const nodeByAddress = new Map(
    nodes.map((node) => [node.address, node]),
  );

  return m(
    'div',
    {
      style:
        'border:1px solid #ddd;border-radius:6px;' +
        'background:#fff;overflow-x:auto;margin-bottom:18px;',
    },
    m(
      'svg',
      {
        "viewBox": '0 0 920 520',
        "style":
          'display:block;width:100%;min-width:760px;height:auto;',
        "role": 'img',
        'aria-label': 'Directed inter-contract money-flow graph',
      },
      [
        m('defs', [
          m(
            'marker',
            {
              id: 'money-flow-arrow',
              viewBox: '0 0 10 10',
              refX: 9,
              refY: 5,
              markerWidth: 7,
              markerHeight: 7,
              orient: 'auto-start-reverse',
            },
            m('path', {
              d: 'M 0 0 L 10 5 L 0 10 z',
              fill: '#718096',
            }),
          ),
        ]),

        edges.map((edge, index) => {
          const sender = nodeByAddress.get(edge.sender);
          const receiver = nodeByAddress.get(edge.receiver);

          if (!sender || !receiver) return null;

          const labelX = (sender.x + receiver.x) / 2;
          const labelY = (sender.y + receiver.y) / 2 - 7;

          return m('g', [
            m(
              'path',
              {
                "d": edgePath(sender, receiver, index),
                "fill": 'none',
                onclick: () => {
                  if (edge.sliceIds.length === 1) {
                    onSelectSlice(edge.sliceIds[0]);
                  } else {
                    edgeLabelMode = 'Exact';
                  }
                },
                "stroke": '#8194A3',
                'stroke-width': 3,
                'stroke-opacity': 0.82,
                'marker-end': 'url(#money-flow-arrow)',
                "style": 'cursor:pointer;',
              },
              m('title', edge.tooltip),
            ),

            m(
              'text',
              {
                "x": labelX,
                "y": labelY,
                'text-anchor': 'middle',
                "style":
                  'font-size:10px;font-weight:600;fill:#555;' +
                  'paint-order:stroke;stroke:#fff;stroke-width:4px;',
              },
              edge.label,
            ),
          ]);
        }),

        nodes.map((node) => {
          const labelOnLeft = node.x > 590;
          const labelX = labelOnLeft ? node.x - 31 : node.x + 31;
          const anchor = labelOnLeft ? 'end' : 'start';

          return m('g', [
            m(
              'circle',
              {
                "cx": node.x,
                "cy": node.y,
                "r": 22,
                "fill": node.colour,
                "stroke": '#fff',
                'stroke-width': 3,
              },
              m('title', node.address),
            ),
            m(
              'text',
              {
                "x": labelX,
                "y": node.y + 4,
                'text-anchor': anchor,
                "style":
                  'font-size:11px;font-weight:600;fill:#333;' +
                  'paint-order:stroke;stroke:#fff;stroke-width:4px;',
              },
              shortenAddress(node.address),
            ),
          ]);
        }),
      ],
    ),
  );
}

function renderTransferTable(
  transfers: readonly TransferRecord[],
  onSelectSlice: (sliceId: number) => void,
) {
  return m(
    'div',
    {
      style:
        'border:1px solid #ddd;border-radius:6px;' +
        'overflow:hidden;background:#fff;',
    },
    [
      m(
        'div',
        {
          style:
            'display:grid;' +
            'grid-template-columns:70px 1.1fr 1.4fr 1.1fr 130px;' +
            'gap:10px;padding:8px 10px;background:#f5f5f5;' +
            'border-bottom:1px solid #ccc;font-size:11px;' +
            'font-weight:700;',
        },
        [
          m('div', 'Call'),
          m('div', 'Sender'),
          m('div', 'Amount and asset'),
          m('div', 'Receiver'),
          m('div', 'Operation'),
        ],
      ),

      m(
        'div',
        {style: 'max-height:360px;overflow-y:auto;'},
        transfers.map((transfer) =>
          m(
            'div',
            {
              onclick: () => onSelectSlice(transfer.sliceId),
              style:
                'display:grid;' +
                'grid-template-columns:70px 1.1fr 1.4fr 1.1fr 130px;' +
                'gap:10px;padding:8px 10px;' +
                'border-bottom:1px solid #eee;' +
                'font-size:11px;align-items:center;' +
                'cursor:pointer;',
            },
            [
              m(
                'div',
                {style: 'font-weight:700;'},
                `#${transfer.callIndex}`,
              ),
              m(
                'div',
                {title: transfer.sender},
                shortenAddress(transfer.sender),
              ),
              m(
                'div',
                {
                  title: `${transfer.amount}${
                    transfer.amountIsRaw ? ' raw units' : ''
                  } ${transfer.asset}`,
                  style:
                    'font-weight:600;' +
                    'font-variant-numeric:tabular-nums;',
                },
                `${transfer.amount}${
                  transfer.amountIsRaw ? ' raw units' : ''
                } ${transfer.asset}`,
              ),
              m(
                'div',
                {title: transfer.receiver},
                shortenAddress(transfer.receiver),
              ),
              m('div', transfer.operation),
            ],
          ),
        ),
      ),
    ],
  );
}

export function renderMoneyFlow(
  rows: readonly MoneyFlowRow[],
  onSelectSlice: (sliceId: number) => void,
) {
  const allTransfers = toTransferRecords(rows);

  if (allTransfers.length === 0) {
    return m(
      'div',
      {style: 'padding:16px;font-size:13px;'},
      [
        m(
          'h2',
          {style: 'margin:0 0 8px;font-size:17px;'},
          'Inter-Contract Money Flow',
        ),
        m(
          'p',
          'No token-transfer or native-value records were found.',
        ),
      ],
    );
  }

  const assets = [
    'All assets',
    ...Array.from(
      new Set(allTransfers.map((transfer) => transfer.asset)),
    ).sort(),
  ];

  if (!assets.includes(selectedAsset)) {
    selectedAsset = 'All assets';
  }

  const filteredTransfers =
    selectedAsset === 'All assets'
      ? allTransfers
      : allTransfers.filter(
          (transfer) => transfer.asset === selectedAsset,
        );

  const addressCount = new Set(
    filteredTransfers.flatMap((transfer) => [
      transfer.sender,
      transfer.receiver,
    ]),
  ).size;

  return m(
    'div',
    {
      style:
        'padding:16px;font-size:13px;line-height:1.45;' +
        'max-width:1120px;',
    },
    [
      m(
        'h2',
        {
          style:
            'margin:0 0 5px;font-size:18px;font-weight:600;',
        },
        'Inter-Contract Money Flow',
      ),

      m(
        'p',
        {style: 'margin:0 0 14px;color:#555;'},
        'Directed edges show asset movement between addresses. ' +
          'Exact amounts and call order are retained in the table below.',
      ),

      m(
        'div',
        {
          style:
            'display:flex;flex-wrap:wrap;align-items:center;' +
            'gap:14px;margin-bottom:12px;',
        },
        [
          m('label', {style: 'font-weight:600;'}, 'Asset:'),

          m(
            'select',
            {
              value: selectedAsset,
              onchange: (event: Event) => {
                selectedAsset = (
                  event.target as HTMLSelectElement
                ).value;
                m.redraw();
              },
              style:
                'min-width:210px;padding:6px 8px;' +
                'border:1px solid #aaa;border-radius:4px;',
            },
            assets.map((asset) =>
              m('option', {value: asset}, asset),
            ),
          ),

          m(
            'label',
            {style: 'font-weight:600;'},
            'Edge labels:',
          ),

          m(
            'select',
            {
              value: edgeLabelMode,
              onchange: (event: Event) => {
                edgeLabelMode = (
                  event.target as HTMLSelectElement
                ).value as 'Compact' | 'Exact';
                m.redraw();
              },
              style:
                'min-width:130px;padding:6px 8px;' +
                'border:1px solid #aaa;border-radius:4px;',
            },
            [
              m('option', {value: 'Compact'}, 'Compact'),
              m('option', {value: 'Exact'}, 'Exact'),
            ],
          ),

          m(
            'strong',
            `${filteredTransfers.length} transfer records · ` +
              `${addressCount} addresses`,
          ),
        ],
      ),

      m(
        'div',
        {
          style:
            'display:flex;flex-wrap:wrap;gap:18px;' +
            'justify-content:center;margin-bottom:12px;',
        },
        [
          renderLegendItem('#F39A05', 'Sender only'),
          renderLegendItem('#2A9D68', 'Receiver only'),
          renderLegendItem('#2F6FE4', 'Sends and receives'),
          renderLegendItem('#D64545', 'Burn / zero address'),
        ],
      ),

      renderGraph(filteredTransfers, onSelectSlice),

      m(
        'h3',
        {
          style:
            'margin:8px 0 3px;font-size:16px;font-weight:600;',
        },
        'Ordered Transfer Sequence',
      ),

      m(
        'p',
        {style: 'margin:0 0 10px;color:#666;font-size:12px;'},
        'Transfers are sorted by call index. Exact amounts are ' +
          'preserved as strings to avoid rounding.',
      ),

      renderTransferTable(filteredTransfers, onSelectSlice),

      m(
        'p',
        {
          style:
            'font-size:11px;color:#666;margin-top:12px;' +
            'border-top:1px solid #ddd;padding-top:9px;',
        },
        'Figure note: Node colours describe each address role within ' +
          'the selected transfer set. Token records without a decoded ' +
          'symbol are labelled using their shortened token-contract ' +
          'address rather than an inferred asset name.',
      ),
    ],
  );
}
