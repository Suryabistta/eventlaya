from django.contrib import admin

from .models import (
    Candidate, ContestAuditLog, ContestCategory, ContestJudge, ContestRound, Poll, ScoreSheet, Vote, VoteCredit, VotePack,
)


@admin.register(Poll)
class PollAdmin(admin.ModelAdmin):
    list_display = ['title', 'kind', 'event', 'status', 'vote_mode', 'created_at']
    list_filter = ['kind', 'status', 'vote_mode']
    search_fields = ['title', 'event__title']


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ['name', 'number', 'poll', 'status']
    list_filter = ['status']
    search_fields = ['name', 'poll__title']


@admin.register(Vote)
class VoteAdmin(admin.ModelAdmin):
    list_display = ['poll', 'candidate', 'quantity', 'source', 'method', 'is_void', 'voted_at']
    list_filter = ['source', 'is_void', 'method']
    readonly_fields = [f.name for f in Vote._meta.fields]


for model in (ContestRound, ContestCategory, ContestJudge, ScoreSheet, VotePack, VoteCredit, ContestAuditLog):
    admin.site.register(model)
