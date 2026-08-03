import m from 'mithril';

export interface FamilyGrowthData {
  readonly familyId: string | null;
  readonly functionName: string | null;
  readonly controllingParameter: string | null;
  readonly testedSizesCsv: string | null;
  readonly receiptGasCsv: string | null;
  readonly observedInput: number;
  readonly observedGas: number;
  readonly decision: string | null;
}

function parseNumbers(csv: string | null): number[] {
  if (!csv) return [];

  return csv
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

export function renderFamilyGrowthChart(
  data: FamilyGrowthData,
) {
  const testedSizes = parseNumbers(data.testedSizesCsv);
  const testedGas = parseNumbers(data.receiptGasCsv);

  if (
    testedSizes.length === 0 ||
    testedSizes.length !== testedGas.length
  ) {
    return m(
      'p',
      'No matched-family calibration points were found.',
    );
  }

  const controlledPoints = testedSizes.map(
    (input, index) => ({
      input,
      gas: testedGas[index],
    }),
  );

  const allPoints = [
    ...controlledPoints,
    {
      input: data.observedInput,
      gas: data.observedGas,
    },
  ];

  const width = 1000;
  const height = 420;
  const marginLeft = 90;
  const marginRight = 35;
  const marginTop = 35;
  const marginBottom = 75;

  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const plotBottom = marginTop + plotHeight;

  const maximumInput = Math.max(
    ...allPoints.map((point) => point.input),
    1,
  );

  const positiveGas = allPoints
    .map((point) => point.gas)
    .filter((gas) => gas > 0);

  const minimumExponent = Math.floor(
    Math.log10(Math.min(...positiveGas)),
  );

  const maximumExponent = Math.ceil(
    Math.log10(Math.max(...positiveGas)),
  );

  const exponentRange = Math.max(
    1,
    maximumExponent - minimumExponent,
  );

  const xPosition = (input: number) =>
    marginLeft + (input / maximumInput) * plotWidth;

  const yPosition = (gas: number) =>
    marginTop +
    ((maximumExponent - Math.log10(gas)) /
      exponentRange) *
      plotHeight;

  const gasTicks = Array.from(
    {
      length:
        maximumExponent - minimumExponent + 1,
    },
    (_, index) =>
      10 ** (minimumExponent + index),
  );

  const controlledLine = controlledPoints
    .map(
      (point) =>
        `${xPosition(point.input)},${yPosition(point.gas)}`,
    )
    .join(' ');

  const observedIsHeavy =
    data.decision?.includes('gas_heavy') ?? false;

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
            'font-size:13px;font-weight:600;' +
            'margin-bottom:4px;',
        },
        'Matched-Family Gas Growth',
      ),

      m(
        'div',
        {
          style:
            'font-size:11px;color:#666;' +
            'margin-bottom:8px;',
        },
        `${data.functionName ?? 'Unknown function'} — ` +
          `${data.controllingParameter ?? 'controlling input'}`,
      ),

      m(
        'svg',
        {
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label':
            'Gas growth comparison between controlled runs ' +
            'and the observed transaction',
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
                x2: width - marginRight,
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
            points: controlledLine,
            fill: 'none',
            stroke: '#2980B9',
            'stroke-width': 3,
          }),

          controlledPoints.map((point) =>
            m(
              'circle',
              {
                cx: xPosition(point.input),
                cy: yPosition(point.gas),
                r: 5,
                fill: '#2980B9',
                stroke: '#ffffff',
                'stroke-width': 1.5,
              },
              m(
                'title',
                `Controlled input: ${point.input}\n` +
                  `Receipt gas used: ` +
                  `${point.gas.toLocaleString()} gas`,
              ),
            ),
          ),

          m(
            'circle',
            {
              cx: xPosition(data.observedInput),
              cy: yPosition(data.observedGas),
              r: 8,
              fill: observedIsHeavy
                ? '#E74C3C'
                : '#F39C12',
              stroke: '#000000',
              'stroke-width': 1.5,
            },
            m(
              'title',
              `Observed transaction\n` +
                `Input: ${data.observedInput}\n` +
                `Receipt gas used: ` +
                `${data.observedGas.toLocaleString()} gas\n` +
                `Decision: ${data.decision ?? 'not available'}`,
            ),
          ),

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
            x2: width - marginRight,
            y2: plotBottom,
            stroke: '#444444',
            'stroke-width': 1,
          }),

          controlledPoints.map((point) =>
            m(
              'text',
              {
                x: xPosition(point.input),
                y: plotBottom + 20,
                'text-anchor': 'middle',
                fill: '#555555',
                'font-size': 10,
              },
              point.input.toLocaleString(),
            ),
          ),

          m(
            'text',
            {
              x: xPosition(data.observedInput),
              y: plotBottom + 20,
              'text-anchor': 'middle',
              fill: observedIsHeavy
                ? '#C0392B'
                : '#555555',
              'font-size': 11,
              'font-weight': 600,
            },
            data.observedInput.toLocaleString(),
          ),

          m(
            'text',
            {
              x: marginLeft + plotWidth / 2,
              y: height - 18,
              'text-anchor': 'middle',
              fill: '#444444',
              'font-size': 12,
            },
            data.controllingParameter ??
              'Controlling input',
          ),

          m(
            'text',
            {
              x: 18,
              y: marginTop + plotHeight / 2,
              transform:
                `rotate(-90 18 ` +
                `${marginTop + plotHeight / 2})`,
              'text-anchor': 'middle',
              fill: '#444444',
              'font-size': 12,
            },
            'Receipt gas used — logarithmic scale',
          ),
        ],
      ),

      m(
        'div',
        {
          style:
            'display:flex;gap:18px;align-items:center;' +
            'font-size:11px;margin-top:6px;color:#555;',
        },
        [
          m('span', [
            m('span', {
              style:
                'display:inline-block;width:10px;height:10px;' +
                'border-radius:50%;background:#2980B9;' +
                'margin-right:5px;',
            }),
            'Controlled family runs',
          ]),

          m('span', [
            m('span', {
              style:
                'display:inline-block;width:11px;height:11px;' +
                'border-radius:50%;background:' +
                (observedIsHeavy
                  ? '#E74C3C'
                  : '#F39C12') +
                ';border:1px solid #000;margin-right:5px;',
            }),
            'Observed real transaction',
          ]),
        ],
      ),

      m(
        'p',
        {
          style:
            'font-size:11px;color:#666;margin:8px 0 0;',
        },
        'The blue points are controlled executions of the ' +
          'same function. The highlighted point is the real ' +
          'transaction being classified. Receipt gas values ' +
          'are compared on a logarithmic vertical scale.',
      ),
    ],
  );
}
