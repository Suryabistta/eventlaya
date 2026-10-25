from django.contrib import admin
from .models import Event, EventTicket, GateScanLog, StaffGateAssignment

@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ('title', 'organizer', 'start_date', 'capacity', 'status')
    search_fields = ('title', 'slug', 'location')
    list_filter = ('status', 'start_date')

@admin.register(EventTicket)
class EventTicketAdmin(admin.ModelAdmin):
    list_display = ('ticket_number', 'event', 'attendee_name', 'attendee_email', 'status', 'is_attended')
    search_fields = ('ticket_number', 'qr_token', 'attendee_name', 'attendee_email')
    list_filter = ('status', 'is_attended', 'event')

@admin.register(GateScanLog)
class GateScanLogAdmin(admin.ModelAdmin):
    list_display = ('ticket', 'event', 'scan_type', 'result', 'gate_name', 'scanned_at')
    search_fields = ('ticket__ticket_number', 'ticket__attendee_name', 'gate_name')
    list_filter = ('scan_type', 'result', 'gate_name', 'event')

@admin.register(StaffGateAssignment)
class StaffGateAssignmentAdmin(admin.ModelAdmin):
    list_display = ('staff', 'event', 'gate_name', 'is_active', 'created_at')
    search_fields = ('staff__email', 'event__title', 'gate_name')
    list_filter = ('is_active', 'event')


from .models import EventFunding, EventTask

@admin.register(EventFunding)
class EventFundingAdmin(admin.ModelAdmin):
    list_display = ('event', 'target_budget', 'sponsorship_raised', 'ticket_sales_revenue', 'total_expenses', 'net_balance')
    search_fields = ('event__title',)

@admin.register(EventTask)
class EventTaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'event', 'status', 'priority', 'category', 'assigned_name', 'due_time')
    list_filter = ('status', 'priority', 'category', 'event')
    search_fields = ('title', 'description', 'assigned_name', 'event__title')
