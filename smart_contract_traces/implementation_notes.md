# Implementation Notes: Smart Contract Trace Visualization in Perfetto

## 1. Purpose

This document records the implementation changes made to support smart-contract-specific execution trace visualization in Perfetto.

The goal of the modification is to transform an Ethereum execution trace into a Perfetto-compatible TraceEvents file and extend the Perfetto UI so that smart contract behaviour can be inspected visually.

The implementation focuses on the following trace features:

```text
call hierarchy
call depth
call type
gas usage
gas-heavy classification
money-flow calls
semantic visual categories
tooltip-based inspection
Perfetto side-panel visualization
```

This document is intended as implementation evidence for the thesis workflow. Screenshots should be added separately after final visual verification.

---

## 2. Converter Extension

### File changed

```text
smart_contract_traces/convert_trace.py
```

### Input file

```text
smart_contract_traces/accessControl_converted.json
```

### Output file

```text
smart_contract_traces/accessControl_converted_v2.json
```

### Purpose

The converter was extended so that the converted Perfetto TraceEvents file contains smart-contract-specific metadata as event arguments.

The original converted trace was not sufficient for the modified Perfetto UI because several values required by the tooltip, category summary, and gas graph were either missing or not exposed in a consistent way.

The updated converter enriches each smart contract call with semantic and execution-related fields before the trace is loaded into Perfetto.

### Fields required for the modified Perfetto UI

The converted trace must include the following fields:

```text
visual_category
gas_used_decimal
gas_heavy_threshold_90th
is_gas_heavy
kind
gas_assigned_decimal
gas_usage_ratio
value_decimal
depth
```

The trace also includes money-flow-related fields where available:

```text
is_money_flow
amount_decimal
```

### Reason for the change

Perfetto was originally designed for system-performance traces, not Ethereum execution traces. Ethereum traces require additional information such as gas usage, contract-call type, value transfer, semantic category, and call depth.

Without these fields, the UI can only show a generic timeline. The converter therefore adds smart-contract-specific metadata so that the plugin can compute and display transaction-level summaries.

---

## 3. Gas-Heavy Classification

Gas-heavy calls are classified using the interpolated 90th percentile of gas used within the transaction.

For a transaction with gas-used values:

```text
g1, g2, ..., gn
```

the values are sorted and the percentile index is computed as:

```text
index = 0.9 × (n − 1)
```

The threshold is calculated by interpolation between the lower and upper neighbouring values.

A call is classified as gas-heavy when:

```text
gas_used >= P90 threshold
```

### Reason for using a percentile threshold

A fixed gas threshold would be arbitrary because different transactions can have very different gas distributions. A transaction-relative percentile threshold is more appropriate for visualization because it identifies calls that are heavy relative to the current transaction.

The implementation therefore avoids hardcoding a gas-heavy value such as 100,000 gas. Instead, the threshold is computed from the gas values in the loaded trace.

---

## 4. Perfetto Plugin Extension

### File changed

```text
ui/src/plugins/dev.perfetto.SmartContract/index.ts
```

### Purpose

The Perfetto plugin was extended with smart-contract-specific UI panels. These panels make the trace easier to interpret by grouping calls into semantic categories and visualising gas usage across the transaction.

### Implemented UI features

```text
Smart Contract Gas Graph panel
Smart Contract Legend panel
Summary cards
Category counts
Gas distribution chart
Interpolated P90 threshold line
Gas-heavy call count
Money-flow call count
Tooltip on gas bars
Call type display
Gas used display
Value display
Depth display
Log-scale Y-axis
```

### Reason for the change

Perfetto provides a powerful timeline interface, but its default UI does not directly explain Ethereum-specific concepts such as gas-heavy calls, value transfer, contract-call type, or semantic call categories.

The plugin adapts Perfetto so that these smart-contract-specific concepts are visible in the UI and can later be used as visual input for VLM-based trace understanding.

---

## 5. Runtime Computation of Values

The plugin does not hardcode the experiment results.

The key values are calculated at runtime from the loaded trace:

```ts
const gasRows = slices.filter((s) => s.gas_used > 0);
const gasValues = gasRows.map((s) => s.gas_used);

const p90 = calculateP90(gasValues);
const maxGas = Math.max(...gasValues, 1);
const gasHeavyCount = gasRows.filter((s) => s.gas_used >= p90).length;
const total = gasRows.length;
```

Category counts are also computed from the loaded trace:

```ts
for (const row of gasRows) {
  const cat = row.visual_category ?? 'normal_call';
  categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
}
```

This means that values such as total calls, P90 threshold, gas-heavy calls, money-flow calls, and max gas used are generated from the trace data, not manually inserted into the UI.

---

## 6. Log-Scale Gas Visualization

The gas graph uses a logarithmic Y-axis:

```text
log10(gas used + 1)
```

This transformation is used only for visual scaling.

The underlying gas values are not changed. The P90 threshold, gas-heavy count, category counts, and tooltip values are still computed from the original gas-used values in the trace.

