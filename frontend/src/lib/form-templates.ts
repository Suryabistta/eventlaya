import { api, type Event, type FormField } from '@/services/api'

/** Ready-made registration forms by kind of event. Picking one adds the questions; the organizer edits from there. */
export type TemplateField = Pick<FormField, 'label' | 'field_type' | 'required'> & Partial<Pick<FormField, 'options' | 'placeholder' | 'help_text' | 'validation_rules'>>

export interface FormTemplate {
  id: string
  name: string
  description: string
  fields: TemplateField[]
}

const q = (label: string, field_type: FormField['field_type'], extra: Partial<TemplateField> = {}): TemplateField => ({ label, field_type, required: false, ...extra })
const req = (label: string, field_type: FormField['field_type'], extra: Partial<TemplateField> = {}) => q(label, field_type, { required: true, ...extra })
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'running',
    name: 'Running / marathon',
    description: 'Race category, T-shirt size, date of birth, emergency contact and a waiver.',
    fields: [
      req('Race category', 'radio', { options: ['5K Fun Run', '10K', '21K Half Marathon'] }),
      req('Date of birth', 'date', { validation_rules: { min_age: 12 } }),
      req('Gender', 'radio', { options: ['Female', 'Male', 'Other'] }),
      req('T-shirt size', 'select', { options: SIZES }),
      q('Emergency contact', 'heading', { help_text: 'Who we call if something happens during the race.' }),
      req('Emergency contact name', 'text'),
      req('Emergency contact phone', 'phone'),
      q('Medical conditions we should know about', 'paragraph', { validation_rules: { max_length: 500 } }),
      req('I am fit to run and take part at my own risk', 'checkbox'),
    ],
  },
  {
    id: 'film',
    name: 'Film festival submission',
    description: 'Film details, synopsis, a screener link, poster and rights confirmation.',
    fields: [
      q('Your film', 'heading'),
      req('Film title', 'text'),
      req('Director', 'text'),
      req('Runtime (minutes)', 'number', { validation_rules: { min: 1, max: 240 } }),
      req('Category', 'select', { options: ['Short fiction', 'Documentary', 'Animation', 'Music video', 'Feature'] }),
      q('Language', 'text'),
      req('Synopsis', 'paragraph', { validation_rules: { max_length: 1000 }, help_text: 'Up to 1,000 characters.' }),
      req('Screener link', 'url', { help_text: 'YouTube, Vimeo or Google Drive. Make sure we can watch it (unlisted is fine).' }),
      q('Poster', 'image', { help_text: 'JPG or PNG, up to 5 MB.' }),
      req('I own the rights to this film and agree to the festival rules', 'checkbox'),
    ],
  },
  {
    id: 'pageant',
    name: 'Beauty pageant application',
    description: 'Age and height limits, city, education, photos, a short bio and talent.',
    fields: [
      q('About you', 'heading'),
      req('Date of birth', 'date', { validation_rules: { min_age: 18, max_age: 28 }, help_text: 'Applicants must be 18 to 28.' }),
      req('Height (cm)', 'number', { validation_rules: { min: 150, max: 200 } }),
      req('City', 'text'),
      q('Education', 'text'),
      q('Photos', 'heading', { help_text: 'Recent photos without heavy edits.' }),
      req('Portrait photo', 'image'),
      req('Full-length photo', 'image'),
      q('About your goals', 'heading'),
      req('Short bio', 'paragraph', { validation_rules: { max_length: 800 } }),
      q('Talent', 'text'),
      q('Instagram or portfolio link', 'url'),
      req('The information I gave is true and I agree to the competition rules', 'checkbox'),
    ],
  },
  {
    id: 'registration',
    name: 'Simple registration',
    description: 'Organization, how they heard about you and a meal preference.',
    fields: [
      q('Organization or college', 'text'),
      q('How did you hear about us?', 'select', { options: ['Facebook', 'Instagram', 'TikTok', 'A friend', 'Poster or banner', 'Other'] }),
      q('Meal preference', 'radio', { options: ['Veg', 'Non-veg', 'No meal'] }),
    ],
  },
  {
    id: 'conference',
    name: 'Conference / workshop',
    description: 'Organization, job title, dietary needs and sessions of interest.',
    fields: [
      q('Organization or college', 'text'),
      q('Job title or year of study', 'text'),
      q('Sessions you’re interested in', 'checkbox', { options: ['Keynotes', 'Workshops', 'Panel discussions', 'Networking'] }),
      q('Dietary needs', 'radio', { options: ['None', 'Vegetarian', 'Vegan', 'Other'] }),
      q('How did you hear about us?', 'select', { options: ['Facebook', 'Instagram', 'Friend', 'College', 'Other'] }),
    ],
  },
  {
    id: 'concert',
    name: 'Concert / show',
    description: 'City, an age check and how they heard about it.',
    fields: [
      q('City', 'text'),
      req('I am 16 or older', 'checkbox'),
      q('How did you hear about us?', 'select', { options: ['Facebook', 'Instagram', 'TikTok', 'Friend', 'Other'] }),
    ],
  },
  {
    id: 'wedding',
    name: 'Wedding RSVP',
    description: 'Attending, number of guests, meal choice and a message.',
    fields: [
      req('Will you attend?', 'radio', { options: ['Yes, with pleasure', 'Sorry, can’t make it'] }),
      q('Number of guests (including you)', 'number', { validation_rules: { min: 1, max: 10 } }),
      q('Meal choice', 'radio', { options: ['Veg', 'Non-veg'] }),
      q('Message for the couple', 'paragraph', { validation_rules: { max_length: 500 } }),
    ],
  },
  {
    id: 'team',
    name: 'Sports team',
    description: 'Team name, captain, players and jersey sizes.',
    fields: [
      req('Team name', 'text'),
      req('Captain name', 'text'),
      req('Captain phone', 'phone'),
      req('Players (one per line)', 'paragraph'),
      q('Jersey sizes', 'text', { placeholder: 'e.g. 3 M, 5 L, 2 XL' }),
      req('We agree to the tournament rules', 'checkbox'),
    ],
  },
  {
    id: 'hackathon',
    name: 'Hackathon',
    description: 'Team, skills, GitHub or portfolio, and T-shirt size.',
    fields: [
      q('Team name', 'text', { help_text: 'Leave empty if you don’t have a team yet.' }),
      q('Team size', 'number', { validation_rules: { min: 1, max: 5 } }),
      req('Skills', 'checkbox', { options: ['Frontend', 'Backend', 'Mobile', 'Design', 'Data / AI', 'Hardware'] }),
      q('GitHub or portfolio', 'url'),
      q('T-shirt size', 'select', { options: SIZES }),
    ],
  },
  {
    id: 'volunteer',
    name: 'Volunteer sign-up',
    description: 'Availability, skills, T-shirt size and an emergency contact.',
    fields: [
      req('Days you can help', 'checkbox', { options: ['Day 1', 'Day 2', 'Day 3'] }),
      q('Skills', 'checkbox', { options: ['Registration desk', 'Stage', 'Social media', 'Photography', 'Logistics'] }),
      q('T-shirt size', 'select', { options: SIZES }),
      req('Emergency contact phone', 'phone'),
    ],
  },
]

