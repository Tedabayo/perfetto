import m from 'mithril';
import type {GasChartRow} from './gas_chart';

interface IndexedGasRow extends GasChartRow {
  readonly callIndex: number;
}

interface FunctionGasSummary {
  readonly name: string;
  readonly callCount: number;
  readonly totalGas: number;
  readonly averageGas: number;
}

function renderTopGasCalls(rows: readonly GasChartRow[]) {
  const topCalls: IndexedGasRow[] = rows
    .map((row, callIndex) => ({
      ...row,
      callIndex,
    }))
    .filter((row) => row.depth > 0 && row.gas_used > 0)
    .sort((left, right) => right.gas_used - left.gas_used)
    .slice(0, 10)
    .sort((left, right) => left.callIndex - right.callIndex);

  if (topCalls.length === 0) {
    return m('p', 'No internal calls with gas data were found.');
  }

  const chartWidth = 1000;
  const chartHeight = 470;
  const marginLeft = 88;
  const marginRight = 30;
  const marginTop = 78;
  const marginBottom = 105;

  const plotWidth = chartWidth - marginLeft - marginRight;
  const plotHeight = chartHeight - marginTop - marginBottom;
  const plotBottom = marginTop + plotHeight;

  const maximumGas = Math.max(
    ...topCalls.map((row) => row.gas_used),
  );

  const axisStep =
    10 ** Math.floor(Math.log10(maximumGas));

  const axisMaximum =
    Math.ceil(maximumGas / axisStep) * axisStep;

  const yTicks = Array.from(
    {
      length: Math.round(axisMaximum / axisStep) + 1,
    },
    (_, index) => index * axisStep,
  );

  const xPosition = (index: number) => {
    if (topCalls.length === 1) {
      return marginLeft + plotWidth / 2;
    }

    return (
      marginLeft +
      (index / (topCalls.length - 1)) * plotWidth
    );
  };

  const yPosition = (gas: number) =>
    marginTop +
    (1 - gas / axisMaximum) * plotHeight;

  const linePoints = topCalls
    .map(
      (row, index) =>
        `${xPosition(index)},${yPosition(row.gas_used)}`,
    )
    .join(' ');

  return m(
    'div',
    {
      style:
        'border:1px solid #ddd;border-radius:6px;' +
        'padding:12px;margin-bottom:14px;background:#fff;',
    },
    [
      m(
        'div',
        {
          style:
            'font-size:16px;font-weight:600;text-align:center;',
        },
        'Top 10 Gas-Consuming Internal Calls',
      ),
      m(
        'div',
        {
          style:
            'font-size:12px;color:#666;text-align:center;' +
            'margin:3px 0 8px;',
        },
        'The ten highest-gas calls, displayed in execution order',
      ),
      m(
        'svg',
        {
          viewBox: `0 0 ${chartWidth} ${chartHeight}`,
          role: 'img',
          'aria-label':
            'Line chart of the ten highest-gas internal calls',
          style:
            'display:block;width:100%;height:auto;background:#fff;',
        },
        [
          yTicks.map((tick) => {
            const y = yPosition(tick);

            return m('g', [
              m('line', {
                x1: marginLeft,
                y1: y,
                x2: chartWidth - marginRight,
                y2: y,
                stroke: '#dddddd',
                'stroke-width': 1,
              }),
              m(
                'text',
                {
                  x: marginLeft - 10,
                  y: y + 4,
                  'text-anchor': 'end',
                  fill: '#555555',
                  'font-size': 11,
                },
                tick.toLocaleString(),
              ),
            ]);
          }),

          m('polyline', {
            points: linePoints,
            fill: 'none',
            stroke: '#4285F4',
            'stroke-width': 3,
          }),

          topCalls.map((row, index) => {
            const x = xPosition(index);
            const y = yPosition(row.gas_used);

            return m('g', [
              m(
                'title',
                `Call ${row.callIndex}: ` +
                  `${row.name ?? 'Unnamed call'}\n` +
                  `Inclusive gas used: ` +
                  `${row.gas_used.toLocaleString()} gas\n` +
                  `Depth: ${row.depth}`,
              ),
              m('circle', {
                cx: x,
                cy: y,
                r: 5,
                fill: '#4285F4',
              }),
              m(
                'text',
                {
                  x,
                  y: y - 12,
                  'text-anchor': 'middle',
                  fill: '#333333',
                  'font-size': 11,
                  'font-weight': 600,
                },
                row.gas_used.toLocaleString(),
              ),
              m(
                'text',
                {
                  x,
                  y: plotBottom + 25,
                  transform:
                    `rotate(-28 ${x} ${plotBottom + 25})`,
                  'text-anchor': 'end',
                  fill: '#333333',
                  'font-size': 11,
                },
                `#${row.callIndex} ` +
                  `${row.name ?? 'Unnamed call'}`,
              ),
            ]);
          }),

          m('line', {
            x1: marginLeft,
            y1: marginTop,
            x2: marginLeft,
            y2: plotBottom,
            stroke: '#444444',
            'stroke-width': 1,
          }),

          m('line', {
            x1: marginLeft,
            y1: plotBottom,
            x2: chartWidth - marginRight,
            y2: plotBottom,
            stroke: '#444444',
            'stroke-width': 1,
          }),

          m(
            'text',
            {
              x: 19,
              y: marginTop + plotHeight / 2,
              transform:
                `rotate(-90 19 ${marginTop + plotHeight / 2})`,
              'text-anchor': 'middle',
              fill: '#333333',
              'font-size': 12,
            },
            'Inclusive gas used (gas units)',
          ),

          m(
            'text',
            {
              x: marginLeft + plotWidth / 2,
              y: chartHeight - 10,
              'text-anchor': 'middle',
              fill: '#333333',
              'font-size': 12,
            },
            'Selected internal call frame in execution order (unitless)',
          ),
        ],
      ),

      m(
        'div',
        {
          style:
            'font-size:11px;color:#666;margin-top:8px;' +
            'line-height:1.5;',
        },
        'Figure note. This chart selects the ten internal call frames ' +
          'with the highest inclusive gas consumption and displays them ' +
          'in their original execution order. The x-axis identifies each ' +
          'selected call frame, while the y-axis reports inclusive gas used ' +
          'in gas units. Calls outside the top ten are omitted. Because gas ' +
          'values are inclusive, gas consumed by nested child calls is already ' +
          'included in parent calls and must not be added again.',
      ),
    ],
  );
}

