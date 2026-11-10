# Vendor & venue booking management, and BS dates everywhere

Status: being built 2026-11-10.

## What exists (audit)

- **Availability slots** (`AvailabilitySlot`): per venue (optionally per space/hall) or vendor, a date with either the whole
  day (no times) or a time range. Status open → held (requested) → booked, or blocked by the owner.
- **Requests** (`VenueInquiry`, `VendorInquiry`): a customer asks for a slot or a date; the owner confirms (slot becomes
  booked) or declines (slot opens again). The customer can cancel. Emails and push go both ways.
- **Owner screens**: Requests and Availability on the web (`/app/business/...`) and in the app's vendor section.
- **Customer screen**: My inquiries.
- **Missing**: a list of confirmed bookings, the agreed price, payments and balance, bookings the owner takes by phone
  or walk-in, reusable time slots, marking a booking done, and BS dates outside the availability calendar.

## Bookings

A booking is a confirmed request (status *Booked*), so every confirmed request shows up in **Bookings**. New:

| | |
|---|---|
| **Agreed amount** | The price agreed with the customer (defaults to the slot or package price) |
| **Payments** | Recorded by the owner: amount, date received, method (cash, bank transfer, eSewa / Khalti outside the app, cheque), note. Each payment can be removed if entered by mistake |
| **Balance** | Agreed amount − payments; shown as *Paid*, *Part paid*, *Unpaid* |
| **Completed** | After the date, the owner marks it done (kept for records and reviews) |
| **Manual booking** | The owner adds a booking taken by phone or in person: customer name, phone, date, whole day or a slot, space, amount. It blocks the slot like any other booking |

Payments are records only (no money moves through Eventlaya). Online advances can come later.

### Owner screens
- **Bookings** page: upcoming and past bookings, filters (upcoming, unpaid / part paid, completed, cancelled), search,
  totals (booked value, received, due). Open a booking to see the customer, slot, notes, payments; add a payment;
  mark completed; cancel (frees the slot).
- **Add booking** button (manual booking).
- **Slot presets** in Availability: whole day stays the default; the owner can save their own time slots once
  (e.g. Morning 7–11, Day 12–5, Evening 6–10) and pick them when opening dates.

### Customer
- My inquiries shows confirmed bookings with the agreed amount, what's paid and what's due.

## BS dates everywhere

- One date helper on the website follows the BS/AD setting (BS by default): event dates, tickets, bookings, requests,
  admin lists, payments. The BS/AD switch stays for people who prefer AD.
- Date pickers keep the browser's date input (AD) but show the BS date next to the picked date.
- App: BS conversion and BS display for dates by default.

## Not in this round
Online advance payments (Khalti/eSewa) for bookings, invoices/receipts as PDF, staff accounts for vendors.
