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
  X
} from 'lucide-react'
import { api, type Vendor, type VendorCategory } from '@/services/api'
import { cn } from '@/lib/utils'

export const MarketplacePage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedCity, setSelectedCity] = useState<string>('')
  const [quoteVendor, setQuoteVendor] = useState<Vendor | null>(null)
  const [quoteSent, setQuoteSent] = useState(false)

  const { data: categories = [] } = useQuery({
    queryKey: ['marketplaceCategories'],
    queryFn: api.getCategories,
  })

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors', selectedCategory, selectedCity],
    queryFn: () =>
      api.getVendors({
        category: selectedCategory || undefined,
        city: selectedCity || undefined,
      }),
  })

  const cities = ['All Cities', 'Itahari', 'Dharan', 'Biratnagar', 'Kathmandu']

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-800 via-teal-900 to-slate-900 text-white p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold backdrop-blur-xs border border-emerald-500/30">
            <Store className="w-3.5 h-3.5 text-emerald-400" />
            Eventlaya Services Marketplace (East Nepal Hub)
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Find & Book Event Service Providers
          </h1>
          <p className="text-emerald-100/80 text-sm leading-relaxed">
            Discover verified Photographers, Sound & Stage Engineers, Thematic Decorators, and Banquet Venues across Itahari, Dharan, and Biratnagar.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        {/* Category Pills */}
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

        {/* City Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value === 'All Cities' ? '' : e.target.value)}
            className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
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

      {/* Request Quote Modal */}
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
