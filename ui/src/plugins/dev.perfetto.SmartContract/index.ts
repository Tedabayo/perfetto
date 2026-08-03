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
import {renderGasChart} from './gas_chart';
import {renderFamilyGrowthChart} from './family_growth_chart';
import {renderAdditionalGasAnalysis} from './gas_analysis';
import {renderMoneyFlow} from './money_flow';


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
  call_index: number;
  from_address: string | null;
  to_address: string | null;
  token_symbol: string | null;
  token_contract: string | null;
  transfer_amount: string | null;
  value_eth: string | null;
  has_transfer_metadata: number;
  has_native_value: number;
  family_tested_sizes_csv: string | null;
  family_receipt_gas_csv: string | null;
  matched_family: string | null;
  matched_function: string | null;
  controlling_parameter: string | null;
  controlling_input_value: number;
  classification_decision: string | null;
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

        const familyRow = slices.find(
          (s) =>
            s.family_tested_sizes_csv !== null &&
            s.family_receipt_gas_csv !== null,
        );

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

        const decision = familyRow?.classification_decision;

        const gasHeavyClassification =
          decision ===
            'gas_heavy_relative_to_controlled_family_envelope' ||
          decision === 'confirmed_out_of_gas'
            ? 'YES'
            : decision === 'within_controlled_family_envelope' ||
                decision ===
                  'constant_cost_within_calibrated_range' ||
                decision === 'bounded_input_dependent_growth' ||
                decision === 'bounded_input_rejection'
              ? 'NO'
              : decision
                ? 'REVIEW'
                : 'NOT AVAILABLE';

        const cards = [
          ['Call frames with gas data', gasRows.length.toLocaleString()],
          ['Maximum inclusive frame gas', `${maxGas.toLocaleString()} gas`],
          ['Gas-heavy classification', gasHeavyClassification],
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
            renderGasChart(gasRows),

            familyRow
              ? renderFamilyGrowthChart({
                  familyId: familyRow.matched_family,
                  functionName: familyRow.matched_function,
                  controllingParameter:
                    familyRow.controlling_parameter,
                  testedSizesCsv:
                    familyRow.family_tested_sizes_csv,
                  receiptGasCsv:
                    familyRow.family_receipt_gas_csv,
                  observedInput:
                    familyRow.controlling_input_value,
                  observedGas: familyRow.gas_used,
                  decision:
                    familyRow.classification_decision,
                })
              : null,

            renderAdditionalGasAnalysis(gasRows),

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

    // ── Money Flow panel ─────────────────────────────────────────────────────
    ctx.sidePanel.registerTab({
      uri: 'dev.perfetto.SmartContract#MoneyFlow',
      title: 'Smart Contract Money Flow',
      icon: 'account_tree',
      render: () => renderMoneyFlow(slices),
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ShowGasGraphPanel',
      name: 'Smart Contract: Show Gas Graph Panel',
      callback: () => ctx.sidePanel.showTab('dev.perfetto.SmartContract#GasGraph'),
    });


    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ShowMoneyFlowPanel',
      name: 'Smart Contract: Show Money Flow Panel',
      callback: () =>
        ctx.sidePanel.showTab('dev.perfetto.SmartContract#MoneyFlow'),
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
        s.depth AS depth,

        COALESCE(
          CAST(call_index_arg.int_value AS INT),
          CAST(call_index_arg.string_value AS INT),
          0
        ) AS call_index,

        from_arg.string_value AS from_address,
        to_arg.string_value AS to_address,
        token_symbol_arg.string_value AS token_symbol,
        token_contract_arg.string_value AS token_contract,

        COALESCE(
          transfer_amount_arg.string_value,
          CAST(transfer_amount_arg.real_value AS TEXT),
          CAST(transfer_amount_arg.int_value AS TEXT)
        ) AS transfer_amount,

        COALESCE(
          value_eth_arg.string_value,
          CAST(value_eth_arg.real_value AS TEXT),
          CAST(value_eth_arg.int_value AS TEXT)
        ) AS value_eth,

        COALESCE(
          CAST(has_transfer_arg.int_value AS INT),
          CAST(has_transfer_arg.string_value AS INT),
          0
        ) AS has_transfer_metadata,

        COALESCE(
          CAST(has_native_arg.int_value AS INT),
          CAST(has_native_arg.string_value AS INT),
          0
        ) AS has_native_value,

        family_sizes_arg.string_value
          AS family_tested_sizes_csv,

        family_gas_arg.string_value
          AS family_receipt_gas_csv,

        matched_family_arg.string_value
          AS matched_family,

        matched_function_arg.string_value
          AS matched_function,

        controlling_parameter_arg.string_value
          AS controlling_parameter,

        COALESCE(
          CAST(controlling_input_arg.int_value AS INT),
          CAST(controlling_input_arg.string_value AS INT),
          0
        ) AS controlling_input_value,

        classification_decision_arg.string_value
          AS classification_decision

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

      LEFT JOIN args call_index_arg
        ON call_index_arg.arg_set_id = s.arg_set_id
       AND call_index_arg.key = 'args.call_index'

      LEFT JOIN args from_arg
        ON from_arg.arg_set_id = s.arg_set_id
       AND from_arg.key = 'args.from'

      LEFT JOIN args to_arg
        ON to_arg.arg_set_id = s.arg_set_id
       AND to_arg.key = 'args.to'

      LEFT JOIN args token_symbol_arg
        ON token_symbol_arg.arg_set_id = s.arg_set_id
       AND token_symbol_arg.key = 'args.token_symbol'

      LEFT JOIN args token_contract_arg
        ON token_contract_arg.arg_set_id = s.arg_set_id
       AND token_contract_arg.key = 'args.token_contract'

      LEFT JOIN args transfer_amount_arg
        ON transfer_amount_arg.arg_set_id = s.arg_set_id
       AND transfer_amount_arg.key =
         'args.transfer_amount_normalized'

      LEFT JOIN args value_eth_arg
        ON value_eth_arg.arg_set_id = s.arg_set_id
       AND value_eth_arg.key = 'args.value_eth'

      LEFT JOIN args has_transfer_arg
        ON has_transfer_arg.arg_set_id = s.arg_set_id
       AND has_transfer_arg.key = 'args.has_transfer_metadata'

      LEFT JOIN args has_native_arg
        ON has_native_arg.arg_set_id = s.arg_set_id
       AND has_native_arg.key = 'args.has_native_value'

      LEFT JOIN args family_sizes_arg
        ON family_sizes_arg.arg_set_id = s.arg_set_id
       AND family_sizes_arg.key =
         'args.familyTestedSizesCsv'

      LEFT JOIN args family_gas_arg
        ON family_gas_arg.arg_set_id = s.arg_set_id
       AND family_gas_arg.key =
         'args.familyReceiptGasCsv'

      LEFT JOIN args matched_family_arg
        ON matched_family_arg.arg_set_id = s.arg_set_id
       AND matched_family_arg.key = 'args.matchedFamily'

      LEFT JOIN args matched_function_arg
        ON matched_function_arg.arg_set_id = s.arg_set_id
       AND matched_function_arg.key = 'args.matchedFunction'

      LEFT JOIN args controlling_parameter_arg
        ON controlling_parameter_arg.arg_set_id = s.arg_set_id
       AND controlling_parameter_arg.key =
         'args.controllingParameter'

      LEFT JOIN args controlling_input_arg
        ON controlling_input_arg.arg_set_id = s.arg_set_id
       AND controlling_input_arg.key =
         'args.controllingInputValue'

      LEFT JOIN args classification_decision_arg
        ON classification_decision_arg.arg_set_id = s.arg_set_id
       AND classification_decision_arg.key =
         'args.classificationDecision'

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
      call_index: NUM,
      from_address: STR_NULL,
      to_address: STR_NULL,
      token_symbol: STR_NULL,
      token_contract: STR_NULL,
      transfer_amount: STR_NULL,
      value_eth: STR_NULL,
      has_transfer_metadata: NUM,
      has_native_value: NUM,
      family_tested_sizes_csv: STR_NULL,
      family_receipt_gas_csv: STR_NULL,
      matched_family: STR_NULL,
      matched_function: STR_NULL,
      controlling_parameter: STR_NULL,
      controlling_input_value: NUM,
      classification_decision: STR_NULL,
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
        call_index: iter.call_index,
        from_address: iter.from_address,
        to_address: iter.to_address,
        token_symbol: iter.token_symbol,
        token_contract: iter.token_contract,
        transfer_amount: iter.transfer_amount,
        value_eth: iter.value_eth,
        has_transfer_metadata: iter.has_transfer_metadata,
        has_native_value: iter.has_native_value,
        family_tested_sizes_csv:
          iter.family_tested_sizes_csv,
        family_receipt_gas_csv:
          iter.family_receipt_gas_csv,
        matched_family: iter.matched_family,
        matched_function: iter.matched_function,
        controlling_parameter:
          iter.controlling_parameter,
        controlling_input_value:
          iter.controlling_input_value,
        classification_decision:
          iter.classification_decision,
      });
    }

    return rows;
  } catch (e) {
    console.warn('[SmartContract] Could not query slices:', e);
    return [];
  }
}
}
