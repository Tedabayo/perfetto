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
import {TrackNode} from '../../public/workspace';
import {Button} from '../../widgets/button';
import {Checkbox} from '../../widgets/checkbox';
import {Select} from '../../widgets/select';
import {NUM, NUM_NULL, STR_NULL} from '../../trace_processor/query_result';
import {renderGasChart} from './gas_chart';
import {renderFamilyGrowthChart} from './family_growth_chart';
import {renderAdditionalGasAnalysis} from './gas_analysis';
import {renderMoneyFlow} from './money_flow';
import {renderRepeatedPatterns} from './repeated_patterns';


const CATEGORY_COLOURS: Record<string, string> = {
  'access_control': '#9B59B6',
  'money_flow': '#27AE60',
  'potential_gas_limit_risk': '#E74C3C',
  'contract_call': '#2980B9',
  'normal_call': '#95A5A6',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'access_control': 'Permission and authorisation calls',
  'money_flow': 'Calls with available value-flow evidence',
  'potential_gas_limit_risk':
    'Operation-family risk supported by controlled measurements and source inspection',
  'contract_call': 'Ordinary inter-contract calls',
  'normal_call': 'All other calls',
};

interface SliceRow {
  id: number;
  parent_id: number | null;
  track_id: number;
  name: string | null;
  record_type: string | null;
  visual_category: string | null;
  gas_used: number;
  gas_assigned: number;
  call_type: string | null;
  success: number | null;
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
    const allSlices = await this.querySlices(ctx);

    // Explicit asset-transfer records are kept out of execution analysis.
    // Records without record_type remain call frames for backward compatibility.
    const slices = allSlices.filter(
      (slice) => slice.record_type !== 'asset_transfer',
    );

    const moneyFlowRows = allSlices.filter(
      (slice) =>
        slice.record_type === 'asset_transfer' ||
        slice.has_transfer_metadata > 0 ||
        slice.has_native_value > 0,
    );

    console.log(
      `[SmartContract] Loaded ${slices.length} call frames and ` +
        `${allSlices.length - slices.length} asset-transfer records`,
    );

    let callFilterText = '';
    let failedCallsOnly = false;
    let transferCallsOnly = false;
    let selectedDepth: number | null = null;
    let focusedCallPathId: number | null = null;

    if (slices.length > 0) {
      this.organizeFunctionCounterTracks(ctx);

      ctx.onTraceReady.addListener(() => {
        this.organizeExecutionTracks(ctx, slices);
      });
    }

