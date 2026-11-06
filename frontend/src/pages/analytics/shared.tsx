import React from 'react'
import { Card, CardHeader } from '@/components/ui'

export const Legend: React.FC<{
  items: { label: string; color: string }[]
}> = ({ items }) => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
    {items.map((i) => (
      <li key={i.label} className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: i.color }} aria-hidden />
        {i.label}
      </li>
    ))}
  </ul>
)

interface ChartCardProps {
  title: string
  description?: string
  actions?: React.ReactNode
  /** Screen-reader summary of what the chart shows. */
  summary: string
  height?: string
  className?: string
  empty?: React.ReactNode
  children: React.ReactNode
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  description,
  actions,
  summary,
  height = 'h-64',
  className,
  empty,
  children,
}) => (
  <Card className={className}>
    <CardHeader title={title} description={description} actions={actions} />
    {empty ?? (
      <div className="p-4 sm:p-5">
        <div role="img" aria-label={summary} className={`relative ${height}`}>
          {children}
        </div>
      </div>
    )}
  </Card>
)
