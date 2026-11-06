import React from 'react'
import { Link } from 'react-router-dom'
import type { EventAnalytics } from '@/services/api'
import { Badge, Card, CardHeader } from '@/components/ui'
import { money, priceText } from '@/lib/tickets'

const availabilityLabel: Record<string, string> = {
  on_sale: 'On sale',
  not_started: 'Not started',
  ended: 'Ended',
  sold_out: 'Sold out',
  inactive: 'Off',
}

/** Per ticket type: sold, checked in and the money to collect at the venue. */
export const TicketTypesSection: React.FC<{ analytics: EventAnalytics }> = ({ analytics }) => {
  const rows = analytics.ticket_types ?? []
  if (rows.length === 0) return null
  const total = rows.reduce((a, r) => a + Number(r.revenue), 0)
  const sold = rows.reduce((a, r) => a + r.sold, 0)
  const inside = rows.reduce((a, r) => a + r.checked_in, 0)
  return (
    <Card className="mt-6">
      <CardHeader
        title="Ticket types"
        description="Payment is collected at the venue, so “Expected at venue” is what registered attendees owe."
        actions={
          <Link to="/app/tickets" className="text-sm font-medium text-brand-700 hover:underline">
            Manage tickets
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
              <th scope="col" className="px-5 py-2.5 font-medium">Ticket</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Price</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Sold</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Checked in</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Expected at venue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 tabular">
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="px-5 py-3 text-left font-medium text-ink-900">
                  <span className="flex flex-wrap items-center gap-2">
                    {r.name}
                    {r.availability !== 'on_sale' && <Badge tone="neutral">{availabilityLabel[r.availability] ?? r.availability}</Badge>}
                    {r.is_hidden && <Badge tone="brand">Hidden</Badge>}
                  </span>
                </th>
                <td className="px-3 py-3 text-right text-ink-700">{priceText(r.price)}</td>
                <td className="px-3 py-3 text-right text-ink-900">
                  {r.sold.toLocaleString()}
                  {r.quantity !== null && <span className="text-ink-400"> / {r.quantity.toLocaleString()}</span>}
                </td>
                <td className="px-3 py-3 text-right text-ink-700">{r.checked_in.toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-semibold text-ink-900">{Number(r.revenue) > 0 ? `Rs ${money(r.revenue)}` : '–'}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t border-ink-200 bg-ink-50/60 font-semibold text-ink-900 tabular">
                <th scope="row" className="px-5 py-3 text-left">Total</th>
                <td />
                <td className="px-3 py-3 text-right">{sold.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">{inside.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{total > 0 ? `Rs ${money(total)}` : '–'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  )
}
