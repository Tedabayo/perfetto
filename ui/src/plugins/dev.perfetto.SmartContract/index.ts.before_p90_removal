// Smart Contract Trace Visualization Plugin for Perfetto
// ========================================================
// This plugin adds smart contract specific visualization to Perfetto:
// 1. Colour coding by visual category
// 2. Smart Contract Gas Graph panel
// 3. Legend panel explaining colour categories
//
// Gas-heavy classification uses the 90th-percentile threshold per transaction
// following: Işman & Sangsawang (2025), Journal of Current Research in Blockchain
// https://jcrb.net/index.php/Journal/article/view/47/43

import m from 'mithril';
import type {Trace} from '../../public/trace';
import type {PerfettoPlugin} from '../../public/plugin';
import {NUM, STR_NULL} from '../../trace_processor/query_result';

const CATEGORY_COLOURS: Record<string, string> = {
  'access_control': '#9B59B6',
  'money_flow': '#27AE60',
  'gas_heavy': '#E74C3C',
  'contract_call': '#2980B9',
  'normal_call': '#95A5A6',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'access_control': 'Permission and authorisation calls',
  'money_flow': 'ETH value transfers',
  'gas_heavy':
    'Calls at or above the 90th-percentile gas threshold for this transaction',
  'contract_call': 'Ordinary inter-contract calls',
  'normal_call': 'All other calls',
};

interface SliceRow {
  id: number;
  name: string | null;
  visual_category: string | null;
  gas_used: number;
  gas_assigned: number;
  call_type: string | null;
  value: string | null;
  depth: number;
}

function calculateP90(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);

  if (sorted.length === 0) return 0;

  const index = 0.9 * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = lower + 1;

  if (upper >= sorted.length) {
    return Math.round(sorted[sorted.length - 1]);
  }

  const fraction = index - lower;
  const interpolated =
    sorted[lower] + fraction * (sorted[upper] - sorted[lower]);

  return Math.round(interpolated);
}

function fmtGas(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return String(v);
}

function fmtGasUsageRatio(gasUsed: number, gasAssigned: number): string {
  if (gasAssigned <= 0) return 'not available';
  return `${((gasUsed / gasAssigned) * 100).toFixed(2)}%`;
}

export default class SmartContractPlugin implements PerfettoPlugin {
  static readonly id = 'dev.perfetto.SmartContract';

