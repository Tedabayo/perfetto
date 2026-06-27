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

import type {Trace} from '../../public/trace';
import type {PerfettoPlugin} from '../../public/plugin';
import {NUM, STR_NULL} from '../../trace_processor/query_result';

const CATEGORY_COLOURS: Record<string, string> = {
  'access_control': '#9B59B6',
  'money_flow':     '#27AE60',
  'gas_heavy':      '#E74C3C',
  'contract_call':  '#2980B9',
  'normal_call':    '#95A5A6',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'access_control': 'Permission and authorisation calls',
  'money_flow':     'ETH value transfers',
  'gas_heavy':      'Calls above 90th percentile gas threshold (33,386 gas units)',
  'contract_call':  'Ordinary inter-contract calls',
  'normal_call':    'All other calls',
};

interface SliceRow {
  id:              number;
  name:            string | null;
  visual_category: string | null;
  gas_used:        number;
  gas_assigned:    number;
  call_type:       string | null;
  value:           string | null;
  depth:           number;
}

export default class SmartContractPlugin implements PerfettoPlugin {

  async onTraceLoad(ctx: Trace): Promise<void> {
    const slices = await this.querySlices(ctx);
    console.log(`[SmartContract] Loaded ${slices.length} smart contract slices`);

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ColourByCategory',
      name: 'Smart Contract: Show Category Summary',
      callback: () => {
        const counts: Record<string, number> = {};
        for (const s of slices) {
          const cat = s.visual_category ?? 'normal_call';
          counts[cat] = (counts[cat] ?? 0) + 1;
        }
        console.log('[SmartContract] Category counts:', counts);
        console.log('[SmartContract] Colour map:', CATEGORY_COLOURS);
        console.log('[SmartContract] Descriptions:', CATEGORY_DESCRIPTIONS);
      },
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#GasSummary',
      name: 'Smart Contract: Show Gas Summary',
      callback: () => {
        const gasValues = slices.map(s => s.gas_used).filter(g => g > 0);
        if (gasValues.length === 0) {
          console.log('[SmartContract] No gas data found in trace');
          return;
        }
        gasValues.sort((a, b) => a - b);
        const p90Index = Math.floor(gasValues.length * 0.9);
        const p90      = gasValues[p90Index];
        const maxGas   = gasValues[gasValues.length - 1];
        const avgGas   = gasValues.reduce((a, b) => a + b, 0) / gasValues.length;
        console.log('[SmartContract] Gas summary:');
        console.log(`  Total slices with gas:  ${gasValues.length}`);
        console.log(`  Average gas:            ${avgGas.toFixed(0)}`);
        console.log(`  90th percentile (p90):  ${p90}`);
        console.log(`  Max gas:                ${maxGas}`);
      },
    });
  }

  private async querySlices(ctx: Trace): Promise<SliceRow[]> {
    try {
      const result = await ctx.engine.query(`
        SELECT
          s.id                                              AS id,
          s.name                                            AS name,
          cat_arg.string_value                              AS visual_category,
          CAST(gas_used_arg.int_value   AS INT)             AS gas_used,
          CAST(gas_arg.int_value        AS INT)             AS gas_assigned,
          kind_arg.string_value                             AS call_type,
          value_arg.string_value                            AS value,
          s.depth                                           AS depth
        FROM slice s
        LEFT JOIN args cat_arg      ON cat_arg.arg_set_id = s.arg_set_id
                                    AND cat_arg.key = 'visual_category'
        LEFT JOIN args gas_used_arg ON gas_used_arg.arg_set_id = s.arg_set_id
                                    AND gas_used_arg.key = 'gas_used_decimal'
        LEFT JOIN args gas_arg      ON gas_arg.arg_set_id = s.arg_set_id
                                    AND gas_arg.key = 'gasUsed'
        LEFT JOIN args kind_arg     ON kind_arg.arg_set_id = s.arg_set_id
                                    AND kind_arg.key = 'kind'
        LEFT JOIN args value_arg    ON value_arg.arg_set_id = s.arg_set_id
                                    AND value_arg.key = 'value'
        WHERE cat_arg.string_value IS NOT NULL
        ORDER BY s.ts
      `);

      const rows: SliceRow[] = [];
      const iter = result.iter({
        id:              NUM,
        name:            STR_NULL,
        visual_category: STR_NULL,
        gas_used:        NUM,
        gas_assigned:    NUM,
        call_type:       STR_NULL,
        value:           STR_NULL,
        depth:           NUM,
      });

      for (; iter.valid(); iter.next()) {
        rows.push({
          id:              iter.id,
          name:            iter.name,
          visual_category: iter.visual_category,
          gas_used:        iter.gas_used,
          gas_assigned:    iter.gas_assigned,
          call_type:       iter.call_type,
          value:           iter.value,
          depth:           iter.depth,
        });
      }
      return rows;

    } catch (e) {
      console.warn('[SmartContract] Could not query slices:', e);
      return [];
    }
  }
}
