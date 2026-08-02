import m from 'mithril';
export interface GasChartRow {
  readonly name: string | null;
  readonly gas_used: number;
  readonly depth: number;
}

export function renderGasChart(rows: readonly GasChartRow[]) {
  const gasRows = rows.filter((row) => row.gas_used > 0);

  if (gasRows.length === 0) {
    return m('p', 'No positive call-frame gas values were found.');
  }

  const chartWidth = 1000;
  const chartHeight = 380;
  const marginLeft = 86;
  const marginRight = 24;
  const marginTop = 28;
  const marginBottom = 58;

  const plotWidth = chartWidth - marginLeft - marginRight;
  const plotHeight = chartHeight - marginTop - marginBottom;
  const plotBottom = marginTop + plotHeight;

  const maximumGas = Math.max(
    ...gasRows.map((row) => row.gas_used),
  );
  const minimumGas = Math.min(
    ...gasRows.map((row) => row.gas_used),
  );

  const minimumExponent = Math.floor(Math.log10(minimumGas));
  const maximumExponent = Math.ceil(Math.log10(maximumGas));
  const exponentRange = Math.max(
    1,
    maximumExponent - minimumExponent,
  );

  const yPosition = (gas: number) =>
    marginTop +
    ((maximumExponent - Math.log10(gas)) / exponentRange) *
      plotHeight;

  const barStep = plotWidth / gasRows.length;
  const barWidth = Math.max(1, barStep * 0.72);

  const gasTicks = Array.from(
    {
      length: maximumExponent - minimumExponent + 1,
    },
    (_, index) => 10 ** (minimumExponent + index),
  );

  const requestedXTicks = [
    0,
    50,
    100,
    150,
    200,
    gasRows.length - 1,
  ];

  const xTicks = requestedXTicks.filter(
    (value, index) =>
      value >= 0 &&
      value < gasRows.length &&
      requestedXTicks.indexOf(value) === index,
  );

  const maximumIndex = gasRows.findIndex(
    (row) => row.gas_used === maximumGas,
  );

  const maximumX =
    marginLeft +
    maximumIndex * barStep +
    barStep / 2;

  const maximumY = yPosition(maximumGas);

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
            'font-size:13px;font-weight:600;margin-bottom:4px;',
        },
        'Gas Consumption per Call',
      ),
      m(
        'div',
        {
          style:
            'font-size:11px;color:#666;margin-bottom:8px;',
        },
        `${gasRows.length} call frames in trace order`,
      ),
      m(
        'svg',
        {
          viewBox: `0 0 ${chartWidth} ${chartHeight}`,
          role: 'img',
          'aria-label':
            'Logarithmic bar chart of inclusive gas used per call',
          style:
            'display:block;width:100%;height:auto;' +
            'background:#fff;',
        },
        [
          gasTicks.map((tick) => {
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

          gasRows.map((row, index) => {
            const x =
              marginLeft +
              index * barStep +
              (barStep - barWidth) / 2;
            const y = yPosition(row.gas_used);
            const height = plotBottom - y;
            const isRoot = index === 0;

            return m('g', [
              m(
                'title',
                `Call ${index}: ${row.name ?? 'Unnamed call'}\n` +
                  `Inclusive gasUsed: ${row.gas_used.toLocaleString()}\n` +
                  `Depth: ${row.depth}`,
              ),
              m('rect', {
                x,
                y,
                width: barWidth,
                height,
                fill: isRoot ? '#1B4F72' : '#2980B9',
                stroke: isRoot ? '#000000' : 'none',
                'stroke-width': isRoot ? 0.8 : 0,
              }),
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

          xTicks.map((tick) => {
            const x =
              marginLeft + tick * barStep + barStep / 2;

            return m('g', [
              m('line', {
                x1: x,
                y1: plotBottom,
                x2: x,
                y2: plotBottom + 5,
                stroke: '#444444',
                'stroke-width': 1,
              }),
              m(
                'text',
                {
                  x,
                  y: plotBottom + 19,
                  'text-anchor': 'middle',
                  fill: '#555555',
                  'font-size': 11,
                },
                String(tick),
              ),
            ]);
          }),

          m(
            'text',
            {
              x: marginLeft + plotWidth / 2,
              y: chartHeight - 10,
              'text-anchor': 'middle',
              fill: '#333333',
              'font-size': 12,
            },
            'Call index',
          ),

          m(
            'text',
            {
              x: 18,
              y: marginTop + plotHeight / 2,
              transform:
                `rotate(-90 18 ${marginTop + plotHeight / 2})`,
              'text-anchor': 'middle',
              fill: '#333333',
              'font-size': 12,
            },
            'Inclusive gasUsed (logarithmic scale)',
          ),

          m(
            'text',
            {
              x: maximumX + 8,
              y: Math.max(marginTop + 12, maximumY - 7),
              fill: '#1B4F72',
              'font-size': 11,
              'font-weight': 600,
            },
            `Maximum: ${maximumGas.toLocaleString()}`,
          ),
        ],
      ),
      m(
        'div',
        {
          style:
            'font-size:11px;color:#666;margin-top:8px;',
        },
        'Each bar represents one call frame. The root frame is ' +
          'dark blue. Hover over a bar to see its exact value.',
      ),
    ],
  );
}
