/** Home page: contests open for voting right now (live data; the superadmin sets the headings and can switch it off). */
import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from '@/components/ui/Button'
import { useHomeContent } from '@/lib/home-content'
import { useModuleEnabled } from '@/lib/modules'
import { contestApi } from '../voting/contest/api'
import { ContestCard } from '../voting/VotingListPage'
import { Eyebrow, H2 } from './Discover'
import { cn } from '@/lib/utils'

export const VotingShowcase: React.FC = () => {
  const { voting: sec } = useHomeContent()
  const on = useModuleEnabled('contests') && sec.show
  const { data } = useQuery({ queryKey: ['public-contests', 'live', '', ''], queryFn: () => contestApi.publicContests({ when: 'live' }), enabled: on })
  const list = data?.results.slice(0, 3) ?? []
  if (!on || list.length === 0) return null
  return (
    <section className="bg-gradient-to-b from-brand-50/60 to-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>{sec.eyebrow}</Eyebrow>
            <H2>{sec.title}</H2>
          </div>
          <Link to="/voting" className={buttonClass('secondary', 'md', 'rounded-full')}>
            View all contests <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className={cn('mt-8 -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0 sm:grid-cols-2 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden [&>*]:w-[85%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto', list.length === 1 && 'sm:mx-auto sm:max-w-md sm:grid-cols-1 lg:grid-cols-1 [&>*]:w-full', list.length === 2 && 'lg:mx-auto lg:max-w-3xl lg:grid-cols-2')}>
          {list.map((c) => <ContestCard compact key={c.id} c={c} />)}
        </div>
      </div>
    </section>
  )
}
