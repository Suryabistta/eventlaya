"""Blog API. Public reading under /api/blog/ (module `blog`), superadmin editing under /api/blog/admin/.

The blog belongs to eventlaya.com only: on white-label hosts the public endpoints answer 404.
"""
from collections import Counter

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.tenancy import tenant_for_request
from .models import KOSHI_CITIES, LANGUAGES, Post
from .rendering import render_markdown
from .serializers import AdminPostSerializer, PostCardSerializer, PostDetailSerializer

PAGE_SIZE = 24


class IsSuperadmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and getattr(request.user, 'is_superadmin', False))


def _platform_only(request):
    if tenant_for_request(request) is not None:
        raise Http404


def _matches(post, tag=None, city=None):
    if tag and tag.lower() not in [t.lower() for t in post.tags]:
        return False
    if city and city.lower() not in [c.lower() for c in post.cities]:
        return False
    return True


def related_posts(post, limit=3):
    """Same category first, then shared tags / cities, then the newest."""
    candidates = list(Post.objects.live().exclude(pk=post.pk)[:200])
    tags = {t.lower() for t in post.tags}
    cities = {c.lower() for c in post.cities}

    translations = {p.pk for p in post.translations()}
    candidates = [p for p in candidates if p.pk not in translations]  # offered by the language switch instead

    def score(p):
        return (
            (4 if p.language == post.language else 0)
            + (3 if p.category == post.category else 0)
            + 2 * len(tags & {t.lower() for t in p.tags})
            + len(cities & {c.lower() for c in p.cities})
        )
    candidates.sort(key=lambda p: (score(p), p.published_at), reverse=True)
    return candidates[:limit]


class BlogStatusView(APIView):
    """Is the blog on? (The module middleware answers 403 module_disabled when it isn't.)"""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        on = tenant_for_request(request) is None
        return Response({'enabled': on, 'posts': Post.objects.live().count() if on else 0})


class PostListView(APIView):
    """GET ?search=&category=&tag=&city=&lang=&page= → {results, count, page, pages}."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        _platform_only(request)
        qs = Post.objects.live()
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(excerpt__icontains=search) | Q(body__icontains=search))
        category = request.query_params.get('category', '').strip()
        if category:
            qs = qs.filter(category=category)
        lang = request.query_params.get('lang', '').strip()
        if lang:
            qs = qs.filter(language=lang)
        tag = request.query_params.get('tag', '').strip()
        city = request.query_params.get('city', '').strip()
        posts = [p for p in qs if _matches(p, tag, city)]
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except ValueError:
            page = 1
        count = len(posts)
        pages = max(1, -(-count // PAGE_SIZE))
        chunk = posts[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        return Response({
            'results': PostCardSerializer(chunk, many=True).data,
            'count': count, 'page': page, 'pages': pages,
        })


class PostDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        _platform_only(request)
        post = get_object_or_404(Post.objects.live(), slug=slug)
        data = PostDetailSerializer(post).data
        data['related'] = PostCardSerializer(related_posts(post), many=True).data
        return Response(data)


class TopicsView(APIView):
    """Categories, tags and cities of live posts, with counts (for the blog filters)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        _platform_only(request)
        posts = list(Post.objects.live())
        categories = Counter(p.category for p in posts)
        tags, tag_names = Counter(), {}
        cities, city_names = Counter(), {}
        for p in posts:
            for t in p.tags:
                tags[t.lower()] += 1
                tag_names.setdefault(t.lower(), t)
            for c in p.cities:
                cities[c.lower()] += 1
                city_names.setdefault(c.lower(), c)
        labels = dict(Post.Category.choices)
        languages = Counter(p.language for p in posts)
        return Response({
            'languages': [{'code': k, 'label': v, 'count': languages[k]} for k, v in LANGUAGES if languages[k]],
            'categories': [{'slug': k, 'label': labels.get(k, k), 'count': n} for k, n in
                           sorted(categories.items(), key=lambda kv: list(labels).index(kv[0]) if kv[0] in labels else 99)],
            'tags': [{'name': tag_names[k], 'count': n} for k, n in tags.most_common(30)],
            'cities': [{'name': city_names[k], 'count': n} for k, n in cities.most_common()],
        })


class AdminPostViewSet(viewsets.ModelViewSet):
    """Superadmin CRUD for posts (drafts included)."""
    serializer_class = AdminPostSerializer
    permission_classes = [IsSuperadmin]
    lookup_field = 'id'

    def get_queryset(self):
        qs = Post.objects.all().order_by('-updated_at')
        state = self.request.query_params.get('status')
        if state in Post.Status.values:
            qs = qs.filter(status=state)
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(slug__icontains=search))
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AdminPreviewView(APIView):
    """POST {body} → rendered HTML + table of contents, exactly as the public page will show it."""
    permission_classes = [IsSuperadmin]

    def post(self, request):
        body = request.data.get('body', '')
        if not isinstance(body, str) or len(body) > 200_000:
            return Response({'error': 'Send the Markdown text as "body".'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(render_markdown(body))


class AdminOptionsView(APIView):
    """Choices for the editor."""
    permission_classes = [IsSuperadmin]

    def get(self, request):
        return Response({
            'categories': [{'slug': k, 'label': v} for k, v in Post.Category.choices],
            'cities': KOSHI_CITIES,
            'languages': [{'value': k, 'label': v} for k, v in LANGUAGES],
            'statuses': [{'value': k, 'label': v} for k, v in Post.Status.choices],
        })
