from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import contest_views as cv
from .judge_views import JudgeSheetView, MyJudgingView
from .public_contest_views import (
    ContestOGView, PublicBuyVotesView, PublicContestAllowanceView, PublicContestantView, PublicContestView, PublicContestVoteView, PublicOTPView,
)
from .views import CandidateViewSet, CastVoteView, PollViewSet, PublicEventPollsView, PublicPollView, PublicVoteView

router = DefaultRouter()
router.register(r'polls', PollViewSet, basename='polls')
router.register(r'candidates', CandidateViewSet, basename='candidates')

C = 'contests/<uuid:pk>/'
P = 'public/<slug:slug>/contests/<str:ref>/'

urlpatterns = [
    path('polls/<uuid:poll_id>/vote/', CastVoteView.as_view(), name='cast_vote'),
    # Contests (organizer)
    path('contests/', cv.ContestListView.as_view(), name='contests'),
    path('contests/presets/', cv.PresetListView.as_view(), name='contest_presets'),
    path(C, cv.ContestDetailView.as_view(), name='contest'),
    path(C + 'preset/', cv.ContestPresetView.as_view(), name='contest_preset'),
    path(C + 'status/<str:action>/', cv.ContestStatusView.as_view(), name='contest_status'),
    path(C + 'contestants/', cv.ContestantListView.as_view(), name='contestants'),
    path(C + 'contestants/bulk/', cv.ContestantBulkView.as_view(), name='contestants_bulk'),
    path(C + 'announce/', cv.AnnounceWinnersView.as_view(), name='contest_announce'),
    path(C + 'contestants/from-applications/', cv.ContestantFromApplicationsView.as_view(), name='contestants_from_applications'),
    path(C + 'contestants/import/', cv.ContestantImportView.as_view(), name='contestants_import'),
    path(C + 'contestants/reorder/', cv.ContestantReorderView.as_view(), name='contestants_reorder'),
    path(C + 'contestants/<uuid:cid>/', cv.ContestantDetailView.as_view(), name='contestant'),
    path(C + 'rounds/<uuid:rid>/<str:action>/', cv.RoundActionView.as_view(), name='round_action'),
    path(C + 'results/', cv.ContestResultsView.as_view(), name='contest_results'),
    path(C + 'dashboard/', cv.ContestDashboardView.as_view(), name='contest_dashboard'),
    path(C + 'judges/', cv.JudgeListView.as_view(), name='contest_judges'),
    path(C + 'judges/<uuid:jid>/', cv.JudgeDetailView.as_view(), name='contest_judge'),
    path(C + 'sheets/', cv.SheetListView.as_view(), name='contest_sheets'),
    path(C + 'sheets/<uuid:sid>/unlock/', cv.SheetUnlockView.as_view(), name='contest_sheet_unlock'),
    path(C + 'flags/', cv.FlagListView.as_view(), name='contest_flags'),
    path(C + 'votes/void/', cv.VoidVotesView.as_view(), name='contest_void'),
    path(C + 'audit/', cv.AuditLogView.as_view(), name='contest_audit'),
    path(C + 'credits/grant/', cv.GrantCreditsView.as_view(), name='contest_grant'),
    path(C + 'export/', cv.ContestExportView.as_view(), name='contest_export'),
    path(C + 'purchases/', cv.PurchaseListView.as_view(), name='contest_purchases'),
    # Judges
    path('judge/', MyJudgingView.as_view(), name='my_judging'),
    path('judge/<uuid:jid>/', JudgeSheetView.as_view(), name='judge_sheet'),
    # Public
    path('public/<slug:slug>/', PublicEventPollsView.as_view(), name='public_event_polls'),
    path(P, PublicContestView.as_view(), name='public_contest'),
    path(P + 'c/<str:cref>/', PublicContestantView.as_view(), name='public_contestant'),
    path(P + 'vote/', PublicContestVoteView.as_view(), name='public_contest_vote'),
    path(P + 'allowance/', PublicContestAllowanceView.as_view(), name='public_contest_allowance'),
    path(P + 'buy/', PublicBuyVotesView.as_view(), name='public_contest_buy'),
    path(P + 'otp/<str:action>/', PublicOTPView.as_view(), name='public_contest_otp'),
    path('public/<slug:slug>/<uuid:poll_id>/', PublicPollView.as_view(), name='public_poll'),
    path('public/<slug:slug>/<uuid:poll_id>/vote/', PublicVoteView.as_view(), name='public_vote'),
    # Open Graph link previews (share links point here; people are redirected to the web page)
    path('og/<slug:slug>/<str:ref>/', ContestOGView.as_view(), name='contest_og'),
    path('og/<slug:slug>/<str:ref>/c/<str:cref>/', ContestOGView.as_view(), name='contestant_og'),
    path('', include(router.urls)),
]
