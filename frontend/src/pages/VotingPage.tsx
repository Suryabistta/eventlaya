import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Vote as VoteIcon,
  Award,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Users,
  Flame
} from 'lucide-react'
import { api, type Poll } from '@/services/api'
import { cn } from '@/lib/utils'

export const VotingPage: React.FC = () => {
  const queryClient = useQueryClient()
  const [voterIdentity, setVoterIdentity] = useState('')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data: polls = [], isLoading } = useQuery({
    queryKey: ['polls'],
    queryFn: () => api.getPolls(),
  })

  const currentPoll = polls[0]

  const voteMutation = useMutation({
    mutationFn: ({ pollId, candidateId, voterId }: { pollId: string; candidateId: string; voterId: string }) =>
      api.castVote(pollId, {
        candidate_id: candidateId,
        voter_identifier: voterId,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['polls'] })
      setFeedback({
        type: 'success',
        message: data.message,
      })
      setSelectedCandidateId(null)
    },
    onError: (err: Error) => {
      setFeedback({
        type: 'error',
        message: err.message,
      })
    },
  })

  const handleCastVote = (candidateId: string) => {
    if (!voterIdentity.trim()) {
      setFeedback({
        type: 'error',
        message: 'Please enter your phone number or email first to verify your single vote.',
      })
      return
    }
    setFeedback(null)
    voteMutation.mutate({
      pollId: currentPoll.id,
      candidateId,
      voterId: voterIdentity.trim(),
    })
  }

  // Calculate highest vote for leader highlight
  const highestVotes = Math.max(...(currentPoll?.candidates?.map((c) => c.vote_count) || [0]))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-amber-600 via-rose-600 to-indigo-800 text-white p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold backdrop-blur-xs">
            <Award className="w-3.5 h-3.5 text-amber-300" />
            Live Event Voting & Awards
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            {currentPoll?.title || 'Live Polls & Competitions'}
          </h1>
          <p className="text-white/80 text-sm leading-relaxed">
            {currentPoll?.description || 'Audience voting powered by single-vote cryptographic verification.'}
          </p>
        </div>
      </div>

      {/* Voter Identification Bar */}
      <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-sm text-slate-900">Voter Verification</h3>
          <p className="text-xs text-slate-500">
            Enter your mobile number or attendee email. Eventlaya ensures 1 person = 1 vote strictly.
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Mobile number (+977-98...)"
            value={voterIdentity}
            onChange={(e) => setVoterIdentity(e.target.value)}
            className="text-xs px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 w-full sm:w-64"
          />
        </div>
      </div>

      {/* Notification / Feedback Banner */}
      {feedback && (
        <div
          className={cn(
            'p-4 rounded-xl border flex items-center gap-3 text-xs font-semibold animate-in fade-in',
            feedback.type === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-rose-50 text-rose-900 border-rose-200'
          )}
        >
          {feedback.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Candidates Cards */}
      {currentPoll && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Candidates / Projects ({currentPoll.candidates?.length || 0})
            </span>
            <span className="text-xs font-extrabold text-slate-700">
              Total Votes Cast: {currentPoll.total_votes}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentPoll.candidates?.map((candidate) => {
              const votePercent =
                currentPoll.total_votes > 0 ? Math.round((candidate.vote_count / currentPoll.total_votes) * 100) : 0
              const isLeader = candidate.vote_count === highestVotes && candidate.vote_count > 0

              return (
                <div
                  key={candidate.id}
                  className={cn(
                    'p-5 bg-white rounded-2xl border transition-all flex flex-col justify-between shadow-xs',
                    isLeader ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-1.5">
                          {candidate.name}
                          {isLeader && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                              <Flame className="w-3 h-3 text-amber-600" /> Leading
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{candidate.bio}</p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="pt-2">
                      <div className="flex justify-between items-center text-xs font-bold mb-1">
                        <span className="text-slate-600">{candidate.vote_count} votes</span>
                        <span className="text-slate-900">{votePercent}%</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full transition-all duration-500 rounded-full',
                            isLeader ? 'bg-amber-500' : 'bg-brand-600'
                          )}
                          style={{ width: `${votePercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Audience Poll</span>
                    <button
                      onClick={() => handleCastVote(candidate.id)}
                      disabled={voteMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs"
                    >
                      <VoteIcon className="w-3.5 h-3.5 text-amber-400" />
                      Vote for this project
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
