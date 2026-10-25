from rest_framework import serializers
from .models import Poll, Candidate, Vote

class CandidateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Candidate
        fields = ['id', 'poll', 'name', 'bio', 'photo', 'vote_count']
        read_only_fields = ['id', 'vote_count']


class PollSerializer(serializers.ModelSerializer):
    candidates = CandidateSerializer(many=True, read_only=True)
    total_votes = serializers.IntegerField(read_only=True)

    class Meta:
        model = Poll
        fields = [
            'id', 'event', 'title', 'description', 'is_active',
            'require_ticket', 'candidates', 'total_votes', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']