function summarizeFunctions(
  rows: readonly GasChartRow[],
): FunctionGasSummary[] {
  const groups = new Map<
    string,
    {
      totalGas: number;
      callCount: number;
    }
  >();

  for (const row of rows) {
    if (row.depth === 0 || row.gas_used <= 0) {
      continue;
    }

    const name = row.name ?? 'Unnamed call';
    const current = groups.get(name) ?? {
      totalGas: 0,
      callCount: 0,
    };

    current.totalGas += row.gas_used;
    current.callCount += 1;
    groups.set(name, current);
  }

  return Array.from(groups.entries())
    .map(([name, values]) => ({
      name,
      callCount: values.callCount,
      totalGas: values.totalGas,
      averageGas: Math.round(
        values.totalGas / values.callCount,
      ),
    }))
    .sort(
      (left, right) =>
        right.averageGas - left.averageGas,
    )
    .slice(0, 10);
}

function renderAverageGasByFunction(
  rows: readonly GasChartRow[],
) {
  const functions = summarizeFunctions(rows);

  if (functions.length === 0) {
    return m('p', 'No function-level gas data were found.');
  }

  const exampleFunction =
    functions.find((row) =>
      row.name.toLowerCase().includes('approve'),
    ) ?? functions[0];

  const calculationExample =
    `${exampleFunction.name}: ` +
    `${exampleFunction.totalGas.toLocaleString()} total gas ÷ ` +
    `${exampleFunction.callCount} calls ≈ ` +
    `${exampleFunction.averageGas.toLocaleString()} gas/call.`;

  const chartWidth = 1000;
  const chartHeight = 560;
  const marginLeft = 300;
  const marginRight = 125;
  const marginTop = 78;
  const marginBottom = 55;

  const plotWidth = chartWidth - marginLeft - marginRight;
  const plotHeight = chartHeight - marginTop - marginBottom;

  const maximumAverage = Math.max(
    ...functions.map((row) => row.averageGas),
  );

  const axisStep =
    10 ** Math.floor(Math.log10(maximumAverage));

  const axisMaximum =
    Math.ceil(maximumAverage / axisStep) * axisStep;

  const xTicks = Array.from(
    {
      length: Math.round(axisMaximum / axisStep) + 1,
    },
    (_, index) => index * axisStep,
  );

  const rowStep = plotHeight / functions.length;
  const barHeight = rowStep * 0.64;

  return m(
    'div',
    {
      style:
        'border:1px solid #ddd;border-radius:6px;' +
        'padding:12px;margin-bottom:14px;background:#fff;',
    },
    [
      m(
        'div',
        {
          style:
            'font-size:16px;font-weight:600;text-align:center;',
        },
        'Top 10 Functions by Average Gas per Call',
      ),

      m(
        'div',
        {
          style:
            'font-size:12px;color:#666;text-align:center;' +
            'margin:3px 0 8px;',
        },
        'Arithmetic mean of inclusive gas used by calls sharing the same function name',
  
      ),

      m(
        'svg',
        {
          viewBox: `0 0 ${chartWidth} ${chartHeight}`,
          role: 'img',
          'aria-label':
            'Horizontal bars showing average gas by function',
          style:
            'display:block;width:100%;height:auto;background:#fff;',
        },
        [
          xTicks.map((tick) => {
            const x =
              marginLeft +
              (tick / axisMaximum) * plotWidth;

            return m('g', [
              m('line', {
                x1: x,
                y1: marginTop,
                x2: x,
                y2: marginTop + plotHeight,
                stroke: '#dddddd',
                'stroke-width': 1,
              }),

              m(
                'text',
                {
                  x,
                  y: marginTop + plotHeight + 22,
                  'text-anchor': 'middle',
                  fill: '#555555',
                  'font-size': 11,
                },
                tick.toLocaleString(),
              ),
            ]);
          }),

          functions.map((row, index) => {
            const y =
              marginTop +
              index * rowStep +
              (rowStep - barHeight) / 2;

            const width =
              (row.averageGas / axisMaximum) * plotWidth;

            return m('g', [
              m(
                'title',
                `${row.name}\n` +
                  `${row.callCount} calls\n` +
                  `Average inclusive gas used: ` +
                  `${row.averageGas.toLocaleString()} gas per call`,
              ),

              m(
                'text',
                {
                  x: marginLeft - 12,
                  y: y + barHeight / 2 + 4,
                  'text-anchor': 'end',
                  fill: '#333333',
                  'font-size': 12,
                },
                `${row.name} (${row.callCount} calls)`,
              ),

              m('rect', {
                x: marginLeft,
                y,
                width,
                height: barHeight,
                fill: '#4285F4',
              }),

              m(
                'text',
                {
                  x: marginLeft + width + 10,
                  y: y + barHeight / 2 + 4,
                  fill: '#333333',
                  'font-size': 11,
                  'font-weight': 600,
                },
                `${row.averageGas.toLocaleString()} gas`,
              ),
            ]);
          }),

          m(
            'text',
            {
              x: marginLeft + plotWidth / 2,
              y: chartHeight - 8,
              'text-anchor': 'middle',
              fill: '#333333',
              'font-size': 12,
            },
            'Mean inclusive gas used per invocation (gas units/call)',
          ),
        ],
      ),
      m(
        'div',
        {
          style:
            'font-size:11px;color:#666;margin-top:8px;' +
            'line-height:1.5;',
        },
        'Figure note. Internal call frames with the same displayed ' +
          'function name are grouped together. The arithmetic mean is ' +
          'calculated as total inclusive gas used by the function group ' +
          'divided by its number of calls. Example from this trace: ' +
          calculationExample +
          ' The chart displays the ten function groups with the highest ' +
          'mean gas consumption. Values are measured in gas units per call.',
      ),
    ],
  );
}
        

export function renderAdditionalGasAnalysis(
  rows: readonly GasChartRow[],
) {
  return m('div', [
    renderTopGasCalls(rows),
    renderAverageGasByFunction(rows),
  ]);
}