    // ── Call Filter panel ─────────────────────────────────────────────────────
    ctx.sidePanel.registerTab({
      uri: 'dev.perfetto.SmartContract#CallFilter',
      title: 'Smart Contract Call Filter',
      icon: 'filter_alt',
      render: () => {
        const query = callFilterText.trim().toLowerCase();

        const slicesById = new Map(
          slices.map((slice) => [slice.id, slice]),
        );

        const focusedPathIds = new Set<number>();

        if (focusedCallPathId !== null) {
          let current = slicesById.get(focusedCallPathId);

          while (current !== undefined) {
            focusedPathIds.add(current.id);

            if (current.parent_id === null) {
              break;
            }

            current = slicesById.get(current.parent_id);
          }
        }

        const availableDepths = Array.from(
          new Set(slices.map((slice) => slice.depth)),
        ).sort((a, b) => a - b);

        const hasActiveFilter =
          query !== '' ||
          failedCallsOnly ||
          transferCallsOnly ||
          selectedDepth !== null ||
          focusedCallPathId !== null;

        const matches =
          !hasActiveFilter
            ? []
            : slices.filter((slice) => {
                const textMatches =
                  query === '' ||
                  [
                    slice.name,
                    slice.call_type,
                    slice.from_address,
                    slice.to_address,
                  ].some((value) =>
                    value?.toLowerCase().includes(query),
                  );

                const failureMatches =
                  !failedCallsOnly || slice.success === 0;

                const transferMatches =
                  !transferCallsOnly ||
                  slice.has_transfer_metadata > 0 ||
                  slice.has_native_value > 0;

                const depthMatches =
                  selectedDepth === null ||
                  slice.depth === selectedDepth;

                const pathMatches =
                  focusedCallPathId === null ||
                  focusedPathIds.has(slice.id);

                return (
                  textMatches &&
                  failureMatches &&
                  transferMatches &&
                  depthMatches &&
                  pathMatches
                );
              });

        return m(
          'div',
          {style: 'padding:16px;font-size:13px;'},
          [
            m(
              'h2',
              {style: 'margin:0 0 10px;font-size:16px;'},
              'Call Filter',
            ),

            m('input', {
              type: 'text',
              placeholder:
                'Search function, call type, from, or to address',
              value: callFilterText,
              oninput: (event: InputEvent) => {
                callFilterText =
                  (event.target as HTMLInputElement).value;
              },
              style:
                'width:100%;box-sizing:border-box;' +
                'padding:8px 10px;margin-bottom:10px;' +
                'border:1px solid #bbb;border-radius:5px;',
            }),

            m(
              'div',
              {
                style:
                  'display:flex;gap:16px;flex-wrap:wrap;' +
                  'margin-bottom:10px;',
              },
              [
                m(Checkbox, {
                  label: 'Failed calls only',
                  checked: failedCallsOnly,
                  onchange: () => {
                    failedCallsOnly = !failedCallsOnly;
                  },
                }),
                m(Checkbox, {
                  label: 'Asset/value calls only',
                  checked: transferCallsOnly,
                  onchange: () => {
                    transferCallsOnly = !transferCallsOnly;
                  },
                }),
              ],
            ),

            m(
              'div',
              {
                style:
                  'display:flex;align-items:center;gap:8px;' +
                  'margin-bottom:10px;',
              },
              [
                m('span', 'Depth'),
                m(
                  Select,
                  {
                    value:
                      selectedDepth === null
                        ? ''
                        : String(selectedDepth),
                    oninput: (event: Event) => {
                      const value =
                        (event.target as HTMLSelectElement).value;
                      selectedDepth =
                        value === '' ? null : Number(value);
                    },
                  },
                  [
                    m('option', {value: ''}, 'All depths'),
                    ...availableDepths.map((depth) =>
                      m(
                        'option',
                        {value: String(depth)},
                        `Depth ${depth}`,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            focusedCallPathId !== null
              ? m(
                  'div',
                  {style: 'margin-bottom:10px;'},
                  m(Button, {
                    label: 'Clear focused path',
                    onclick: () => {
                      focusedCallPathId = null;
                    },
                  }),
                )
              : null,

            !hasActiveFilter
              ? m(
                  'div',
                  {style: 'color:#666;'},
                  `Search across ${slices.length} smart-contract calls.`,
                )
              : m(
                  'div',
                  {style: 'margin-bottom:8px;color:#555;'},
                  `${matches.length} matching call${
                    matches.length === 1 ? '' : 's'
                  }`,
                ),

            hasActiveFilter
              ? m(
                  'div',
                  {style: 'max-height:560px;overflow-y:auto;'},
                  matches.map((row) =>
                    m(
                      'div',
                      {
                        onclick: () => {
                          ctx.selection.selectSqlEvent(
                            'slice',
                            row.id,
                            {scrollToSelection: true},
                          );
                        },
                        style:
                          'padding:8px 6px;' +
                          'border-bottom:1px solid #eee;' +
                          'cursor:pointer;',
                      },
                      [
                        m(
                          'div',
                          {style: 'font-weight:600;'},
                          row.name ?? 'Unnamed call',
                        ),
                        m(
                          'div',
                          {style: 'font-size:11px;color:#666;'},
                          [
                            row.call_type ?? 'Call type unavailable',
                            ` · depth ${row.depth}`,
                            row.to_address
                              ? ` · to ${row.to_address}`
                              : '',
                          ],
                        ),
                        m(
                          'div',
                          {style: 'margin-top:6px;'},
                          m(Button, {
                            label: 'Focus path',
                            onclick: (event: Event) => {
                              event.stopPropagation();
                              callFilterText = '';
                              failedCallsOnly = false;
                              transferCallsOnly = false;
                              selectedDepth = null;
                              focusedCallPathId = row.id;
                            },
                          }),
                        ),
                      ],
                    ),
                  ),
                )
              : null,
          ],
        );
      },
    });

    ctx.commands.registerCommand({
      id: 'dev.perfetto.SmartContract#ShowCallFilterPanel',
      name: 'Smart Contract: Show Call Filter Panel',
      callback: () =>
        ctx.sidePanel.showTab(
          'dev.perfetto.SmartContract#CallFilter',
        ),
    });

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
            renderGasChart(gasRows, (sliceId) => {
              ctx.selection.selectSqlEvent('slice', sliceId, {
                scrollToSelection: true,
              });
            }),

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
                    onclick: () => {
                      ctx.selection.selectSqlEvent('slice', row.id, {
                        scrollToSelection: true,
                      });
                    },
                    style:
                      'display:grid;' +
                      'grid-template-columns:44px 240px 1fr 120px;' +
                      'gap:8px;align-items:center;padding:5px 4px;' +
                      'border-bottom:1px solid #eee;' +
                      'cursor:pointer;',
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
      render: () =>
        renderMoneyFlow(moneyFlowRows, (sliceId) => {
          ctx.selection.selectSqlEvent('slice', sliceId, {
            scrollToSelection: true,
          });
        }),
    });

    // ── Repeated Execution Patterns panel ────────────────────────────────────
    ctx.sidePanel.registerTab({
      uri: 'dev.perfetto.SmartContract#RepeatedPatterns',
      title: 'Repeated Execution Patterns',
      icon: 'repeat',
      render: () =>
        renderRepeatedPatterns(slices, (sliceId) => {
          ctx.selection.selectSqlEvent('slice', sliceId, {
            scrollToSelection: true,
          });
        }),
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
      id: 'dev.perfetto.SmartContract#ShowRepeatedPatternsPanel',
      name: 'Smart Contract: Show Repeated Execution Patterns Panel',
      callback: () =>
        ctx.sidePanel.showTab(
          'dev.perfetto.SmartContract#RepeatedPatterns',
        ),
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

  private organizeExecutionTracks(
    ctx: Trace,
    slices: SliceRow[],
  ): void {
    const countsByTrackId = new Map<number, number>();

    for (const slice of slices) {
      countsByTrackId.set(
        slice.track_id,
        (countsByTrackId.get(slice.track_id) ?? 0) + 1,
      );
    }

    const tracksByParent = new Map<
      TrackNode,
      Array<{track: TrackNode; callCount: number}>
    >();

    for (const [trackId, callCount] of countsByTrackId) {
      const candidateUris = [
        `/slice_${trackId}`,
        `/track_event_${trackId}`,
      ];

      const track = candidateUris
        .map((uri) => ctx.defaultWorkspace.getTrackByUri(uri))
        .find((candidate) => candidate !== undefined);

      if (!track?.parent) continue;

      const parent = track.parent;
      const existing = tracksByParent.get(parent) ?? [];
      existing.push({track, callCount});
      tracksByParent.set(parent, existing);
    }

    for (const [parent, entries] of tracksByParent) {
      if (entries.length === 0) continue;

      const callCount = entries.reduce(
        (total, entry) => total + entry.callCount,
        0,
      );

      const relevantSlices = slices.filter((slice) =>
        entries.some((entry) =>
          entry.track.uri === `/slice_${slice.track_id}` ||
          entry.track.uri === `/track_event_${slice.track_id}`,
        ),
      );

      const maxDepth = relevantSlices.reduce(
        (max, slice) => Math.max(max, slice.depth),
        0,
      );

      const targetCount = new Set(
        relevantSlices
          .map((slice) => slice.to_address)
          .filter((address): address is string => Boolean(address)),
      ).size;

      const slicesWithSuccess = relevantSlices.filter(
        (slice) => slice.success !== null,
      );

      const failedCalls = slicesWithSuccess.filter(
        (slice) => slice.success === 0,
      ).length;

      const nativeValueCalls = relevantSlices.filter(
        (slice) => slice.has_native_value > 0,
      ).length;

      const transferMetadataCalls = relevantSlices.filter(
        (slice) => slice.has_transfer_metadata > 0,
      ).length;

      const overviewParts = [
        `${callCount} call${callCount === 1 ? '' : 's'}`,
        `depth ${maxDepth}`,
        targetCount > 0 ? `${targetCount} targets` : null,
        slicesWithSuccess.length > 0
          ? `${failedCalls} failed`
          : null,
        nativeValueCalls > 0
          ? `${nativeValueCalls} native-value calls`
          : null,
        transferMetadataCalls > 0
          ? `${transferMetadataCalls} transfer-metadata calls`
          : null,
      ].filter((part): part is string => part !== null);

      const group = new TrackNode({
        name: 'Smart Contract Execution',
        subtitle: overviewParts.join(' · '),
        isSummary: true,
        collapsed: false,
      });

      const firstTrack = entries[0].track;
      parent.addChildBefore(group, firstTrack);

      for (const {track} of entries) {
        group.addChildLast(track);
      }
    }
  }

  private organizeFunctionCounterTracks(ctx: Trace): void {
    const counterTracks = [...ctx.defaultWorkspace.flatTracks].filter(
      (track) =>
        track.parent !== undefined &&
        track.name.endsWith(' count'),
    );

    const tracksByParent = new Map<TrackNode, TrackNode[]>();

    for (const track of counterTracks) {
      const parent = track.parent;
      if (!parent) continue;

      const existing = tracksByParent.get(parent) ?? [];
      existing.push(track);
      tracksByParent.set(parent, existing);
    }

    for (const [parent, tracks] of tracksByParent) {
      if (tracks.length === 0) continue;

      const group = new TrackNode({
        name: 'Function Statistics',
        subtitle: `${tracks.length} function counter tracks`,
        isSummary: true,
        collapsed: true,
      });

      parent.addChildLast(group);

      for (const track of tracks) {
        group.addChildLast(track);
      }
    }
  }

private async querySlices(ctx: Trace): Promise<SliceRow[]> {
  try {
    const result = await ctx.engine.query(`
      SELECT
        s.id AS id,
        s.parent_id AS parent_id,
        s.track_id AS track_id,
        s.name AS name,
        record_type_arg.string_value AS record_type,
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

        CASE
          WHEN UPPER(call_type_arg.string_value) IN (
            'CALL', 'STATICCALL', 'DELEGATECALL',
            'CALLCODE', 'CREATE', 'CREATE2'
          )
            THEN UPPER(call_type_arg.string_value)
          WHEN UPPER(type_arg.string_value) IN (
            'CALL', 'STATICCALL', 'DELEGATECALL',
            'CALLCODE', 'CREATE', 'CREATE2'
          )
            THEN UPPER(type_arg.string_value)
          WHEN UPPER(kind_arg.string_value) IN (
            'CALL', 'STATICCALL', 'DELEGATECALL',
            'CALLCODE', 'CREATE', 'CREATE2'
          )
            THEN UPPER(kind_arg.string_value)
          ELSE NULL
        END AS call_type,

        CASE
          WHEN success_arg.int_value IS NOT NULL
            THEN CAST(success_arg.int_value AS INT)
          WHEN LOWER(success_arg.string_value) IN ('true', '1')
            THEN 1
          WHEN LOWER(success_arg.string_value) IN ('false', '0')
            THEN 0
          ELSE NULL
        END AS success,

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

      LEFT JOIN args record_type_arg
        ON record_type_arg.arg_set_id = s.arg_set_id
       AND record_type_arg.key = 'args.record_type'

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

      LEFT JOIN args call_type_arg
        ON call_type_arg.arg_set_id = s.arg_set_id
       AND call_type_arg.key = 'args.call_type'

      LEFT JOIN args type_arg
        ON type_arg.arg_set_id = s.arg_set_id
       AND type_arg.key = 'args.type'

      LEFT JOIN args kind_arg
        ON kind_arg.arg_set_id = s.arg_set_id
       AND kind_arg.key = 'args.kind'

      LEFT JOIN args success_arg
        ON success_arg.arg_set_id = s.arg_set_id
       AND success_arg.key = 'args.success'

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
        record_type_arg.string_value IS NOT NULL
        OR cat_arg.string_value IS NOT NULL
        OR kind_arg.string_value IS NOT NULL
        OR call_index_arg.int_value IS NOT NULL
        OR call_index_arg.string_value IS NOT NULL
        OR from_arg.string_value IS NOT NULL
        OR to_arg.string_value IS NOT NULL
        OR gas_used_arg.int_value IS NOT NULL
        OR gas_used_arg.string_value IS NOT NULL

      ORDER BY s.ts
    `);

    const rows: SliceRow[] = [];

    const iter = result.iter({
      id: NUM,
      parent_id: NUM_NULL,
      track_id: NUM,
      name: STR_NULL,
      record_type: STR_NULL,
      visual_category: STR_NULL,
      gas_used: NUM,
      gas_assigned: NUM,
      call_type: STR_NULL,
      success: NUM_NULL,
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
        parent_id: iter.parent_id,
        track_id: iter.track_id,
        name: iter.name,
        record_type: iter.record_type,
        visual_category: iter.visual_category,
        gas_used: iter.gas_used,
        gas_assigned: iter.gas_assigned,
        call_type: iter.call_type,
        success: iter.success,
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
