import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar, Doughnut, Pie } from 'react-chartjs-2'
import {
  Users,
  QrCode,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  TrendingUp,
  Download,
  Building,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { api, Event, EventAnalytics, EventTask, EventFundingData } from '../services/api'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

export default function EventAnalyticsPage() {
  const { id: routeEventId } = useParams<{ id?: string }>()
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string>('')
  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null)
  const [tasks, setTasks] = useState<EventTask[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all')

  // Modals
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [showFundingModal, setShowFundingModal] = useState(false)

  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskCategory, setNewTaskCategory] = useState<'stage' | 'gate' | 'hospitality' | 'marketing' | 'catering' | 'tech'>('tech')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [isSubmittingTask, setIsSubmittingTask] = useState(false)

  // Funding edit state
  const [fundingEdit, setFundingEdit] = useState<Partial<EventFundingData>>({})
  const [isSavingFunding, setIsSavingFunding] = useState(false)

  useEffect(() => {
    loadEvents()
  }, [])

  useEffect(() => {
    if (selectedEventId) {
      loadEventData(selectedEventId)
    }
  }, [selectedEventId])

  const loadEvents = async () => {
    try {
      const data = await api.getEvents()
      setEvents(data)
      if (data.length > 0) {
        const targetId = routeEventId && data.some(e => e.id === routeEventId)
          ? routeEventId
          : data[0].id
        setSelectedEventId(targetId)
      }
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadEventData = async (eventId: string) => {
    setRefreshing(true)
    try {
      const [analyticsData, tasksData, fundingData] = await Promise.all([
        api.getEventAnalytics(eventId),
        api.getEventTasks(eventId),
        api.getEventFunding(eventId).catch(() => null),
      ])
      setAnalytics(analyticsData)
      setTasks(tasksData)
      if (fundingData) {
        setFundingEdit(fundingData)
      }
    } catch (err) {
      console.error('Failed to load analytics or tasks:', err)
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskTitle.trim() || !selectedEventId) return
    setIsSubmittingTask(true)
    try {
      await api.createEventTask({
        event: selectedEventId,
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim(),
        category: newTaskCategory,
        priority: newTaskPriority,
        assigned_name: newTaskAssignee.trim(),
      })
      setNewTaskTitle('')
      setNewTaskDesc('')
      setNewTaskAssignee('')
      setShowTaskModal(false)
      // Reload tasks & analytics
      loadEventData(selectedEventId)
    } catch (err) {
      alert('Failed to create task')
    } finally {
      setIsSubmittingTask(false)
    }
  }

  const handleUpdateTaskStatus = async (task: EventTask, newStatus: 'todo' | 'in_progress' | 'completed') => {
    try {
      await api.updateEventTask(task.id, { status: newStatus })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
      // Refresh analytics task stats
      if (analytics) {
        const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t)
        setAnalytics({
          ...analytics,
          task_stats: {
            total: updatedTasks.length,
            todo: updatedTasks.filter(t => t.status === 'todo').length,
            in_progress: updatedTasks.filter(t => t.status === 'in_progress').length,
            completed: updatedTasks.filter(t => t.status === 'completed').length,
            urgent: updatedTasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length,
          }
        })
      }
    } catch (err) {
      alert('Failed to update task status')
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to remove this crew task?')) return
    try {
      await api.deleteEventTask(taskId)
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch (err) {
      alert('Failed to delete task')
    }
  }

  const handleSaveFunding = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEventId) return
    setIsSavingFunding(true)
    try {
      await api.updateEventFunding(selectedEventId, fundingEdit)
      setShowFundingModal(false)
      loadEventData(selectedEventId)
    } catch (err) {
      alert('Failed to update funding details')
    } finally {
      setIsSavingFunding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  const selectedEvent = events.find(e => e.id === selectedEventId)

  // Chart 1: Check-in Velocity (Line Chart)
  const velocityData = {
    labels: analytics?.velocity_chart.labels || [],
    datasets: [
      {
        label: 'Gate In (Entry Velocity)',
        data: analytics?.velocity_chart.gate_in || [],
        borderColor: '#4F46E5',
        backgroundColor: 'rgba(79, 70, 229, 0.15)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#4F46E5',
        pointRadius: 4,
      },
      {
        label: 'Gate Out (Exit)',
        data: analytics?.velocity_chart.gate_out || [],
        borderColor: '#06B6D4',
        backgroundColor: 'rgba(6, 182, 212, 0.1)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#06B6D4',
        pointRadius: 4,
      },
    ],
  }

  // Chart 2: Gate Distribution (Doughnut Chart)
  const gateDistributionData = {
    labels: analytics?.gate_distribution_chart.labels || [],
    datasets: [
      {
        data: analytics?.gate_distribution_chart.counts || [],
        backgroundColor: ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'],
        borderWidth: 2,
        borderColor: '#ffffff',
      },
    ],
  }

  // Chart 3: Financials Comparison (Bar Chart)
  const fundingBarData = {
    labels: ['Target Budget', 'Total Raised', 'Total Expenses', 'Net Balance'],
    datasets: [
      {
        label: 'Amount (NPR)',
        data: [
          analytics?.funding.target_budget || 0,
          analytics?.funding.total_funding || 0,
          analytics?.funding.total_expenses || 0,
          analytics?.funding.net_balance || 0,
        ],
        backgroundColor: [
          '#64748B', // Slate
          '#10B981', // Emerald
          '#EF4444', // Red
          (analytics?.funding.net_balance || 0) >= 0 ? '#4F46E5' : '#DC2626',
        ],
        borderRadius: 8,
      },
    ],
  }

  // Chart 4: Expense Categories Breakdown (Pie Chart)
  const expensePieData = {
    labels: analytics ? Object.keys(analytics.funding.expenses_breakdown) : [],
    datasets: [
      {
        data: analytics ? Object.values(analytics.funding.expenses_breakdown) : [],
        backgroundColor: [
          '#3B82F6', // Blue (Venue)
          '#F59E0B', // Amber (Catering)
          '#8B5CF6', // Purple (Production)
          '#EC4899', // Pink (Marketing)
          '#10B981', // Emerald (Prizes)
          '#64748B', // Slate (Logistics)
        ],
        borderWidth: 2,
        borderColor: '#ffffff',
      },
    ],
  }

  const filteredTasks = tasks.filter(t => taskFilter === 'all' || t.status === taskFilter)

  return (
    <div className="space-y-8 pb-16">
      {/* Header & Event Selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
              Operations & BI Hub
            </span>
            <span className="flex items-center text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1.5"></span>
              Live Telemetry
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Event Analytics & Work Distribution
          </h1>
          <p className="text-sm text-slate-500">
            Real-time attendance velocity, gate telemetry, financial audit, and crew task tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Event Picker Dropdown */}
          <div className="relative">
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="appearance-none bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 pr-9 font-medium text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
            <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
          </div>

          <button
            onClick={() => selectedEventId && loadEventData(selectedEventId)}
            disabled={refreshing}
            className="p-2.5 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />
          </button>

          {selectedEventId && (
            <a
              href={`/api/events/${selectedEventId}/export-attendees/`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </a>
          )}

          {selectedEventId && (
            <Link
              to={`/scan?event=${selectedEventId}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition shadow-sm"
            >
              <QrCode className="w-4 h-4" />
              <span>Gate Terminal</span>
            </Link>
          )}
        </div>
      </div>

      {/* KPI Cards Row */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Currently Inside</span>
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900">
              {analytics.attendance.currently_inside}
            </div>
            <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
              <span>Capacity: {analytics.attendance.capacity || 'Unlimited'}</span>
              <span className="font-semibold text-indigo-600">{analytics.attendance.checkin_rate_pct}% checked in</span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(
                    analytics.attendance.capacity > 0
                      ? (analytics.attendance.currently_inside / analytics.attendance.capacity) * 100
                      : 40,
                    100
                  )}%`,
                }}
              ></div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Registered</span>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900">
              {analytics.attendance.total_registered}
            </div>
            <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
              <span>Total Exited: {analytics.attendance.checked_out}</span>
              <span className="text-emerald-600 font-medium">Valid QR Passes</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Net Financial Balance</span>
              <div className={`p-2 rounded-xl ${analytics.funding.net_balance >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <div className={`text-3xl font-extrabold ${analytics.funding.net_balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              NPR {analytics.funding.net_balance.toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
              <span>Raised: NPR {analytics.funding.total_funding.toLocaleString()}</span>
              <button
                onClick={() => setShowFundingModal(true)}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Edit Budget
              </button>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Crew Operations</span>
              <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                <Layers className="w-5 h-5" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900">
              {analytics.task_stats.completed}/{analytics.task_stats.total}
            </div>
            <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
              <span className="text-amber-600 font-semibold">{analytics.task_stats.urgent} Urgent open</span>
              <span>{analytics.task_stats.in_progress} In progress</span>
            </div>
          </div>
        </div>
      )}

      {/* Charts Section: Attendance Velocity & Gate Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Velocity Over Time */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                Attendee Check-in Velocity
              </h3>
              <p className="text-xs text-slate-500">Hourly throughput velocity (Scans per hour across all stations)</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-indigo-600"></span> Gate In
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-cyan-500"></span> Gate Out
              </span>
            </div>
          </div>
          <div className="h-72">
            <Line
              data={velocityData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { mode: 'index', intersect: false },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                  },
                  x: {
                    grid: { display: false },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Gate Traffic Distribution */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-cyan-600" />
                Gate Load Distribution
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">Entry traffic breakdown across registered event checkpoints</p>
            <div className="h-56 relative flex items-center justify-center">
              <Doughnut
                data={gateDistributionData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '72%',
                  plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
                  },
                }}
              />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Audit: {analytics?.scan_audit['duplicate'] || 0} Duplicate scans rejected</span>
            <span className="text-emerald-600 font-semibold">{analytics?.scan_audit['success'] || 0} Authorized</span>
          </div>
        </div>
      </div>

      {/* Financials & Budget Breakdown (Chart.js) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funding vs Expenses Bar Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Event Funding & Expense Audit
              </h3>
              <p className="text-xs text-slate-500">Budget target vs sponsorship & ticket revenues vs actual expenditure</p>
            </div>
            <button
              onClick={() => setShowFundingModal(true)}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition"
            >
              Update Financials
            </button>
          </div>
          <div className="h-72">
            <Bar
              data={fundingBarData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => ` NPR ${Number(ctx.raw).toLocaleString()}`,
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (v) => `NPR ${Number(v) / 1000}k`,
                    },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                  },
                  x: {
                    grid: { display: false },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Expense Categories Allocation Pie */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-1">Cost Allocation</h3>
            <p className="text-xs text-slate-500 mb-4">Breakdown of event expenditures by operations department</p>
            <div className="h-60 flex items-center justify-center">
              <Pie
                data={expensePieData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                  },
                }}
              />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
            <span>Total Raised: NPR {analytics?.funding.total_funding.toLocaleString()}</span>
            <span>Total Cost: NPR {analytics?.funding.total_expenses.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Work Distribution & Crew Task Management */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600" />
                Work Distribution & Crew Tasks
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                {tasks.length} Operations
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Assign and monitor operational duties across stage, audio, security, gates, hospitality, and catering.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Filter Pills */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-medium">
              {(['all', 'todo', 'in_progress', 'completed'] as const).map((filterKey) => (
                <button
                  key={filterKey}
                  onClick={() => setTaskFilter(filterKey)}
                  className={`px-3 py-1.5 rounded-lg capitalize transition ${
                    taskFilter === filterKey
                      ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {filterKey.replace('_', ' ')}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowTaskModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Assign Task</span>
            </button>
          </div>
        </div>

        {/* Tasks Kanban Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* TO DO Column */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="font-semibold text-xs uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                To Do ({tasks.filter(t => t.status === 'todo').length})
              </span>
            </div>
            <div className="space-y-3">
              {tasks.filter(t => t.status === 'todo').map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={handleUpdateTaskStatus}
                  onDelete={handleDeleteTask}
                />
              ))}
              {tasks.filter(t => t.status === 'todo').length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">No tasks in To Do</p>
              )}
            </div>
          </div>

          {/* IN PROGRESS Column */}
          <div className="bg-blue-50/40 rounded-2xl p-4 border border-blue-200/60">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="font-semibold text-xs uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                In Progress ({tasks.filter(t => t.status === 'in_progress').length})
              </span>
            </div>
            <div className="space-y-3">
              {tasks.filter(t => t.status === 'in_progress').map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={handleUpdateTaskStatus}
                  onDelete={handleDeleteTask}
                />
              ))}
              {tasks.filter(t => t.status === 'in_progress').length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">No tasks in progress</p>
              )}
            </div>
          </div>

          {/* COMPLETED Column */}
          <div className="bg-emerald-50/40 rounded-2xl p-4 border border-emerald-200/60">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="font-semibold text-xs uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                Completed ({tasks.filter(t => t.status === 'completed').length})
              </span>
            </div>
            <div className="space-y-3">
              {tasks.filter(t => t.status === 'completed').map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onStatusChange={handleUpdateTaskStatus}
                  onDelete={handleDeleteTask}
                />
              ))}
              {tasks.filter(t => t.status === 'completed').length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">No tasks completed yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Create Crew Task */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Assign Operations Duty</h3>
              <button
                onClick={() => setShowTaskModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Audio Stage Line Check & Soundboard Tuning"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department / Category
                  </label>
                  <select
                    value={newTaskCategory}
                    onChange={(e: any) => setNewTaskCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="stage">Stage & Sound</option>
                    <option value="gate">Gate & Security</option>
                    <option value="hospitality">VIP & Hospitality</option>
                    <option value="tech">Tech & Livestream</option>
                    <option value="catering">Catering & Food</option>
                    <option value="marketing">Media & Photo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={newTaskPriority}
                    onChange={(e: any) => setNewTaskPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Crew Member Name / Role
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh Adhikari (Gate Lead)"
                  value={newTaskAssignee}
                  onChange={(e) => setNewTaskAssignee(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Instructions & Specifications
                </label>
                <textarea
                  rows={3}
                  placeholder="Specific requirements, deliverables, and backup protocol..."
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTaskModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTask}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {isSubmittingTask ? 'Creating...' : 'Assign Duty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Funding & Financials */}
      {showFundingModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full p-6 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Event Budget & Financial Ledger</h3>
                <p className="text-xs text-slate-500">Update sponsorship, revenues, and actual expenses (in NPR)</p>
              </div>
              <button
                onClick={() => setShowFundingModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSaveFunding} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Budget (NPR)</label>
                  <input
                    type="number"
                    value={fundingEdit.target_budget || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, target_budget: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sponsorship Raised (NPR)</label>
                  <input
                    type="number"
                    value={fundingEdit.sponsorship_raised || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, sponsorship_raised: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ticket Sales Revenue (NPR)</label>
                  <input
                    type="number"
                    value={fundingEdit.ticket_sales_revenue || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, ticket_sales_revenue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Grants / Donations (NPR)</label>
                  <input
                    type="number"
                    value={fundingEdit.grants_donations || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, grants_donations: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>

              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 pt-2 border-t border-slate-100">
                Expense Allocations (NPR)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Venue & Hall</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_venue || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_venue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Catering & Food</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_catering || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_catering: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Sound & Stage</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_production || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_production: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Marketing & Ads</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_marketing || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_marketing: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Prizes & Mementos</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_prizes_gifts || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_prizes_gifts: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Logistics & Travel</label>
                  <input
                    type="number"
                    value={fundingEdit.expense_logistics || 0}
                    onChange={(e) => setFundingEdit({ ...fundingEdit, expense_logistics: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowFundingModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingFunding}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {isSavingFunding ? 'Saving...' : 'Save Financial Ledger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCard({
  task,
  onStatusChange,
  onDelete,
}: {
  task: EventTask
  onStatusChange: (task: EventTask, status: 'todo' | 'in_progress' | 'completed') => void
  onDelete: (id: string) => void
}) {
  const priorityColors = {
    urgent: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    low: 'bg-slate-100 text-slate-700 border-slate-200',
  }

  const categoryLabels: Record<string, string> = {
    stage: 'Stage & Sound',
    gate: 'Gate & Security',
    hospitality: 'VIP Hospitality',
    marketing: 'Media & Photo',
    catering: 'Food & Catering',
    tech: 'Technical & Web',
  }

  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow transition">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
          {categoryLabels[task.category] || task.category}
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${priorityColors[task.priority]}`}>
          {task.priority}
        </span>
      </div>

      <h4 className="text-sm font-bold text-slate-900 mb-1 leading-snug">{task.title}</h4>
      {task.description && (
        <p className="text-xs text-slate-500 mb-3 line-clamp-2">{task.description}</p>
      )}

      {task.assigned_name && (
        <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-3 font-medium">
          <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold">
            {task.assigned_name.charAt(0)}
          </div>
          <span>{task.assigned_name}</span>
        </div>
      )}

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {task.status !== 'todo' && (
            <button
              onClick={() => onStatusChange(task, 'todo')}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5"
              title="Move to To Do"
            >
              To Do
            </button>
          )}
          {task.status !== 'in_progress' && (
            <button
              onClick={() => onStatusChange(task, 'in_progress')}
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-1.5 py-0.5"
              title="Move to In Progress"
            >
              In Progress
            </button>
          )}
          {task.status !== 'completed' && (
            <button
              onClick={() => onStatusChange(task, 'completed')}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 px-1.5 py-0.5"
              title="Mark Completed"
            >
              Complete
            </button>
          )}
        </div>

        <button
          onClick={() => onDelete(task.id)}
          className="text-slate-400 hover:text-red-600 p-1 transition"
          title="Delete Task"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
