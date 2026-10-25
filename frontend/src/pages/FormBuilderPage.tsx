import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileSpreadsheet,
  Plus,
  Trash2,
  CheckCircle,
  Eye,
  Settings,
  Sparkles,
  HelpCircle,
  ChevronDown
} from 'lucide-react'
import { api, type DynamicForm, type FormField } from '@/services/api'
import { cn } from '@/lib/utils'

export const FormBuilderPage: React.FC = () => {
  const queryClient = useQueryClient()
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [showAddField, setShowAddField] = useState(false)
  const [newField, setNewField] = useState<{
    label: string
    field_type: FormField['field_type']
    placeholder: string
    required: boolean
    optionsString: string
  }>({
    label: '',
    field_type: 'text',
    placeholder: '',
    required: false,
    optionsString: '',
  })

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ['forms'],
    queryFn: api.getForms,
  })

  // Selected form or default to first
  const currentForm = forms.find((f) => f.id === selectedFormId) || forms[0]

  const addFieldMutation = useMutation({
    mutationFn: (fieldData: Partial<FormField>) => api.createFormField(fieldData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forms'] })
      setShowAddField(false)
      setNewField({
        label: '',
        field_type: 'text',
        placeholder: '',
        required: false,
        optionsString: '',
      })
    },
  })

  const handleAddField = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentForm) return

    const opts = ['select', 'radio', 'checkbox'].includes(newField.field_type)
      ? newField.optionsString.split(',').map((o) => o.trim()).filter(Boolean)
      : []

    addFieldMutation.mutate({
      form: currentForm.id,
      label: newField.label,
      field_type: newField.field_type,
      placeholder: newField.placeholder,
      required: newField.required,
      options: opts,
      order: (currentForm.fields?.length || 0) + 1,
    } as unknown as Partial<FormField>)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            Drag & Drop Form Schema Engine
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Dynamic Registration Forms</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Customize registration questionnaires, track preferences, meal choices, and participant details.
          </p>
        </div>

        {forms.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold text-slate-500">Active Form:</label>
            <select
              value={currentForm?.id || ''}
              onChange={(e) => setSelectedFormId(e.target.value)}
              className="text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 shadow-2xs focus:ring-2 focus:ring-brand-500/20"
            >
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title} ({f.fields?.length || 0} fields)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {currentForm ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Field Palette & Editor (7 Cols) */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{currentForm.title}</h2>
                  <p className="text-xs text-slate-500">{currentForm.description || 'Configured for public registration'}</p>
                </div>
                <button
                  onClick={() => setShowAddField(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-600/20 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Custom Field
                </button>
              </div>

              {/* Add Field Form Card */}
              {showAddField && (
                <form
                  onSubmit={handleAddField}
                  className="p-5 bg-brand-50/60 rounded-xl border border-brand-200/80 mb-6 space-y-3.5 text-xs animate-in fade-in"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-brand-900 uppercase text-[10px] tracking-wider">
                      Configure New Field
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddField(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Field Label *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. T-Shirt Size or College Roll #"
                        value={newField.label}
                        onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Field Type *</label>
                      <select
                        value={newField.field_type}
                        onChange={(e) =>
                          setNewField({ ...newField, field_type: e.target.value as FormField['field_type'] })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 font-medium"
                      >
                        <option value="text">Short Text</option>
                        <option value="paragraph">Long Paragraph</option>
                        <option value="phone">Phone Number</option>
                        <option value="number">Numeric</option>
                        <option value="select">Dropdown Menu</option>
                        <option value="radio">Radio Option Selection</option>
                        <option value="checkbox">Checkbox Multi-Select</option>
                        <option value="date">Date</option>
                      </select>
                    </div>
                  </div>

                  {['select', 'radio', 'checkbox'].includes(newField.field_type) && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Choices / Options (comma-separated) *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Small, Medium, Large, Extra Large"
                        value={newField.optionsString}
                        onChange={(e) => setNewField({ ...newField, optionsString: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="reqCheck"
                      checked={newField.required}
                      onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                      className="rounded text-brand-600 focus:ring-brand-500/20"
                    />
                    <label htmlFor="reqCheck" className="font-semibold text-slate-700 cursor-pointer">
                      Mark as Mandatory / Required field
                    </label>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={addFieldMutation.isPending}
                      className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-bold transition shadow-xs"
                    >
                      {addFieldMutation.isPending ? 'Saving...' : 'Save Field'}
                    </button>
                  </div>
                </form>
              )}

              {/* Active Fields List */}
              <div className="space-y-3">
                {currentForm.fields?.map((field, idx) => (
                  <div
                    key={field.id || idx}
                    className="p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl flex items-center justify-between gap-4 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 text-[11px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-900 text-xs">{field.label}</p>
                          {field.required && (
                            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 rounded">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 capitalize mt-0.5">
                          Type: {field.field_type}{' '}
                          {field.options && field.options.length > 0 && `• [${field.options.join(', ')}]`}
                        </p>
                      </div>
                    </div>

                    <span className="text-[10px] uppercase font-bold text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-200">
                      {field.field_type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Live Interactive Attendee Preview (5 Cols) */}
          <div className="lg:col-span-5 sticky top-24">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold tracking-wide">Live Attendee Preview</span>
                </div>
                <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded text-white/90">
                  Mobile Responsive
                </span>
              </div>

              <div className="p-6 space-y-4 max-h-[580px] overflow-y-auto">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="font-extrabold text-sm text-slate-900">{currentForm.title}</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Participant Registration Form</p>
                </div>

                {/* Standard Name / Email fields */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700">Full Name *</label>
                  <input
                    type="text"
                    disabled
                    placeholder="John Doe"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700">Email Address *</label>
                  <input
                    type="email"
                    disabled
                    placeholder="john@example.com"
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
                  />
                </div>

                {/* Dynamic Fields */}
                {currentForm.fields?.map((f, i) => (
                  <div key={i} className="space-y-1 pt-1">
                    <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                      <span>{f.label}</span>
                      {f.required && <span className="text-red-500 font-bold">*</span>}
                    </label>

                    {f.field_type === 'select' ? (
                      <select
                        disabled
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500"
                      >
                        <option>Select an option...</option>
                        {f.options?.map((opt, oi) => (
                          <option key={oi}>{opt}</option>
                        ))}
                      </select>
                    ) : f.field_type === 'radio' ? (
                      <div className="space-y-1.5 pt-0.5">
                        {f.options?.map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2 text-xs text-slate-600">
                            <input type="radio" disabled name={`preview-${f.id}`} />
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <input
                        type={f.field_type === 'number' ? 'number' : 'text'}
                        disabled
                        placeholder={f.placeholder || `Enter ${f.label.toLowerCase()}...`}
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
                      />
                    )}
                  </div>
                ))}

                <button
                  disabled
                  className="w-full mt-4 py-2.5 rounded-xl bg-brand-600/80 text-white font-bold text-xs shadow-xs"
                >
                  Register & Generate QR Ticket
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
          <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 text-slate-300" />
          <p className="font-bold text-sm text-slate-600">No Forms Found</p>
          <p className="text-xs text-slate-400 mt-1">Create an event first to automatically link a registration form.</p>
        </div>
      )}
    </div>
  )
}