  async onTraceLoad(ctx: Trace): Promise<void> {
    const slices = await this.querySlices(ctx);
    console.log(`[SmartContract] Loaded ${slices.length} smart contract slices`);

    // ── Legend panel ──────────────────────────────────────────────────────────
    ctx.sidePanel.registerTab({
      uri: 'dev.perfetto.SmartContract#Legend',
      title: 'Smart Contract Legend',
      icon: 'info',
      render: () => {
        const counts: Record<string, number> = {};

        for (const cat of Object.keys(CATEGORY_COLOURS)) {
          counts[cat] = 0;
        }

        for (const s of slices) {
          const cat = s.visual_category ?? 'normal_call';
          counts[cat] = (counts[cat] ?? 0) + 1;
        }

        return m(
          'div',
          {style: 'padding:16px;font-size:13px;line-height:1.6;'},
          m(
            'h2',
            {style: 'margin:0 0 4px;font-size:15px;'},
            'Smart Contract Legend',
          ),
          m(
            'p',
            {style: 'margin:0 0 16px;color:#666;'},
            `${slices.length} slices loaded`,
          ),
          Object.keys(CATEGORY_COLOURS).map((cat) =>
            m(
              'div',
              {
                style:
                  'display:flex;align-items:flex-start;gap:8px;' +
                  'margin-bottom:10px;',
              },
              m('span', {
                style:
                  'display:inline-block;width:14px;height:14px;margin-top:2px;' +
                  `border-radius:3px;background:${CATEGORY_COLOURS[cat]};` +
                  'flex-shrink:0;',
              }),
              m(
                'div',
                m('strong', `${cat} (${counts[cat] ?? 0})`),
                m(
                  'div',
                  {style: 'color:#666;font-size:12px;'},
                  CATEGORY_DESCRIPTIONS[cat],
                ),
              ),
            ),
          ),
        );
      },
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ShowLegendPanel',
      name: 'Smart Contract: Show Legend Panel',
      callback: () => ctx.sidePanel.showTab('dev.perfetto.SmartContract#Legend'),
    });

    // ── Gas Graph panel ───────────────────────────────────────────────────────
    ctx.sidePanel.registerTab({
      uri: 'dev.perfetto.SmartContract#GasGraph',
      title: 'Smart Contract Gas Graph',
      icon: 'bar_chart',
      render: () => {
        const gasRows = slices.filter((s) => s.gas_used > 0);
        const gasValues = gasRows.map((s) => s.gas_used);

        if (gasRows.length === 0) {
          return m(
            'div',
            {style: 'padding:16px;font-size:13px;'},
            m(
              'h2',
              {style: 'margin:0 0 8px;font-size:15px;font-weight:600;'},
              'Smart Contract Gas Distribution',
            ),
            m('p', {style: 'color:#666;'}, 'No gas data found in this trace.'),
          );
        }

        const p90 = calculateP90(gasValues);
        const maxGas = Math.max(...gasValues, 1);
        const gasHeavyCount = gasRows.filter((s) => s.gas_used >= p90).length;
        const total = gasRows.length;

        const categoryCounts: Record<string, number> = {};

        for (const cat of Object.keys(CATEGORY_COLOURS)) {
          categoryCounts[cat] = 0;
        }

        for (const row of gasRows) {
          const cat = row.visual_category ?? 'normal_call';
          categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        }

        const moneyFlowCount = categoryCounts['money_flow'] ?? 0;
        const maxGasUsed = maxGas;

        // SVG dimensions
        const W = 900;
        const H = 320;
        const PAD = {top: 30, right: 20, bottom: 56, left: 76};
        const plotW = W - PAD.left - PAD.right;
        const plotH = H - PAD.top - PAD.bottom;

        // Bar sizing
        const barW = Math.max(2, Math.floor((plotW / total) * 0.85));
        const gap = Math.max(1, Math.floor((plotW / total) * 0.15));

        // Log-scale Y axis for highly skewed gas distributions.
        // This changes only the visual scale, not the underlying gas values.
        const scaleY = (v: number) => {
          if (v <= 0) return plotH;

          const logMax = Math.log10(maxGasUsed + 1);
          const logValue = Math.log10(v + 1);

          return plotH - (logValue / logMax) * plotH;
        };

        const p90Y = scaleY(p90);

        // Y axis ticks for log-scale chart
        const yTickValues = [
          1,
          10,
          100,
          1_000,
          10_000,
          100_000,
          1_000_000,
          maxGasUsed,
        ].filter((v, i, arr) => v <= maxGasUsed && arr.indexOf(v) === i);

        const yTicks = yTickValues.map((v) => ({
          v,
          y: scaleY(v),
        }));

        // X axis ticks
        const xTickInterval = 50;
        const xTicks: number[] = [];

        for (let i = 0; i <= total; i += xTickInterval) {
          xTicks.push(Math.min(i, total));
        }

        if (xTicks[xTicks.length - 1] !== total) {
          xTicks.push(total);
        }

        const bars = gasRows.map((row, i) => {
          const isHeavy = row.gas_used >= p90;
          const cat = isHeavy
            ? 'gas_heavy'
            : (row.visual_category ?? 'normal_call');
          const colour = CATEGORY_COLOURS[cat] ?? CATEGORY_COLOURS['normal_call'];

          const safeGas = Math.max(row.gas_used, 1);
          const logMax = Math.log10(maxGasUsed + 1);
          const logGas = Math.log10(safeGas + 1);

          const bh = Math.max(1, (logGas / logMax) * plotH);
          const x = PAD.left + i * (barW + gap);
          const y = PAD.top + (plotH - bh);

          const tooltip = [
            `Function: ${row.name ?? 'unknown'}`,
            `Category: ${cat}`,
            `Call type: ${row.call_type ?? 'unknown'}`,
            `Gas used: ${row.gas_used.toLocaleString()}`,
            `Gas assigned: ${
              row.gas_assigned > 0
                ? row.gas_assigned.toLocaleString()
                : 'not available'
            }`,
            `Gas usage ratio: ${fmtGasUsageRatio(row.gas_used, row.gas_assigned)}`,
            `Value: ${row.value ?? '0x0'}`,
            `Depth: ${row.depth}`,
          ].join('\n');

          return m(
            'rect',
            {
              key: i,
              x,
              y,
              width: barW,
              height: bh,
              fill: colour,
            },
            m('title', tooltip),
          );
        });

        return m(
          'div',
          {style: 'padding:16px;font-size:13px;'},

          m(
            'h2',
            {style: 'margin:0 0 4px;font-size:15px;font-weight:600;'},
            'Smart Contract Gas Distribution',
          ),

          // Summary cards
          m(
            'div',
            {
              style:
                'display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));' +
                'gap:8px;margin:10px 0 12px 0;',
            },
            [
              ['Total calls', total.toLocaleString()],
              ['P90 threshold', p90.toLocaleString()],
              [
                'Gas-heavy calls',
                `${gasHeavyCount} (${Math.round((gasHeavyCount / total) * 100)}%)`,
              ],
              ['Max gas used', maxGasUsed.toLocaleString()],
              ['Money-flow calls', moneyFlowCount.toLocaleString()],
            ].map(([label, value]) =>
              m(
                'div',
                {
                  style:
                    'border:1px solid #ddd;border-radius:6px;padding:8px;' +
                    'background:#fafafa;min-height:44px;',
                },
                m(
                  'div',
                  {style: 'font-size:11px;color:#666;margin-bottom:3px;'},
                  label,
                ),
                m(
                  'div',
                  {style: 'font-size:15px;font-weight:600;color:#222;'},
                  value,
                ),
              ),
            ),
          ),

          m(
            'p',
            {style: 'margin:0 0 12px;color:#555;'},
            'Gas-heavy calls are calls with gas used at or above the interpolated 90th-percentile threshold.',
          ),

          // Category counts
          m(
            'div',
            {style: 'margin:0 0 14px 0;'},
            m(
              'div',
              {style: 'font-size:12px;font-weight:600;margin-bottom:6px;color:#333;'},
              'Category counts',
            ),
            m(
              'div',
              {style: 'display:flex;flex-wrap:wrap;gap:8px;font-size:11px;'},
              Object.keys(CATEGORY_COLOURS).map((cat) =>
                m(
                  'span',
                  {
                    style:
                      'display:flex;align-items:center;gap:5px;' +
                      'border:1px solid #ddd;border-radius:12px;padding:4px 8px;' +
                      'background:#fff;',
                  },
                  m('span', {
                    style:
                      'width:10px;height:10px;border-radius:2px;' +
                      `background:${CATEGORY_COLOURS[cat]};display:inline-block;`,
                  }),
                  `${cat}: ${categoryCounts[cat] ?? 0}`,
                ),
              ),
            ),
          ),

          // Legend row
          m(
            'div',
            {
              style:
                'display:flex;flex-wrap:wrap;gap:12px;' +
                'margin-bottom:14px;font-size:11px;',
            },
            Object.keys(CATEGORY_COLOURS).map((cat) =>
              m(
                'span',
                {style: 'display:flex;align-items:center;gap:4px;'},
                m('span', {
                  style:
                    'width:10px;height:10px;border-radius:2px;' +
                    `background:${CATEGORY_COLOURS[cat]};display:inline-block;`,
                }),
                cat,
              ),
            ),
            m(
              'span',
              {style: 'display:flex;align-items:center;gap:6px;'},
              m('span', {
                style:
                  'width:20px;height:2px;background:#111;display:inline-block;' +
                  'border-top:2px dashed #111;',
              }),
              'P90 threshold',
            ),
          ),

          // SVG chart
          m(
            'div',
            {style: 'overflow-x:auto;'},
            m(
              'svg',
              {
                viewBox: `0 0 ${W} ${H}`,
                width: '100%',
                style: 'display:block;font-family:sans-serif;',
              },

              // Plot background
              m('rect', {
                x: PAD.left,
                y: PAD.top,
                width: plotW,
                height: plotH,
                fill: '#fafafa',
                stroke: '#ddd',
                'stroke-width': 1,
              }),

              // Y gridlines and labels
              yTicks.map(({v, y}) => [
                m('line', {
                  x1: PAD.left,
                  y1: PAD.top + y,
                  x2: PAD.left + plotW,
                  y2: PAD.top + y,
                  stroke: '#e5e5e5',
                  'stroke-width': 1,
                }),
                m(
                  'text',
                  {
                    x: PAD.left - 8,
                    y: PAD.top + y + 4,
                    'text-anchor': 'end',
                    'font-size': 10,
                    fill: '#666',
                  },
                  fmtGas(v),
                ),
              ]),

              // X axis tick marks and labels
              xTicks.map((i) => {
                const x = PAD.left + i * (barW + gap);

                return [
                  m('line', {
                    x1: x,
                    y1: PAD.top + plotH,
                    x2: x,
                    y2: PAD.top + plotH + 5,
                    stroke: '#888',
                    'stroke-width': 1,
                  }),
                  m(
                    'text',
                    {
                      x,
                      y: PAD.top + plotH + 16,
                      'text-anchor': 'middle',
                      'font-size': 10,
                      fill: '#666',
                    },
                    String(i),
                  ),
                ];
              }),

              // Bars with tooltip
              bars,

              // P90 threshold dashed line
              m('line', {
                x1: PAD.left,
                y1: PAD.top + p90Y,
                x2: PAD.left + plotW,
                y2: PAD.top + p90Y,
                stroke: '#111',
                'stroke-width': 2,
                'stroke-dasharray': '7,4',
              }),

              m(
                'text',
                {
                  x: PAD.left + 8,
                  y: PAD.top + p90Y - 6,
                  'font-size': 10,
                  'font-weight': 'bold',
                  fill: '#111',
                },
                `P90 = ${p90.toLocaleString()}`,
              ),

              // Axes
              m('line', {
                x1: PAD.left,
                y1: PAD.top,
                x2: PAD.left,
                y2: PAD.top + plotH,
                stroke: '#888',
                'stroke-width': 1,
              }),

              m('line', {
                x1: PAD.left,
                y1: PAD.top + plotH,
                x2: PAD.left + plotW,
                y2: PAD.top + plotH,
                stroke: '#888',
                'stroke-width': 1,
              }),

              // X axis label
              m(
                'text',
                {
                  x: PAD.left + plotW / 2,
                  y: H - 8,
                  'text-anchor': 'middle',
                  'font-size': 11,
                  fill: '#444',
                },
                'Call index (transaction order)',
              ),

              // Y axis label
              m(
                'text',
                {
                  x: 14,
                  y: PAD.top + plotH / 2,
                  'text-anchor': 'middle',
                  'font-size': 11,
                  fill: '#444',
                  transform: `rotate(-90, 14, ${PAD.top + plotH / 2})`,
                },
                'Gas used (log scale)',
              ),
            ),
          ),

          m(
            'p',
            {style: 'font-size:11px;color:#888;margin-top:10px;line-height:1.5;'},
            'Figure 1. Gas usage per smart contract call in transaction order. ' +
              'The Y-axis uses a logarithmic scale, log10(gas used + 1), ' +
              'to improve visibility across highly skewed gas values. ' +
              'Dashed line marks the interpolated 90th percentile threshold (P90 = ' +
              p90.toLocaleString() +
              ' gas units). ' +
              'Red bars indicate gas-heavy calls. Source: Işman & Sangsawang (2025).',
          ),
        );
      },
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ShowGasGraphPanel',
      name: 'Smart Contract: Show Gas Graph Panel',
      callback: () => ctx.sidePanel.showTab('dev.perfetto.SmartContract#GasGraph'),
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ColourByCategory',
      name: 'Smart Contract: Show Category Summary',
      callback: () => {
        const counts: Record<string, number> = {};

        for (const cat of Object.keys(CATEGORY_COLOURS)) {
          counts[cat] = 0;
        }

        for (const s of slices) {
          const cat = s.visual_category ?? 'normal_call';
          counts[cat] = (counts[cat] ?? 0) + 1;
        }

        console.log('[SmartContract] Category counts:', counts);
        console.log('[SmartContract] Colour map:', CATEGORY_COLOURS);
      },
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#GasSummary',
      name: 'Smart Contract: Show Gas Summary',
      callback: () => {
        const gasValues = slices.map((s) => s.gas_used).filter((g) => g > 0);

        if (gasValues.length === 0) {
          console.log('[SmartContract] No gas data found in trace');
          return;
        }

        const p90 = calculateP90(gasValues);
        const maxGas = Math.max(...gasValues);
        const avgGas = gasValues.reduce((a, b) => a + b, 0) / gasValues.length;
        const gasHeavyCount = gasValues.filter((g) => g >= p90).length;

        console.log('[SmartContract] Gas summary:');
        console.log(`  Total slices:   ${gasValues.length}`);
        console.log(`  Average gas:    ${avgGas.toFixed(0)}`);
        console.log(`  P90:            ${p90}`);
        console.log(`  Gas-heavy:      ${gasHeavyCount}`);
        console.log(`  Max gas:        ${maxGas}`);
      },
    });
  }

