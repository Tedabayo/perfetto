// Smart Contract Trace Visualization Plugin for Perfetto
// ========================================================
// This plugin adds smart contract specific visualization to Perfetto:
// 1. Colour coding by visual category
// 2. Smart Contract Gas Graph panel
// 3. Legend panel explaining colour categories
//
// Risk labels are read from verified trace evidence.
// No percentile or numerical gas-heavy threshold is calculated.

import m from 'mithril';
import type {Trace} from '../../public/trace';
import type {PerfettoPlugin} from '../../public/plugin';
import {NUM, STR_NULL} from '../../trace_processor/query_result';

const CATEGORY_COLOURS: Record<string, string> = {
  'access_control': '#9B59B6',
  'money_flow': '#27AE60',
  'potential_gas_limit_risk': '#E74C3C',
  'contract_call': '#2980B9',
  'normal_call': '#95A5A6',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'access_control': 'Permission and authorisation calls',
  'money_flow': 'ETH value transfers',
  'potential_gas_limit_risk':
    'Operation-family risk supported by controlled measurements and source inspection',
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
      title: 'Smart Contract Gas Evidence',
      icon: 'bar_chart',
      render: () => {
        const gasRows = slices.filter((s) => s.gas_used > 0);

        if (gasRows.length === 0) {
          return m(
            'div',
            {style: 'padding:16px;font-size:13px;'},
            m(
              'h2',
              {style: 'margin:0 0 8px;font-size:16px;font-weight:600;'},
              'Smart Contract Gas Evidence',
            ),
            m('p', 'No call-frame gas data was found in this trace.'),
          );
        }

        const maxGas = Math.max(...gasRows.map((s) => s.gas_used));
        const riskCount = gasRows.filter(
          (s) => s.visual_category === 'potential_gas_limit_risk',
        ).length;

        const cards = [
          ['Call frames with gas data', gasRows.length.toLocaleString()],
          ['Maximum inclusive frame gas', `${maxGas.toLocaleString()} gas`],
          ['Risk-labelled frames', riskCount.toLocaleString()],
          ['Numerical threshold', 'None'],
        ];

        return m(
          'div',
          {
            style:
              'padding:16px;font-size:13px;line-height:1.45;' +
              'max-width:1100px;',
          },
          [
            m(
              'h2',
              {style: 'margin:0 0 6px;font-size:17px;font-weight:600;'},
              'Measured Call-Frame Gas',
            ),

            m(
              'p',
              {style: 'margin:0 0 12px;color:#555;'},
              'Each bar shows the inclusive gasUsed reported for one ' +
                'call frame, in transaction trace order. Gas magnitude ' +
                'alone does not assign gas-limit risk.',
            ),

            m(
              'div',
              {
                style:
                  'display:grid;' +
                  'grid-template-columns:repeat(2,minmax(180px,1fr));' +
                  'gap:8px;margin-bottom:14px;',
              },
              cards.map(([label, value]) =>
                m(
                  'div',
                  {
                    style:
                      'border:1px solid #ddd;border-radius:6px;' +
                      'padding:9px;background:#fafafa;',
                  },
                  [
                    m(
                      'div',
                      {style: 'font-size:11px;color:#666;'},
                      label,
                    ),
                    m(
                      'div',
                      {style: 'font-size:15px;font-weight:600;'},
                      value,
                    ),
                  ],
                ),
              ),
            ),

            m(
              'div',
              {
                style:
                  'display:grid;grid-template-columns:44px 240px 1fr 120px;' +
                  'gap:8px;padding:6px 4px;border-bottom:1px solid #ccc;' +
                  'font-size:11px;font-weight:600;color:#555;',
              },
              [
                m('div', 'Order'),
                m('div', 'Call frame'),
                m('div', 'Inclusive gasUsed'),
                m('div', {style: 'text-align:right;'}, 'Gas units'),
              ],
            ),

            m(
              'div',
              {style: 'max-height:520px;overflow-y:auto;'},
              gasRows.map((row, index) => {
                const category = row.visual_category ?? 'normal_call';
                const colour =
                  CATEGORY_COLOURS[category] ??
                  CATEGORY_COLOURS['normal_call'];
                const width = Math.max(
                  0.5,
                  (row.gas_used / maxGas) * 100,
                );

                return m(
                  'div',
                  {
                    style:
                      'display:grid;' +
                      'grid-template-columns:44px 240px 1fr 120px;' +
                      'gap:8px;align-items:center;padding:5px 4px;' +
                      'border-bottom:1px solid #eee;',
                  },
                  [
                    m('div', String(index + 1)),
                    m(
                      'div',
                      {
                        title: row.name ?? 'Unnamed call frame',
                        style:
                          'white-space:nowrap;overflow:hidden;' +
                          'text-overflow:ellipsis;',
                      },
                      row.name ?? 'Unnamed call frame',
                    ),
                    m(
                      'div',
                      {
                        style:
                          'height:16px;background:#f1f1f1;' +
                          'border-radius:2px;overflow:hidden;',
                      },
                      m('div', {
                        style:
                          `height:100%;width:${width}%;` +
                          `background:${colour};`,
                      }),
                    ),
                    m(
                      'div',
                      {
                        style:
                          'text-align:right;font-variant-numeric:tabular-nums;',
                      },
                      row.gas_used.toLocaleString(),
                    ),
                  ],
                );
              }),
            ),

            m(
              'p',
              {
                style:
                  'font-size:11px;color:#666;margin-top:12px;' +
                  'border-top:1px solid #ddd;padding-top:10px;',
              },
              'Figure note: Values are inclusive callTracer gasUsed ' +
                'measurements in gas units. Parent values include execution ' +
                'inside child frames, so the bars must not be added together. ' +
                'Red is used only for an explicit ' +
                'potential_gas_limit_risk label supported by controlled ' +
                'same-function measurements and source or bytecode bound ' +
                'inspection. No percentile threshold is used.',
            ),
          ],
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
        const gasRows = slices.filter((s) => s.gas_used > 0);

        if (gasRows.length === 0) {
          console.log('[SmartContract] No gas data found in trace');
          return;
        }

        const maxGas = Math.max(...gasRows.map((s) => s.gas_used));
        const riskCount = gasRows.filter(
          (s) => s.visual_category === 'potential_gas_limit_risk',
        ).length;

        console.log('[SmartContract] Evidence-based gas summary:');
        console.log(`  Call frames:             ${gasRows.length}`);
        console.log(`  Maximum inclusive gas:   ${maxGas}`);
        console.log(`  Risk-labelled frames:    ${riskCount}`);
        console.log('  Numerical threshold:     none');
        console.log(
          '  Classification rule: controlled measurements plus source/bytecode inspection',
        );
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

         WHERE
          gas_used_arg.int_value IS NOT NULL
          OR gas_used_arg.string_value IS NOT NULL
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