/** The template that fits the event best, for the builder to suggest. */
export function suggestedTemplate(event: Pick<Event, 'category' | 'registration_mode' | 'title'>): FormTemplate | undefined {
  const title = (event.title ?? '').toLowerCase()
  const by = (id: string) => FORM_TEMPLATES.find((t) => t.id === id)
  if (/film|movie|cinema|short/.test(title)) return by('film')
  if (/miss|mister|mrs|pageant|beauty/.test(title)) return by('pageant')
  if (/run|marathon|race|\dk\b/.test(title)) return by('running')
  if (/volunteer/.test(title)) return by('volunteer')
  switch (event.category) {
    case 'sports':
      return by('running')
    case 'hackathon':
      return by('hackathon')
    case 'conference':
    case 'workshop':
    case 'meetup':
      return by('conference')
    case 'concert':
    case 'festival':
      return by('concert')
    case 'wedding':
      return by('wedding')
  }
  return undefined
}

/** Creates a template's questions on the form, after `afterOrder`, in order. */
export async function addTemplateFields(formId: string, afterOrder: number, t: FormTemplate) {
  let order = afterOrder
  for (const f of t.fields) {
    order += 1
    await api.createFormField({ placeholder: '', help_text: '', options: [], validation_rules: {}, ...f, form: formId, order } as Partial<FormField>)
  }
}

/** A published form from a template, linked to the event as its registration or application form (used right after creating an event). */
export async function createFormFromTemplate(event: Pick<Event, 'id' | 'title'>, t: FormTemplate, as: 'registration' | 'application' = 'registration') {
  const slug = `${event.title}-${as}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'form'
  const form = await api.createForm({ title: `${event.title} ${as}`, slug, event: event.id, status: 'published' })
  await api.updateEvent(event.id, as === 'application' ? { application_form: form.id } : { registration_form: form.id })
  await addTemplateFields(form.id, 0, t)
  return form
}
