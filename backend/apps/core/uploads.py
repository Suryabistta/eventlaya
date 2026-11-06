"""Image uploads shared by every feature (logos, banners, venue and vendor photos)."""
import uuid

from django.core.files.storage import default_storage
from PIL import Image, UnidentifiedImageError
from rest_framework import permissions, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

MAX_BYTES = 5 * 1024 * 1024
# Pillow format -> file extension. SVG is deliberately excluded (it can carry scripts).
ALLOWED_FORMATS = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif'}
KINDS = {'logo', 'banner', 'venue', 'space', 'vendor', 'avatar', 'chat', 'contestant', 'blog', 'misc'}


class ImageUploadView(APIView):
    """POST multipart `file` (+ optional `kind`) → {url, width, height, size}."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'Choose an image to upload.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_BYTES:
            return Response({'error': 'Images must be 5 MB or smaller.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            image = Image.open(upload)
            image.verify()
        except (UnidentifiedImageError, OSError, SyntaxError):
            return Response({'error': 'That file isn’t an image we can read. Use JPG, PNG, WebP or GIF.'}, status=status.HTTP_400_BAD_REQUEST)

        ext = ALLOWED_FORMATS.get(image.format or '')
        if not ext:
            return Response({'error': 'Use a JPG, PNG, WebP or GIF image.'}, status=status.HTTP_400_BAD_REQUEST)

        kind = request.data.get('kind', 'misc')
        if kind not in KINDS:
            kind = 'misc'

        upload.seek(0)
        path = default_storage.save(f'uploads/{kind}/{request.user.id}/{uuid.uuid4().hex}.{ext}', upload)
        width, height = image.size
        return Response(
            {'url': default_storage.url(path), 'width': width, 'height': height, 'size': upload.size},
            status=status.HTTP_201_CREATED,
        )