  private async querySlices(ctx: Trace): Promise<SliceRow[]> {
    try {
      const result = await ctx.engine.query(`
        SELECT
          s.id AS id,
          s.name AS name,
          cat_arg.string_value AS visual_category,

          COALESCE(
            CAST(gas_used_arg.int_value AS INT),
            CAST(gas_used_arg.string_value AS INT),
            0
          ) AS gas_used,

          COALESCE(
            CAST(gas_assigned_decimal_arg.int_value AS INT),
            CAST(gas_assigned_decimal_arg.string_value AS INT),
            CAST(gas_decimal_arg.int_value AS INT),
            CAST(gas_decimal_arg.string_value AS INT),
            CAST(gas_arg.int_value AS INT),
            CAST(gas_arg.string_value AS INT),
            0
          ) AS gas_assigned,

          kind_arg.string_value AS call_type,
          value_arg.string_value AS value,
          s.depth AS depth

        FROM slice s

        LEFT JOIN args cat_arg
          ON cat_arg.arg_set_id = s.arg_set_id
         AND cat_arg.key = 'args.visual_category'

        LEFT JOIN args gas_used_arg
          ON gas_used_arg.arg_set_id = s.arg_set_id
         AND gas_used_arg.key = 'args.gas_used_decimal'

        LEFT JOIN args gas_assigned_decimal_arg
          ON gas_assigned_decimal_arg.arg_set_id = s.arg_set_id
         AND gas_assigned_decimal_arg.key = 'args.gas_assigned_decimal'

        LEFT JOIN args gas_decimal_arg
          ON gas_decimal_arg.arg_set_id = s.arg_set_id
         AND gas_decimal_arg.key = 'args.gas_decimal'

        LEFT JOIN args gas_arg
          ON gas_arg.arg_set_id = s.arg_set_id
         AND gas_arg.key = 'args.gas'

        LEFT JOIN args kind_arg
          ON kind_arg.arg_set_id = s.arg_set_id
         AND kind_arg.key = 'args.kind'

        LEFT JOIN args value_arg
          ON value_arg.arg_set_id = s.arg_set_id
         AND value_arg.key = 'args.value'

        WHERE cat_arg.string_value IS NOT NULL
        ORDER BY s.ts
      `);

      const rows: SliceRow[] = [];
      const iter = result.iter({
        id: NUM,
        name: STR_NULL,
        visual_category: STR_NULL,
        gas_used: NUM,
        gas_assigned: NUM,
        call_type: STR_NULL,
        value: STR_NULL,
        depth: NUM,
      });

      for (; iter.valid(); iter.next()) {
        rows.push({
          id: iter.id,
          name: iter.name,
          visual_category: iter.visual_category,
          gas_used: iter.gas_used,
          gas_assigned: iter.gas_assigned,
          call_type: iter.call_type,
          value: iter.value,
          depth: iter.depth,
        });
      }

      return rows;
    } catch (e) {
      console.warn('[SmartContract] Could not query slices:', e);
      return [];
    }
  }
}