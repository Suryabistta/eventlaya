import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Store,
  MapPin,
  Star,
  CheckCircle,
  Phone,
  Mail,
  Camera,
  Music,
  Building2,
  Sparkles,
  Utensils,
  Filter,
  X,
  Users,
  Calendar,
  Plus,
  Send,
  ShieldCheck,
  Check
} from 'lucide-react'
import { api, type Vendor, type VendorCategory, type VenueListing, type VenueInquiry } from '@/services/api'
import { cn } from '@/lib/utils'

export const MarketplacePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'venues' | 'vendors'>('venues')

  // Vendor filters
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedCity, setSelectedCity] = useState<string>('')
  const [quoteVendor, setQuoteVendor] = useState<Vendor | null>(null)
  const [quoteSent, setQuoteSent] = useState(false)

  // Venue filters
  const [venueCity, setVenueCity] = useState<string>('')
  const [venueType, setVenueType] = useState<string>('')
  const [venueSearch, setVenueSearch] = useState<string>('')

  // Venue Modals
  const [selectedVenue, setSelectedVenue] = useState<VenueListing | null>(null)
  const [inquirySent, setInquirySent] = useState(false)
  const [showPostVenueModal, setShowPostVenueModal] = useState(false)

  // Inquiry Form State
  const [inquiryName, setInquiryName] = useState('')
  const [inquiryEmail, setInquiryEmail] = useState('')
  const [inquiryPhone, setInquiryPhone] = useState('')
  const [inquiryDate, setInquiryDate] = useState('')
  const [inquiryGuests, setInquiryGuests] = useState(250)
  const [inquiryMsg, setInquiryMsg] = useState('')
  const [isSendingInquiry, setIsSendingInquiry] = useState(false)

  // Post Venue Form State
  const [newVenueName, setNewVenueName] = useState('')
  const [newVenueType, setNewVenueType] = useState<any>('banquet')
  const [newVenueCity, setNewVenueCity] = useState('Itahari')
  const [newVenueAddress, setNewVenueAddress] = useState('')
  const [newVenueMinCap, setNewVenueMinCap] = useState(100)
  const [newVenueMaxCap, setNewVenueMaxCap] = useState(600)
  const [newVenuePrice, setNewVenuePrice] = useState(45000)
  const [newVenueContact, setNewVenueContact] = useState('')
  const [newVenuePhone, setNewVenuePhone] = useState('')
  const [newVenueDesc, setNewVenueDesc] = useState('')
  const [isSubmittingVenue, setIsSubmittingVenue] = useState(false)

  const { data: categories = [] } = useQuery({
    queryKey: ['marketplaceCategories'],
    queryFn: api.getCategories,
  })

  const { data: vendors = [], isLoading: isVendorsLoading } = useQuery({
    queryKey: ['vendors', selectedCategory, selectedCity],
    queryFn: () =>
      api.getVendors({
        category: selectedCategory || undefined,
        city: selectedCity || undefined,
      }),
  })

  const { data: venues = [], isLoading: isVenuesLoading, refetch: refetchVenues } = useQuery({
    queryKey: ['venues', venueCity, venueType, venueSearch],
    queryFn: () =>
      api.getVenues({
        city: venueCity || undefined,
        type: venueType || undefined,
        search: venueSearch || undefined,
      }),
  })

  const cities = ['All Cities', 'Itahari', 'Dharan', 'Biratnagar', 'Damak', 'Kathmandu']

  const handleSendInquiry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedVenue) return
    setIsSendingInquiry(true)
    try {
      await api.sendVenueInquiry(selectedVenue.id, {
        sender_name: inquiryName,
        sender_email: inquiryEmail,
        sender_phone: inquiryPhone,
        event_type: 'Event / Celebration',
        event_date: inquiryDate || new Date().toISOString().split('T')[0],
        guest_count: inquiryGuests,
        message: inquiryMsg,
      })
      setInquirySent(true)
    } catch (err) {
      alert('Failed to send venue inquiry')
    } finally {
      setIsSendingInquiry(false)
    }
  }

  const handlePostVenue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newVenueName.trim()) return
    setIsSubmittingVenue(true)
    try {
      await api.createVenue({
        name: newVenueName,
        venue_type: newVenueType,
        city: newVenueCity,
        address: newVenueAddress,
        capacity_min: newVenueMinCap,
        capacity_max: newVenueMaxCap,
        price_per_day: newVenuePrice,
        contact_person: newVenueContact,
        contact_phone: newVenuePhone,
        description: newVenueDesc,
        amenities: ['Power Backup', 'AC Hall', 'Parking', 'Sound System'],
        images: ['https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800'],
      })
      setShowPostVenueModal(false)
      refetchVenues()
      alert('Venue listed successfully!')
    } catch (err: any) {
      alert(err.message || 'Failed to list venue')
    } finally {
      setIsSubmittingVenue(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-800 via-teal-900 to-slate-900 text-white p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold backdrop-blur-xs border border-emerald-500/30">
            <Store className="w-3.5 h-3.5 text-emerald-400" />
            Eventlaya Marketplace & Venues (Eastern Nepal Hub)
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Venues & Event Services Directory
          </h1>
          <p className="text-emerald-100/80 text-sm leading-relaxed">
            Browse banquet palaces, auditoriums, lawns, sound & stage fabrication, and live media production across Itahari, Dharan, and Biratnagar.
          </p>
        </div>
      </div>

      {/* Main Mode Switcher Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('venues')}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition',
              activeTab === 'venues'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <Building2 className="w-4 h-4" />
            <span>Event Venues & Banquets ({venues.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('vendors')}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition',
              activeTab === 'vendors'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <Store className="w-4 h-4" />
            <span>Vendor Services ({vendors.length})</span>
          </button>
        </div>

        {activeTab === 'venues' && (
          <button
            onClick={() => setShowPostVenueModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition"
          >
            <Plus className="w-4 h-4" />
            <span>Post a Venue Space</span>
          </button>
        )}
      </div>

      {/* TAB 1: VENUES & BANQUETS */}
      {activeTab === 'venues' && (
        <div className="space-y-6">
          {/* Venue Search & Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex-1 w-full sm:w-auto">
              <input
                type="text"
                placeholder="Search venue by name..."
                value={venueSearch}
                onChange={(e) => setVenueSearch(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <select
                value={venueType}
                onChange={(e) => setVenueType(e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-700"
              >
                <option value="">All Venue Types</option>
                <option value="banquet">Banquet & Party Palace</option>
                <option value="auditorium">Auditorium / Hall</option>
                <option value="resort">Resort & Lawn</option>
                <option value="hotel">Hotel Ballroom</option>
              </select>

              <select
                value={venueCity}
                onChange={(e) => setVenueCity(e.target.value === 'All Cities' ? '' : e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-700"
              >
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Venues Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {venues.map((venue) => (
              <div
                key={venue.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col justify-between"
              >
                <div>
                  {/* Photo Banner */}
                  <div className="h-48 w-full bg-slate-100 relative overflow-hidden">
                    <img
                      src={venue.images?.[0] || 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800'}
                      alt={venue.name}
                      className="w-full h-full object-cover hover:scale-105 transition duration-500"
                    />
                    <div className="absolute top-3 left-3 flex gap-1.5">
                      <span className="px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider">
                        {venue.venue_type_display || venue.venue_type}
                      </span>
                      {venue.is_featured && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Featured
                        </span>
                      )}
                    </div>
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-slate-800 text-xs font-bold flex items-center gap-1 shadow-sm">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {venue.rating} ({venue.review_count})
                    </div>
                  </div>

                  {/* Body Details */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-extrabold text-lg text-slate-900 flex items-center gap-1.5">
                          {venue.name}
                          {venue.is_verified && (
                            <span title="Verified Venue Space">
                              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {venue.address}, {venue.city}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Starting At</span>
                        <span className="font-black text-indigo-600 text-base">
                          Rs. {Number(venue.price_per_day).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-400 block">/ day</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {venue.description}
                    </p>

                    {/* Capacity & Specs */}
                    <div className="flex items-center gap-4 py-2 border-y border-slate-100 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span>Capacity: <strong>{venue.capacity_min} - {venue.capacity_max} pax</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{venue.contact_phone}</span>
                      </div>
                    </div>

                    {/* Amenities Badges */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {venue.amenities?.slice(0, 4).map((amenity, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium"
                        >
                          {amenity}
                        </span>
                      ))}
                      {venue.amenities?.length > 4 && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-50 text-slate-400 text-[11px]">
                          +{venue.amenities.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-500 font-medium">
                    Host: {venue.contact_person}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedVenue(venue)
                      setInquirySent(false)
                    }}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Booking Inquiry</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: VENDOR SERVICES */}
      {activeTab === 'vendors' && (
        <div className="space-y-6">
          {/* Category & City Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                onClick={() => setSelectedCategory('')}
                className={cn(
                  'px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition',
                  selectedCategory === ''
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition',
                    selectedCategory === cat.slug
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value === 'All Cities' ? '' : e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700"
              >
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vendors Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendors.map((vendor) => (
              <div
                key={vendor.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition overflow-hidden flex flex-col justify-between"
              >
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        {vendor.category_name}
                      </span>
                      <h3 className="font-extrabold text-base text-slate-900 mt-1.5 flex items-center gap-1.5">
                        {vendor.business_name}
                        {vendor.is_verified && (
                          <span title="Verified Business">
                            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {vendor.city}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg text-amber-800 text-xs font-bold border border-amber-100">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {vendor.rating}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                    {vendor.description}
                  </p>

                  <div className="pt-2 text-xs">
                    <span className="text-slate-400 text-[10px] uppercase font-bold">Estimated Starting Price</span>
                    <p className="font-black text-slate-900 text-sm">
                      Rs. {Number(vendor.starting_price).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 font-medium">Direct Provider</span>
                  <button
                    onClick={() => {
                      setQuoteVendor(vendor)
                      setQuoteSent(false)
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-2xs"
                  >
                    Request Quote
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Send Venue Booking Inquiry */}
      {selectedVenue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 relative text-xs">
            <button
              onClick={() => setSelectedVenue(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-lg font-bold"
            >
              ×
            </button>

            {!inquirySent ? (
              <form onSubmit={handleSendInquiry} className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded">
                    Venue Reservation Inquiry
                  </span>
                  <h3 className="font-extrabold text-base text-slate-900 mt-1">
                    Book {selectedVenue.name}
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    Location: <strong>{selectedVenue.city}</strong> • Capacity: <strong>{selectedVenue.capacity_min} - {selectedVenue.capacity_max} pax</strong>
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Your Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Shrestha"
                      value={inquiryName}
                      onChange={(e) => setInquiryName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Contact Phone *</label>
                      <input
                        type="text"
                        required
                        placeholder="+977-98XXXXXXXX"
                        value={inquiryPhone}
                        onChange={(e) => setInquiryPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="you@email.com"
                        value={inquiryEmail}
                        onChange={(e) => setInquiryEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Target Event Date</label>
                      <input
                        type="date"
                        value={inquiryDate}
                        onChange={(e) => setInquiryDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Expected Guests</label>
                      <input
                        type="number"
                        value={inquiryGuests}
                        onChange={(e) => setInquiryGuests(parseInt(e.target.value) || 100)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Event Details & Requests</label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Inquiring for full day wedding reception with stage and catering setup..."
                      value={inquiryMsg}
                      onChange={(e) => setInquiryMsg(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedVenue(null)}
                    className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingInquiry}
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition shadow-xs disabled:opacity-50"
                  >
                    {isSendingInquiry ? 'Sending...' : 'Send Inquiry'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-6 space-y-3">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
                <h3 className="font-extrabold text-base text-slate-900">Venue Inquiry Dispatched!</h3>
                <p className="text-slate-500 text-xs max-w-xs mx-auto">
                  {selectedVenue.name} management has received your date request. You can also reach them at{' '}
                  <strong className="text-slate-800">{selectedVenue.contact_phone}</strong>.
                </p>
                <button
                  onClick={() => setSelectedVenue(null)}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Post a Venue Space */}
      {showPostVenueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 relative text-xs max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowPostVenueModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-lg font-bold"
            >
              ×
            </button>

            <form onSubmit={handlePostVenue} className="space-y-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded">
                  Host Marketplace
                </span>
                <h3 className="font-extrabold text-base text-slate-900 mt-1">
                  List Your Venue Space on Eventlaya
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Reach hundreds of event organizers in Eastern Nepal (Dharan, Itahari, Biratnagar).
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Venue Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Royal Palace Banquet & Lawns"
                    value={newVenueName}
                    onChange={(e) => setNewVenueName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Venue Type</label>
                    <select
                      value={newVenueType}
                      onChange={(e) => setNewVenueType(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    >
                      <option value="banquet">Banquet Hall</option>
                      <option value="resort">Resort & Lawn</option>
                      <option value="auditorium">Auditorium</option>
                      <option value="hotel">Hotel Ballroom</option>
                      <option value="open_ground">Open Air Ground</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">City</label>
                    <select
                      value={newVenueCity}
                      onChange={(e) => setNewVenueCity(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    >
                      <option value="Itahari">Itahari</option>
                      <option value="Dharan">Dharan</option>
                      <option value="Biratnagar">Biratnagar</option>
                      <option value="Damak">Damak</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Street Address</label>
                  <input
                    type="text"
                    placeholder="e.g. Main Highway Chowk, Itahari-4"
                    value={newVenueAddress}
                    onChange={(e) => setNewVenueAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Min Capacity</label>
                    <input
                      type="number"
                      value={newVenueMinCap}
                      onChange={(e) => setNewVenueMinCap(parseInt(e.target.value) || 50)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Max Capacity</label>
                    <input
                      type="number"
                      value={newVenueMaxCap}
                      onChange={(e) => setNewVenueMaxCap(parseInt(e.target.value) || 500)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Price/Day (Rs)</label>
                    <input
                      type="number"
                      value={newVenuePrice}
                      onChange={(e) => setNewVenuePrice(parseInt(e.target.value) || 20000)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Contact Person</label>
                    <input
                      type="text"
                      placeholder="e.g. Santosh Shrestha"
                      value={newVenueContact}
                      onChange={(e) => setNewVenueContact(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      placeholder="+977-98XXXXXXXX"
                      value={newVenuePhone}
                      onChange={(e) => setNewVenuePhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Description & Rules</label>
                  <textarea
                    rows={3}
                    placeholder="Describe amenities, parking capacity, generator backup, and catering options..."
                    value={newVenueDesc}
                    onChange={(e) => setNewVenueDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPostVenueModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVenue}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition shadow-xs disabled:opacity-50"
                >
                  {isSubmittingVenue ? 'Submitting...' : 'Post Venue Listing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Vendor RFQ Quote (Legacy) */}
      {quoteVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 relative text-xs">
            <button
              onClick={() => setQuoteVendor(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            {!quoteSent ? (
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                    Request for Quotation (RFQ)
                  </span>
                  <h3 className="font-extrabold text-base text-slate-900 mt-1">
                    Contact {quoteVendor.business_name}
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    Direct phone: <strong>{quoteVendor.phone}</strong> ({quoteVendor.city})
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Your Name / Organization</label>
                    <input
                      type="text"
                      placeholder="e.g. Koshi Tech Festival"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      placeholder="+977-98XXXXXXXX"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Event Date & Requirements</label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Need sound system and 3 camera live coverage for 2 days event..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setQuoteVendor(null)}
                    className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuoteSent(true)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-xs"
                  >
                    Send Quotation Request
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 space-y-3">
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
                <h3 className="font-extrabold text-base text-slate-900">Quotation Request Sent!</h3>
                <p className="text-slate-500 text-xs max-w-xs mx-auto">
                  {quoteVendor.business_name} has received your inquiry. You can also contact them directly at{' '}
                  <strong className="text-slate-800">{quoteVendor.phone}</strong>.
                </p>
                <button
                  onClick={() => setQuoteVendor(null)}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