### Reason for using log scale

The access-control trace contains one very large gas-consuming call. On a linear Y-axis, this outlier compresses smaller calls near the bottom of the chart, making other categories difficult to see.

The log-scale visualization improves readability while preserving the real gas values.

The figure caption explicitly states that the Y-axis uses:

```text
log10(gas used + 1)
```

This makes the visualization transparent and avoids misleading interpretation.

---

## 7. Current Verified Trace Output

The current converted trace is:

```text
smart_contract_traces/accessControl_converted_v2.json
```

The converter produced the following values:

```text
Total calls: 259
P90 threshold: 33,386 gas units
Gas-heavy calls: 26
Money-flow calls: 19
Max gas used: 2,070,396
```

The category counts are:

```text
access_control: 22
contract_call: 192
gas_heavy: 26
money_flow: 19
normal_call: 0
```

These values are generated from the converted trace. They are not hardcoded into the plugin.

---

## 8. Tooltip and Event Detail Behaviour

The plugin tooltip displays the following information when available:

```text
Function name
Visual category
Call type
Gas used
Gas assigned
Gas usage ratio
Value
Depth
```

For the current access-control trace, some fields may appear as:

```text
not available
```

This applies especially to:

```text
Gas assigned
Gas usage ratio
```

This is a data limitation of the loaded trace rather than a UI failure. The plugin reports these values as unavailable when the trace does not provide usable non-zero gas-assigned values.

The plugin should not invent gas-assigned or gas-usage-ratio values.

---

## 9. Visual Categories

The modified UI uses the following semantic categories:

```text
access_control
money_flow
gas_heavy
contract_call
normal_call
```

These categories are used in:

```text
the timeline colour grouping
the legend panel
the gas graph bars
the category count summary
the tooltip
```

### Category meanings

```text
access_control: permission and authorisation-related calls
money_flow: calls involving value or token-flow information
gas_heavy: calls at or above the transaction-level P90 gas threshold
contract_call: ordinary inter-contract calls
normal_call: fallback category for calls that do not match another category
```

---

## 10. Reproducibility

The converter was run with:

```bash
python3 convert_trace.py accessControl_converted.json accessControl_converted_v2.json
```

The Perfetto UI was built and served using:

```bash
ui/run-dev-server
```

The implementation compiled successfully with:

```text
Found 0 errors
```

The implementation was committed to Git with:

```text
Commit: f18c662d2b
Message: Add smart contract gas graph and converted trace data
```

---

## 11. Files Included in the Implementation Commit

The implementation commit includes:

```text
smart_contract_traces/convert_trace.py
smart_contract_traces/accessControl_converted.json
smart_contract_traces/accessControl_converted_v2.json
ui/src/plugins/dev.perfetto.SmartContract/index.ts
```

The committed implementation adds the enriched converter output and the updated smart-contract-specific Perfetto plugin.

---

## 12. Verification Status

The following features have been implemented and visually checked in Perfetto:

```text
Smart Contract Gas Graph panel
Summary cards
P90 threshold display
Gas-heavy call count
Money-flow call count
Max gas used
Category counts
Log-scale gas distribution chart
P90 dashed threshold line
Y-axis label showing log scale
Caption explaining log10(gas used + 1)
```

The following features still require screenshot evidence:

```text
Modified Perfetto with access-control trace
Modified Perfetto with Gas Graph panel
Modified Perfetto with Legend panel
Event details panel after clicking a call
Tooltip on gas graph hover
Before/after comparison
```

Only features with screenshot evidence should be marked as fully verified in the final thesis report.

---

## 13. Pending Screenshot Evidence

The following screenshots should be captured later with clear filenames:

```text
screenshot_01_unmodified_perfetto_access_control_trace.png
screenshot_02_modified_perfetto_access_control_trace.png
screenshot_03_modified_perfetto_gas_graph_log_scale.png
screenshot_04_modified_perfetto_legend_panel.png
screenshot_05_event_details_clicked_call.png
screenshot_06_gas_graph_tooltip_hover.png
screenshot_07_before_after_comparison.png
```

These screenshots will provide visual evidence for the implementation and should be referenced in the thesis report.

---

## 14. Thesis-Ready Summary

This implementation extends Perfetto to support smart-contract-specific execution trace visualization. The converter enriches Ethereum trace data with semantic and execution-related metadata, including visual category, gas usage, gas-heavy classification, call type, value information, and call depth.

The Perfetto plugin uses these fields to display a Smart Contract Gas Graph panel, a legend panel, transaction-level summary cards, category counts, tooltip details, and a log-scale gas distribution chart. Gas-heavy calls are classified using the interpolated 90th percentile of gas used within the transaction, avoiding arbitrary fixed thresholds.

The log-scale chart improves readability for skewed gas distributions while preserving the real underlying gas values. All displayed summary values are computed from the loaded converted trace rather than hardcoded into the UI.
