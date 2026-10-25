class EventModel {
  final String id;
  final String title;
  final String slug;
  final String? date;
  final String venue;
  final int capacity;
  final String? description;
  final String? coverImageUrl;

  EventModel({
    required this.id,
    required this.title,
    required this.slug,
    this.date,
    required this.venue,
    required this.capacity,
    this.description,
    this.coverImageUrl,
  });

  factory EventModel.fromJson(Map<String, dynamic> json) {
    return EventModel(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      date: json['start_date']?.toString() ?? json['date']?.toString(),
      venue: json['location']?.toString() ?? json['venue']?.toString() ?? 'Main Venue',
      capacity: (json['capacity'] is int)
          ? json['capacity'] as int
          : int.tryParse(json['capacity']?.toString() ?? '0') ?? 0,
      description: json['description']?.toString(),
      coverImageUrl: json['banner']?.toString() ?? json['cover_image']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'slug': slug,
        'date': date,
        'venue': venue,
        'capacity': capacity,
        'description': description,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EventModel && runtimeType == other.runtimeType && id == other.id;

  @override
  int get hashCode => id.hashCode;
}
