import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Filler,
  type ChartOptions,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler)

/** Brand colours for chart marks (mirrors tailwind.config.js tokens). */
export const chartColors = {
  brand: '#C2215A', // brand-600: primary series
  marigold: '#BF7300', // marigold-600: secondary series (500 is too light for marks on white)
  emerald: '#15803D', // emerald-700: check-ins
  ink400: '#7B7186',
  ink900: '#1C1724',
  grid: 'rgba(123, 113, 134, 0.16)',
}

ChartJS.defaults.font.family = 'Poppins, system-ui, -apple-system, sans-serif'
ChartJS.defaults.font.size = 12
ChartJS.defaults.color = chartColors.ink400
ChartJS.defaults.borderColor = chartColors.grid

// Charts measure axis labels on first draw; redraw once the web font is ready so labels aren't clipped
if (typeof document !== 'undefined' && document.fonts) {
  void document.fonts.ready.then(() => Object.values(ChartJS.instances).forEach((chart) => chart.update()))
}

/** Shared tooltip styling, usable by any chart type. */
export const chartTooltip = {
  backgroundColor: chartColors.ink900,
  titleColor: '#fff',
  bodyColor: '#fff',
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
  usePointStyle: true,
} as const

export const fmtNpr = (n: number) => `NPR ${Math.round(n).toLocaleString()}`

const compactNpr = (v: number | string) => {
  const n = Number(v)
  if (Math.abs(n) >= 100000) return `${(n / 100000).toLocaleString(undefined, { maximumFractionDigits: 1 })}L`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  return n.toLocaleString()
}

export const lineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: chartTooltip },
  elements: {
    line: { borderWidth: 2, cubicInterpolationMode: 'monotone' },
    point: {
      // Show dots only when there are too few points to read a line
      radius: (ctx) => ((ctx.chart.data.labels?.length ?? 0) <= 4 ? 4 : 0),
      hoverRadius: 5,
      hitRadius: 12,
      hoverBorderWidth: 2,
      hoverBorderColor: '#fff',
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: { precision: 0 },
      grid: { color: chartColors.grid },
      border: { display: false },
    },
    x: { grid: { display: false }, border: { color: chartColors.grid } },
  },
}

/** Horizontal bar chart; `money` formats ticks and tooltips as NPR. */
export function hBarOptions(money = false): ChartOptions<'bar'> {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltip,
        callbacks: {
          label: (ctx) => ` ${money ? fmtNpr(Number(ctx.raw)) : Number(ctx.raw).toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: {
          precision: 0,
          callback: (v) => (money ? compactNpr(v) : Number(v).toLocaleString()),
        },
        grid: { color: chartColors.grid },
        border: { display: false },
      },
      y: {
        grid: { display: false },
        border: { color: chartColors.grid },
        ticks: { color: '#4E4659' },
      },
    },
  }
}

export const barDataset = (data: number[], color: string) => ({
  data,
  backgroundColor: color,
  hoverBackgroundColor: color,
  borderRadius: 4,
  borderSkipped: 'start' as const,
  maxBarThickness: 28,
})
