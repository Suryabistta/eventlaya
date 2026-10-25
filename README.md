# Eventlaya — Event Management SaaS & Services Marketplace

> **Full-Stack Event Operations Platform:** Online Registration, Custom Dynamic Form Builder, Instant QR Digital Passes, Camera-based Gate In / Gate Out Scanning, Live Voting, and Verified Vendor Marketplace.

---

## 🚀 Key Features Built in Phase 1

1. **Event Management System**
   - Create, edit, and publish events with location, dates, capacity limits, and descriptions.
   - Real-time registered and checked-in attendee counters.

2. **Google Forms-style Dynamic Form Engine**
   - Drag-and-drop / modular custom field builder: Text, Paragraph, Phone Number, Dropdowns, Radio buttons, Checkboxes, Numeric inputs.
   - Interactive live mobile preview canvas.
   - Direct binding to public event registration pages.

3. **Instant Digital QR Passes (No Manual Review Friction)**
   - Attendees register and instantly receive a verified digital entry pass (`TKT-XXXXXXXX-0001`).
   - Secure token embedded inside high-contrast QR code.
   - Built-in Print / Save to PDF styling.

4. **Gate In / Gate Out Real-Time Scanner Terminal**
   - **Camera Scanner:** Built with `html5-qrcode` supporting mobile phone rear cameras, laptop webcams, and USB barcode guns.
   - **Gate In Mode:** Verifies ticket validity, records entry timestamp, and flags **duplicate scans** if an attendee tries to enter again with the same pass.
   - **Gate Out Mode:** Logs exit timestamp for strict venue occupancy control.
   - **Live Gate Stats Bar:** Real-time metrics for Total Registered, Inside Venue, Checked Out, and Capacity Occupancy.
   - **Live Audit Stream:** Chronological feed of all scans per gate.

5. **Live Event Voting & Elections**
   - Live audience voting for awards and competitions.
   - Cryptographic 1-person-1-vote verification preventing duplicate voting.
   - Real-time animated vote tallies and leader indicators.

6. **Event Services Marketplace (Phase 3 Foundation)**
   - Pre-populated with verified event vendors in Eastern Nepal (**Itahari**, **Dharan**, **Biratnagar**, and **Kathmandu**).
   - Filter by categories: Photography & Video, Sound & Stage, Decoration, Venues, Catering.
   - Direct Request for Quotation (RFQ) inquiry modal.

---

## 🛠️ Project Structure

```
eventlays/
├── backend/                  # Django 6 + Django REST Framework API
│   ├── apps/
│   │   ├── accounts/         # Custom User, Roles, JWT Authentication
│   │   ├── events/           # Events, Tickets, GateScanLog, Attendance
│   │   ├── dynamic_forms/    # Form Builder, Fields, Responses, Answers
│   │   ├── voting/           # Live Polls, Candidates, 1-Person-1-Vote Engine
│   │   └── marketplace/      # Vendor Categories & Profiles
│   ├── config/               # Settings, URLs, OpenAPI Swagger Docs
│   ├── populate_sample_data.py # Pre-populates sample events, tickets & vendors
│   └── requirements.txt
├── frontend/                 # Vite + React 19 + TypeScript + Tailwind CSS
│   ├── src/
│   │   ├── components/       # Navbar, GateScanner, TicketPassModal
│   │   ├── pages/            # Dashboard, Events, FormBuilder, Scanner, Voting, Marketplace, PublicEvent
│   │   └── services/         # Typed REST API Client
│   └── package.json
└── Eventlaya_Business_Model_and_App_Strategy.docx
```

---

## 🏃 Quick Start Guide

### 1. Run the Backend API

```bash
cd /home/surya/Desktop/personal/eventlays/backend

# Activate the virtual environment
source .venv/bin/activate

# (Optional) Re-seed sample data anytime
python populate_sample_data.py

# Run Django development server on port 8000
python manage.py runserver 0.0.0.0:8000
```

* API Docs (Swagger): `http://127.0.0.1:8000/api/docs/`
* Admin Login: `organizer@eventlaya.com` (Password: `password123`)

### 2. Run the Frontend App

```bash
cd /home/surya/Desktop/personal/eventlays/frontend

# Start Vite dev server on port 5173
npm run dev
```

* Organizer Command Center: `http://localhost:5173/`
* Gate Scanner Terminal: `http://localhost:5173/scanner`
* Form Builder: `http://localhost:5173/forms`
* Live Voting Screen: `http://localhost:5173/voting`
* Services Marketplace: `http://localhost:5173/marketplace`
* Public Attendee Registration: `http://localhost:5173/e/eastern-tech-fest-2026`

---

## 🧪 Automated Tests

The core business logic (registration, ticket generation, gate-in, duplicate detection, gate-out) is fully covered by automated tests:

```bash
cd /home/surya/Desktop/personal/eventlays/backend
.venv/bin/python manage.py test
```
