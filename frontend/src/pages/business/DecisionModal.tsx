import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarX } from 'lucide-react'
import { isApiError } from '@/services/api'
import { apiErrorText, slotsApi, type ListingKind } from '@/lib/availability'
import { Button, Modal, Textarea, useToast } from '@/components/ui'

export type Decision = 'confirm' | 'decline'

export interface DecisionTarget {
  kind: ListingKind
  id: string
  customer: string
  /** "Sat, 14 Nov · Full day · Main hall" */
  summary?: string
}

/** Refresh everything that shows a request or its slot after a decision. */
export const invalidateBookingQueries = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['my-inquiries'] })
  void qc.invalidateQueries({ queryKey: ['my-vendor-inquiries'] })
  void qc.invalidateQueries({ queryKey: ['my-slots'] })
}

/** Confirm or decline a booking request / inquiry with an optional note for the customer. */
export const DecisionModal: React.FC<{
  target: DecisionTarget | null
  decision: Decision
  onClose: () => void
  onDone?: (saved: { id: string; status: string }) => void
}> = ({ target, decision, onClose, onDone }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const confirming = decision === 'confirm'

  useEffect(() => {
    if (target) setNote('')
  }, [target])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) return
    setSaving(true)
    try {
      const saved = await slotsApi.decide<{ id: string; status: string }>(target.kind, target.id, decision, note.trim() || undefined)
      toast.success(confirming ? 'Booking confirmed' : 'Request declined', `${target.customer} gets an email${confirming ? '' : ' and the slot opens again'}.`)
      onDone?.(saved)
      onClose()
    } catch (err) {
      if (isApiError(err, 'request_cancelled')) toast.error('The customer cancelled this request', 'There is nothing left to confirm or decline.')
      else if (isApiError(err, 'slot_unavailable')) toast.error('That slot is taken', 'Another booking holds this slot now, so this request can’t be confirmed.')
      else toast.error(confirming ? 'Couldn’t confirm the booking' : 'Couldn’t decline the request', apiErrorText(err))
      if (isApiError(err, 'request_cancelled') || isApiError(err, 'slot_unavailable')) onClose()
    } finally {
      setSaving(false)
      invalidateBookingQueries(qc)
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="sm"
      title={confirming ? 'Confirm this booking?' : 'Decline this request?'}
      description={
        target && (
          <>
            {target.customer}
            {target.summary ? ` · ${target.summary}` : ''}
          </>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button
            type="submit"
            form="booking-decision"
            variant={confirming ? 'primary' : 'danger'}
            loading={saving}
            icon={confirming ? <CalendarCheck className="h-4 w-4" aria-hidden /> : <CalendarX className="h-4 w-4" aria-hidden />}
          >
            {confirming ? 'Confirm booking' : 'Decline request'}
          </Button>
        </>
      }
    >
      <form id="booking-decision" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-600">
          {confirming
            ? 'The slot is marked booked and the customer is told by email and notification.'
            : 'The customer is told by email and notification. Any slot on this request opens for other customers again.'}
        </p>
        <Textarea
          label="Note for the customer"
          hint="Optional. For example the advance amount or what to bring."
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={confirming ? 'Please pay a 20% advance within 3 days to hold the date.' : 'Sorry, that day is no longer free. 21 Nov is open.'}
        />
      </form>
    </Modal>
  )
}
