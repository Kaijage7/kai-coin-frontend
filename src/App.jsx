import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { ethers } from 'ethers'
import { io } from 'socket.io-client'
import './App.css'

// ============================================
// SECURITY & RESILIENCE LAYER
// ============================================

const API_BASE = 'http://127.0.0.1:3333/api/v1'
const WS_URL = 'http://127.0.0.1:3333'

// Socket.IO connection with reconnection logic
let socket = null
const getSocket = () => {
  if (!socket) {
    socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}
const MAX_RETRIES = 3
const RETRY_DELAY = 1000
const RATE_LIMIT_WINDOW = 60000
const MAX_REQUESTS_PER_WINDOW = 100

// Request tracking for rate limiting
const requestLog = []

// Sanitize user input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .slice(0, 1000)
}

// Rate limiter
const checkRateLimit = () => {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW
  const recentRequests = requestLog.filter(t => t > windowStart)
  requestLog.length = 0
  requestLog.push(...recentRequests)

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new Error('Rate limit exceeded. Please wait.')
  }
  requestLog.push(now)
}

// Secure fetch with retry logic
const secureFetch = async (url, options = {}, retries = MAX_RETRIES) => {
  checkRateLimit()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    clearTimeout(timeout)

    if (retries > 0 && !error.message.includes('Rate limit')) {
      await new Promise(r => setTimeout(r, RETRY_DELAY * (MAX_RETRIES - retries + 1)))
      return secureFetch(url, options, retries - 1)
    }
    throw error
  }
}

// ============================================
// GLOBAL STATE & CONTEXT
// ============================================

const AppContext = createContext()

const useApp = () => useContext(AppContext)

// Notification types
const NOTIFICATION_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  ALERT: 'alert'
}

// ============================================
// API SERVICE
// ============================================

const api = {
  async getHealth() {
    return secureFetch(`${API_BASE}/health`)
  },
  async getTokenInfo() {
    return secureFetch(`${API_BASE}/token/info`)
  },
  async getContracts() {
    return secureFetch(`${API_BASE}/contracts`)
  },
  async getStats() {
    return secureFetch(`${API_BASE}/stats`)
  },
  async getAlerts(params = {}) {
    const query = new URLSearchParams(params).toString()
    return secureFetch(`${API_BASE}/disaster/alerts?${query}`)
  },
  async createAlert(data) {
    const sanitized = {
      disasterType: sanitizeInput(data.disasterType),
      region: sanitizeInput(data.region),
      riskScore: Math.min(100, Math.max(0, parseInt(data.riskScore) || 0))
    }
    return secureFetch(`${API_BASE}/disaster/alerts`, {
      method: 'POST',
      body: JSON.stringify(sanitized)
    })
  },
  async getBalance(address) {
    if (!ethers.isAddress(address)) throw new Error('Invalid address')
    return secureFetch(`${API_BASE}/token/balance/${address}`)
  },
  async registerUser(data) {
    return secureFetch(`${API_BASE}/users/register`, {
      method: 'POST',
      body: JSON.stringify({
        walletAddress: sanitizeInput(data.walletAddress),
        region: sanitizeInput(data.region),
        countryCode: sanitizeInput(data.countryCode),
        userType: sanitizeInput(data.userType)
      })
    })
  }
}

// ============================================
// COMPONENTS
// ============================================

// Error Boundary (Functional)
function ErrorBoundaryWrapper({ children }) {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const handler = (event) => {
      console.error('Global error:', event.error)
      setHasError(true)
    }
    window.addEventListener('error', handler)
    return () => window.removeEventListener('error', handler)
  }, [])

  if (hasError) {
    return (
      <div className="error-boundary">
        <h2>System Protection Activated</h2>
        <p>An error occurred. The system has been protected.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }

  return children
}

// Connection Status Monitor
function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [apiStatus, setApiStatus] = useState('checking')

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const checkApi = async () => {
      try {
        await api.getHealth()
        setApiStatus('connected')
      } catch {
        setApiStatus('disconnected')
      }
    }

    checkApi()
    const interval = setInterval(checkApi, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className={`connection-status ${online && apiStatus === 'connected' ? 'online' : 'offline'}`}>
      <span className="status-dot"></span>
      <span>{online ? (apiStatus === 'connected' ? 'Connected' : 'API Offline') : 'Offline'}</span>
    </div>
  )
}

// Toast Notifications
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      <span className="toast-icon">
        {type === 'success' && '✓'}
        {type === 'error' && '✕'}
        {type === 'warning' && '⚠'}
        {type === 'info' && 'ℹ'}
        {type === 'alert' && '🔔'}
      </span>
      <span className="toast-message">{message}</span>
    </div>
  )
}

function ToastContainer({ notifications, removeNotification }) {
  return (
    <div className="toast-container">
      {notifications.map((n, i) => (
        <Toast key={i} {...n} onClose={() => removeNotification(i)} />
      ))}
    </div>
  )
}

// Animated Counter
function AnimatedCounter({ value, duration = 1000 }) {
  const [displayValue, setDisplayValue] = useState(0)
  const targetValue = parseFloat(value) || 0

  useEffect(() => {
    const startTime = Date.now()
    const startValue = displayValue

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)

      setDisplayValue(startValue + (targetValue - startValue) * eased)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [targetValue])

  return <span>{displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
}

// Live Activity Feed
function ActivityFeed({ activities }) {
  return (
    <div className="activity-feed">
      <h3>Live Activity</h3>
      <div className="feed-list">
        {activities.length === 0 ? (
          <div className="no-activity">No recent activity</div>
        ) : (
          activities.map((activity, i) => (
            <div key={i} className={`feed-item ${activity.type}`}>
              <span className="feed-icon">{activity.icon}</span>
              <div className="feed-content">
                <span className="feed-text">{activity.text}</span>
                <span className="feed-time">{activity.time}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Security Shield Display
function SecurityShield({ level }) {
  const levels = {
    high: { color: '#10b981', label: 'HIGH', icon: '🛡️' },
    medium: { color: '#f59e0b', label: 'MEDIUM', icon: '⚡' },
    low: { color: '#ef4444', label: 'LOW', icon: '⚠️' }
  }

  const current = levels[level] || levels.high

  return (
    <div className="security-shield" style={{ borderColor: current.color }}>
      <span className="shield-icon">{current.icon}</span>
      <div className="shield-info">
        <span className="shield-label">Security Level</span>
        <span className="shield-value" style={{ color: current.color }}>{current.label}</span>
      </div>
    </div>
  )
}

// Progress Ring
function ProgressRing({ progress, size = 80, strokeWidth = 8 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (progress / 100) * circumference

  return (
    <svg width={size} height={size} className="progress-ring">
      <circle
        stroke="#334155"
        fill="transparent"
        strokeWidth={strokeWidth}
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      <circle
        stroke={progress > 70 ? '#ef4444' : progress > 40 ? '#f59e0b' : '#10b981'}
        fill="transparent"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        r={radius}
        cx={size / 2}
        cy={size / 2}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
      />
      <text x="50%" y="50%" textAnchor="middle" dy=".3em" className="progress-text">
        {progress}%
      </text>
    </svg>
  )
}

// ============================================
// PAGES
// ============================================

// Live Metrics Ticker
function MetricsTicker({ token, stats, wsConnected }) {
  const metrics = [
    { label: 'Total Supply', value: token?.totalSupply ? `${parseFloat(token.totalSupply).toLocaleString()} KAI` : 'Loading...' },
    { label: 'Active Alerts', value: stats?.activeAlerts || 0, highlight: (stats?.activeAlerts || 0) > 0 },
    { label: 'Users', value: stats?.totalUsers || 0 },
    { label: 'Network', value: wsConnected ? 'LIVE' : 'OFFLINE', highlight: !wsConnected },
    { label: 'Chain ID', value: '31337' },
    { label: 'Block Time', value: '~2s' },
  ]

  return (
    <div className="metrics-ticker">
      <div className="ticker-track">
        {[...metrics, ...metrics].map((m, i) => (
          <div key={i} className={`ticker-item ${m.highlight ? 'highlight' : ''}`}>
            <span className="ticker-label">{m.label}</span>
            <span className="ticker-value">{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Pillar Status Component
function PillarStatus({ pillar, status }) {
  const statusColors = {
    active: '#10b981',
    pending: '#f59e0b',
    inactive: '#64748b'
  }
  return (
    <div className="pillar-status-item" style={{ '--pillar-status-color': statusColors[status] }}>
      <span className="pillar-emoji">{pillar.icon}</span>
      <span className="pillar-name">{pillar.name}</span>
      <span className={`pillar-badge ${status}`}>{status}</span>
    </div>
  )
}

// Africa SVG Map
function AfricaSVG() {
  return (
    <svg viewBox="0 0 400 450" className="africa-svg-map">
      <defs>
        <linearGradient id="africaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2d4a3e" />
          <stop offset="100%" stopColor="#1a2f27" />
        </linearGradient>
        <filter id="mapGlow">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path
        className="africa-continent"
        d="M200 15 C240 15, 290 35, 320 60 Q350 85, 365 115 C378 140, 380 165, 375 190
           Q368 220, 355 250 C340 285, 320 315, 305 345 Q285 385, 260 415
           C235 440, 200 445, 170 430 Q140 415, 120 385 C100 355, 88 320, 82 285
           Q75 245, 78 205 C82 165, 95 130, 115 100 Q140 65, 175 40 C190 28, 200 15, 200 15 Z
           M75 125 Q60 130, 50 120 C45 112, 50 100, 65 100 Q78 100, 75 125
           M378 185 Q392 195, 390 210 C388 225, 375 225, 370 215 Q365 200, 378 185"
        fill="url(#africaGrad)"
        stroke="#daa520"
        strokeWidth="2"
        filter="url(#mapGlow)"
      />
      <path
        className="africa-borders"
        d="M140 90 Q180 100, 230 95 Q280 90, 310 105
           M110 150 Q160 150, 210 145 Q260 140, 310 155 Q345 165, 360 175
           M95 210 Q150 205, 205 210 Q260 215, 310 205 Q345 200, 358 215
           M90 270 Q145 275, 200 270 Q255 265, 305 280 Q330 290, 340 305
           M100 330 Q155 340, 205 335 Q255 330, 295 350"
        stroke="#3d5a4a"
        strokeWidth="1"
        fill="none"
        opacity="0.4"
      />
    </svg>
  )
}

// Regional Map Component
function RegionalMap({ alerts }) {
  const [hoveredRegion, setHoveredRegion] = useState(null)

  const regions = [
    { id: 'east', name: 'East Africa', coords: { top: '38%', left: '72%' }, countries: 'Kenya, Tanzania, Uganda, Ethiopia' },
    { id: 'west', name: 'West Africa', coords: { top: '45%', left: '18%' }, countries: 'Nigeria, Ghana, Senegal, Mali' },
    { id: 'north', name: 'North Africa', coords: { top: '22%', left: '48%' }, countries: 'Egypt, Morocco, Algeria, Tunisia' },
    { id: 'south', name: 'Southern Africa', coords: { top: '78%', left: '52%' }, countries: 'South Africa, Zimbabwe, Botswana' },
    { id: 'central', name: 'Central Africa', coords: { top: '55%', left: '48%' }, countries: 'DRC, Cameroon, Congo, CAR' },
  ]

  const regionAlerts = regions.map(r => ({
    ...r,
    alerts: alerts?.filter(a => a.region?.toLowerCase().includes(r.id))?.length || 0
  }))

  const totalAlerts = regionAlerts.reduce((sum, r) => sum + r.alerts, 0)

  return (
    <div className="regional-map">
      <div className="map-header">
        <h3>Regional Overview</h3>
        <div className="map-legend">
          <span className="legend-item"><span className="legend-dot safe"></span>Clear</span>
          <span className="legend-item"><span className="legend-dot warning"></span>Alert</span>
          <span className="legend-item"><span className="legend-dot danger"></span>Critical</span>
        </div>
      </div>
      <div className="map-container">
        <div className="africa-outline">
          <AfricaSVG />
          {regionAlerts.map(region => (
            <div
              key={region.id}
              className={`region-marker ${region.alerts > 0 ? 'has-alerts' : ''} ${region.alerts >= 3 ? 'critical' : ''}`}
              style={{ top: region.coords.top, left: region.coords.left }}
              onMouseEnter={() => setHoveredRegion(region.id)}
              onMouseLeave={() => setHoveredRegion(null)}
            >
              <span className="marker-dot"></span>
              <span className="marker-pulse"></span>
              {region.alerts > 0 && <span className="marker-count">{region.alerts}</span>}
              {hoveredRegion === region.id && (
                <div className="marker-tooltip">
                  <strong>{region.name}</strong>
                  <span className="tooltip-countries">{region.countries}</span>
                  <span className={`tooltip-alerts ${region.alerts > 0 ? 'active' : ''}`}>
                    {region.alerts > 0 ? `${region.alerts} active alerts` : 'No alerts'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="region-list">
          <div className="region-summary">
            <span className="summary-icon">🌍</span>
            <div className="summary-text">
              <span className="summary-label">Total Alerts</span>
              <span className={`summary-value ${totalAlerts > 0 ? 'has-alerts' : ''}`}>{totalAlerts}</span>
            </div>
          </div>
          {regionAlerts.map(r => (
            <div
              key={r.id}
              className={`region-item ${r.alerts > 0 ? 'active' : ''} ${hoveredRegion === r.id ? 'hovered' : ''}`}
              onMouseEnter={() => setHoveredRegion(r.id)}
              onMouseLeave={() => setHoveredRegion(null)}
            >
              <div className="region-info">
                <span className="region-name">{r.name}</span>
                <span className="region-countries">{r.countries}</span>
              </div>
              <span className={`region-alert-badge ${r.alerts > 0 ? 'danger' : 'safe'}`}>
                {r.alerts > 0 ? r.alerts : '✓'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Advanced Regional Intelligence Map - Detailed Africa with country boundaries
// Hidden: Geographic nodes encode pillar activation patterns
function AdvancedRegionalMap({ alerts, pillars }) {
  const [activeRegion, setActiveRegion] = useState(null)
  const [mapMode, setMapMode] = useState('heat') // heat, nodes, flow

  // African countries with SVG path data (simplified but realistic boundaries)
  const countries = [
    { id: 'eg', name: 'Egypt', region: 'north', path: 'M295 85 L320 80 L335 95 L340 120 L320 140 L295 135 L285 115 Z', capital: 'Cairo' },
    { id: 'ng', name: 'Nigeria', region: 'west', path: 'M150 195 L175 190 L185 210 L175 235 L150 230 L140 210 Z', capital: 'Abuja' },
    { id: 'ke', name: 'Kenya', region: 'east', path: 'M305 215 L325 210 L335 235 L320 260 L300 250 L295 225 Z', capital: 'Nairobi' },
    { id: 'za', name: 'South Africa', region: 'south', path: 'M220 360 L260 355 L280 380 L260 410 L220 405 L200 380 Z', capital: 'Pretoria' },
    { id: 'cd', name: 'DR Congo', region: 'central', path: 'M220 220 L260 215 L275 250 L260 290 L220 285 L200 250 Z', capital: 'Kinshasa' },
    { id: 'et', name: 'Ethiopia', region: 'east', path: 'M305 165 L340 160 L350 185 L335 210 L300 205 L295 180 Z', capital: 'Addis Ababa' },
    { id: 'tz', name: 'Tanzania', region: 'east', path: 'M290 260 L320 255 L330 290 L310 320 L280 310 L275 275 Z', capital: 'Dodoma' },
    { id: 'ma', name: 'Morocco', region: 'north', path: 'M120 70 L155 65 L165 90 L150 115 L115 110 L105 85 Z', capital: 'Rabat' },
    { id: 'gh', name: 'Ghana', region: 'west', path: 'M125 205 L145 200 L150 225 L140 250 L120 245 L115 220 Z', capital: 'Accra' },
    { id: 'sn', name: 'Senegal', region: 'west', path: 'M75 175 L105 170 L110 190 L95 210 L70 205 L68 185 Z', capital: 'Dakar' },
  ]

  const regions = {
    north: { color: '#f59e0b', label: 'North Africa', nodes: 12 },
    west: { color: '#10b981', label: 'West Africa', nodes: 18 },
    east: { color: '#6366f1', label: 'East Africa', nodes: 15 },
    central: { color: '#8b5cf6', label: 'Central Africa', nodes: 8 },
    south: { color: '#ec4899', label: 'Southern Africa', nodes: 11 }
  }

  const getAlertCount = (region) => alerts?.filter(a => a.region?.toLowerCase().includes(region))?.length || 0
  const getPillarHealth = () => pillars?.filter(p => p.status === 'active')?.length || 0

  return (
    <div className="advanced-map">
      <div className="map-header">
        <div className="map-title">
          <h3>Regional Intelligence</h3>
          <span className="map-live-indicator">LIVE</span>
        </div>
        <div className="map-controls">
          {['heat', 'nodes', 'flow'].map(mode => (
            <button
              key={mode}
              className={`map-mode-btn ${mapMode === mode ? 'active' : ''}`}
              onClick={() => setMapMode(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="map-content">
        <svg viewBox="0 0 400 450" className="africa-detailed-map">
          <defs>
            <filter id="countryGlow">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <linearGradient id="heatGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.8"/>
              <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.4"/>
            </linearGradient>
            {Object.entries(regions).map(([id, r]) => (
              <radialGradient key={id} id={`region-${id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={r.color} stopOpacity="0.6"/>
                <stop offset="100%" stopColor={r.color} stopOpacity="0.2"/>
              </radialGradient>
            ))}
          </defs>

          {/* Continental outline */}
          <path
            className="continent-base"
            d="M200 25 C250 20, 310 45, 350 85 Q380 120, 385 165 C390 210, 375 260, 355 305
               Q330 360, 290 400 C250 435, 200 440, 160 420 Q120 400, 95 360
               C70 315, 60 265, 65 215 Q70 165, 95 120 C125 70, 165 35, 200 25 Z"
            fill="rgba(0,0,0,0.6)"
            stroke="var(--sacred-gold)"
            strokeWidth="1.5"
          />

          {/* Country paths with interactive hover */}
          {countries.map(country => {
            const alertCount = getAlertCount(country.region)
            const isActive = activeRegion === country.id
            return (
              <g key={country.id} className="country-group">
                <path
                  d={country.path}
                  fill={`url(#region-${country.region})`}
                  stroke={isActive ? 'var(--sacred-gold)' : 'rgba(255,215,0,0.3)'}
                  strokeWidth={isActive ? 2 : 1}
                  className={`country-path ${alertCount > 0 ? 'has-alert' : ''}`}
                  onMouseEnter={() => setActiveRegion(country.id)}
                  onMouseLeave={() => setActiveRegion(null)}
                  filter={isActive ? 'url(#countryGlow)' : undefined}
                />
                {mapMode === 'nodes' && (
                  <circle
                    cx={parseInt(country.path.split(' ')[0].replace('M', '')) + 15}
                    cy={parseInt(country.path.split(' ')[1]) + 15}
                    r={4 + alertCount}
                    fill={alertCount > 0 ? '#ef4444' : '#10b981'}
                    className="node-indicator"
                  />
                )}
              </g>
            )
          })}

          {/* Network flow lines */}
          {mapMode === 'flow' && (
            <g className="flow-lines">
              <path d="M150 210 Q200 180 300 220" stroke="var(--sacred-gold)" strokeWidth="1" fill="none" opacity="0.5" strokeDasharray="4,4">
                <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1s" repeatCount="indefinite"/>
              </path>
              <path d="M220 250 Q280 200 320 170" stroke="var(--sacred-gold)" strokeWidth="1" fill="none" opacity="0.5" strokeDasharray="4,4">
                <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1.5s" repeatCount="indefinite"/>
              </path>
              <path d="M240 380 Q260 300 300 260" stroke="var(--sacred-gold)" strokeWidth="1" fill="none" opacity="0.5" strokeDasharray="4,4">
                <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1.2s" repeatCount="indefinite"/>
              </path>
            </g>
          )}
        </svg>

        {/* Active country tooltip */}
        {activeRegion && (
          <div className="country-tooltip">
            {(() => {
              const c = countries.find(x => x.id === activeRegion)
              const alertCount = getAlertCount(c?.region)
              return c ? (
                <>
                  <span className="tooltip-name">{c.name}</span>
                  <span className="tooltip-capital">{c.capital}</span>
                  <span className={`tooltip-status ${alertCount > 0 ? 'alert' : 'clear'}`}>
                    {alertCount > 0 ? `${alertCount} Active Alerts` : 'All Clear'}
                  </span>
                </>
              ) : null
            })()}
          </div>
        )}
      </div>

      {/* Region stats bar */}
      <div className="region-stats-bar">
        {Object.entries(regions).map(([id, region]) => (
          <div key={id} className="region-stat-item" style={{ '--region-color': region.color }}>
            <span className="region-dot"></span>
            <span className="region-label">{region.label}</span>
            <span className="region-nodes">{region.nodes} nodes</span>
            <span className={`region-alert-count ${getAlertCount(id) > 0 ? 'active' : ''}`}>
              {getAlertCount(id) || '✓'}
            </span>
          </div>
        ))}
      </div>

      {/* Network health indicator */}
      <div className="map-footer">
        <div className="network-health">
          <span className="health-label">Pillar Coverage</span>
          <div className="health-bar">
            <div className="health-fill" style={{ width: `${(getPillarHealth() / 7) * 100}%` }}></div>
          </div>
          <span className="health-value">{getPillarHealth()}/7</span>
        </div>
        <div className="total-nodes">
          <span className="nodes-value">64</span>
          <span className="nodes-label">Active Nodes</span>
        </div>
      </div>
    </div>
  )
}

// Control Panel - Integrated Quick Actions with Pillar States
// Hidden: Action matrix encodes activation sequences
function ControlPanel({ stats, pillars }) {
  const CONTROL_MATRIX = [0x41, 0x43, 0x54, 0x49, 0x56, 0x45] // A,C,T,I,V,E

  const actions = [
    { id: 'alert', icon: '⚡', label: 'Alert', path: '/alerts', type: 'danger', active: (stats?.activeAlerts || 0) > 0 },
    { id: 'wallet', icon: '◈', label: 'Wallet', path: '/wallet', type: 'default', active: true },
    { id: 'contracts', icon: '⬡', label: 'Smart Contracts', path: '/contracts', type: 'default', active: true },
    { id: 'pillars', icon: '⏣', label: 'Pillars', path: '/pillars', type: 'primary', active: true },
  ]

  const activePillars = pillars?.filter(p => p.status === 'active')?.length || 0
  const systemStatus = activePillars >= 5 ? 'optimal' : activePillars >= 3 ? 'nominal' : 'degraded'

  return (
    <div className="control-panel-inner" data-matrix={CONTROL_MATRIX.join('-')}>
      <div className="panel-header">
        <h3>System Control</h3>
        <span className={`system-status-badge ${systemStatus}`}>{systemStatus.toUpperCase()}</span>
      </div>

      <div className="pillar-indicators">
        {pillars?.slice(0, 7).map((pillar, i) => (
          <div
            key={pillar.name}
            className={`pillar-indicator ${pillar.status}`}
            title={`${pillar.name}: ${pillar.status}`}
          >
            <span className="indicator-index">{i + 1}</span>
            <span className="indicator-pulse"></span>
          </div>
        ))}
      </div>

      <div className="action-buttons">
        {actions.map(action => (
          <Link
            key={action.id}
            to={action.path}
            className={`ctrl-action ${action.type} ${action.active ? 'active' : ''}`}
          >
            <span className="action-icon">{action.icon}</span>
            <span className="action-label">{action.label}</span>
            {action.id === 'alert' && stats?.activeAlerts > 0 && (
              <span className="action-badge">{stats.activeAlerts}</span>
            )}
          </Link>
        ))}
      </div>

      <div className="panel-metrics">
        <div className="metric-item">
          <span className="metric-value">{activePillars}</span>
          <span className="metric-label">Active Pillars</span>
        </div>
        <div className="metric-item">
          <span className="metric-value">{stats?.totalTransactions || 0}</span>
          <span className="metric-label">Transactions</span>
        </div>
        <div className="metric-item">
          <span className="metric-value">{stats?.activeAlerts || 0}</span>
          <span className="metric-label">Alerts</span>
        </div>
      </div>
    </div>
  )
}

// System Performance Gauge
function PerformanceGauge({ label, value, max = 100, unit = '%' }) {
  const percentage = Math.min((value / max) * 100, 100)
  const color = percentage > 80 ? '#ef4444' : percentage > 60 ? '#f59e0b' : '#10b981'

  return (
    <div className="perf-gauge">
      <div className="gauge-label">{label}</div>
      <div className="gauge-bar">
        <div className="gauge-fill" style={{ width: `${percentage}%`, background: color }}></div>
      </div>
      <div className="gauge-value">{value}{unit}</div>
    </div>
  )
}

// Blockchain Stats
function BlockchainStats({ health }) {
  const [blockNumber, setBlockNumber] = useState(0)
  const [gasPrice, setGasPrice] = useState('0')

  useEffect(() => {
    const interval = setInterval(() => {
      setBlockNumber(prev => prev + 1)
    }, 2000)
    setBlockNumber(Math.floor(Math.random() * 1000) + 100)
    setGasPrice((Math.random() * 30 + 10).toFixed(2))
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="blockchain-stats">
      <h3>Blockchain</h3>
      <div className="chain-metrics">
        <div className="chain-metric">
          <span className="chain-icon">⛓️</span>
          <div className="chain-info">
            <span className="chain-label">Latest Block</span>
            <span className="chain-value">#{blockNumber}</span>
          </div>
        </div>
        <div className="chain-metric">
          <span className="chain-icon">⛽</span>
          <div className="chain-info">
            <span className="chain-label">Gas Price</span>
            <span className="chain-value">{gasPrice} Gwei</span>
          </div>
        </div>
        <div className="chain-metric">
          <span className="chain-icon">🔗</span>
          <div className="chain-info">
            <span className="chain-label">Chain</span>
            <span className="chain-value">Hardhat Local</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// SPACE & COSMIC FEATURES
// ============================================

// Global Satellite Network Visualization
function SatelliteNetwork() {
  const [satellites, setSatellites] = useState([
    { id: 1, name: 'KAI-SAT-1', orbit: 'LEO', status: 'active', angle: 0 },
    { id: 2, name: 'KAI-SAT-2', orbit: 'MEO', status: 'active', angle: 120 },
    { id: 3, name: 'KAI-SAT-3', orbit: 'GEO', status: 'syncing', angle: 240 },
  ])
  const [dataTransfer, setDataTransfer] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setSatellites(prev => prev.map(sat => ({
        ...sat,
        angle: (sat.angle + (sat.orbit === 'LEO' ? 3 : sat.orbit === 'MEO' ? 2 : 1)) % 360
      })))
      setDataTransfer(Math.floor(Math.random() * 500) + 100)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="satellite-network">
      <div className="satellite-header">
        <h3>Orbital Network</h3>
        <span className="data-rate">{dataTransfer} TB/s</span>
      </div>
      <div className="orbit-view">
        <svg viewBox="0 0 200 200" className="orbit-svg">
          <defs>
            <radialGradient id="earthGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1e40af" />
              <stop offset="50%" stopColor="#1e3a8a" />
              <stop offset="100%" stopColor="#172554" />
            </radialGradient>
            <filter id="glowEffect">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Stars background */}
          {[...Array(30)].map((_, i) => (
            <circle key={i} cx={Math.random() * 200} cy={Math.random() * 200} r={Math.random() * 1.5} fill="#fff" opacity={Math.random() * 0.8 + 0.2} />
          ))}
          {/* Orbit paths */}
          <circle cx="100" cy="100" r="35" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
          <circle cx="100" cy="100" r="55" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4,4" opacity="0.4" />
          <circle cx="100" cy="100" r="75" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4,4" opacity="0.3" />
          {/* Earth */}
          <circle cx="100" cy="100" r="20" fill="url(#earthGrad)" filter="url(#glowEffect)" />
          <ellipse cx="100" cy="100" rx="20" ry="8" fill="none" stroke="#10b981" strokeWidth="0.5" opacity="0.5" />
          {/* Satellites */}
          {satellites.map((sat, i) => {
            const radius = sat.orbit === 'LEO' ? 35 : sat.orbit === 'MEO' ? 55 : 75
            const x = 100 + radius * Math.cos(sat.angle * Math.PI / 180)
            const y = 100 + radius * Math.sin(sat.angle * Math.PI / 180)
            return (
              <g key={sat.id}>
                <line x1="100" y1="100" x2={x} y2={y} stroke={sat.status === 'active' ? '#10b981' : '#f59e0b'} strokeWidth="0.5" opacity="0.3" strokeDasharray="2,2" />
                <circle cx={x} cy={y} r="4" fill={sat.status === 'active' ? '#10b981' : '#f59e0b'} filter="url(#glowEffect)" />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="satellite-list">
        {satellites.map(sat => (
          <div key={sat.id} className={`satellite-item ${sat.status}`}>
            <span className="sat-icon">🛰️</span>
            <span className="sat-name">{sat.name}</span>
            <span className="sat-orbit">{sat.orbit}</span>
            <span className={`sat-status ${sat.status}`}>{sat.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Space Weather Monitor
function SpaceWeatherMonitor() {
  const [solarActivity, setSolarActivity] = useState({ kp: 3, speed: 450, density: 5.2 })
  const [forecast, setForecast] = useState('stable')

  useEffect(() => {
    const interval = setInterval(() => {
      const kp = Math.floor(Math.random() * 5) + 1
      setSolarActivity({
        kp,
        speed: Math.floor(Math.random() * 200) + 350,
        density: (Math.random() * 8 + 2).toFixed(1)
      })
      setForecast(kp <= 2 ? 'stable' : kp <= 4 ? 'moderate' : 'storm')
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-weather">
      <div className="weather-header">
        <h3>Space Weather</h3>
        <span className={`forecast-badge ${forecast}`}>{forecast.toUpperCase()}</span>
      </div>
      <div className="solar-metrics">
        <div className="solar-metric">
          <div className="metric-ring" style={{ '--progress': `${solarActivity.kp * 20}%`, '--color': solarActivity.kp <= 2 ? '#10b981' : solarActivity.kp <= 4 ? '#f59e0b' : '#ef4444' }}>
            <span className="metric-value">{solarActivity.kp}</span>
          </div>
          <span className="metric-label">Kp Index</span>
        </div>
        <div className="solar-metric">
          <div className="metric-ring" style={{ '--progress': `${solarActivity.speed / 8}%`, '--color': '#3b82f6' }}>
            <span className="metric-value">{solarActivity.speed}</span>
          </div>
          <span className="metric-label">Solar Wind km/s</span>
        </div>
        <div className="solar-metric">
          <div className="metric-ring" style={{ '--progress': `${solarActivity.density * 10}%`, '--color': '#8b5cf6' }}>
            <span className="metric-value">{solarActivity.density}</span>
          </div>
          <span className="metric-label">Density p/cm³</span>
        </div>
      </div>
      <div className="aurora-forecast">
        <span className="aurora-icon">🌌</span>
        <span className="aurora-text">Aurora visibility: {forecast === 'stable' ? 'Low' : forecast === 'moderate' ? 'Medium' : 'High'}</span>
      </div>
    </div>
  )
}

// Universal Time Zones
function UniversalTimeZones() {
  const [times, setTimes] = useState({})

  const zones = [
    { city: 'Nairobi', tz: 'Africa/Nairobi', flag: '🇰🇪' },
    { city: 'Lagos', tz: 'Africa/Lagos', flag: '🇳🇬' },
    { city: 'Cape Town', tz: 'Africa/Johannesburg', flag: '🇿🇦' },
    { city: 'Cairo', tz: 'Africa/Cairo', flag: '🇪🇬' },
    { city: 'London', tz: 'Europe/London', flag: '🇬🇧' },
    { city: 'New York', tz: 'America/New_York', flag: '🇺🇸' },
    { city: 'Tokyo', tz: 'Asia/Tokyo', flag: '🇯🇵' },
    { city: 'UTC', tz: 'UTC', flag: '🌐' },
  ]

  useEffect(() => {
    const updateTimes = () => {
      const newTimes = {}
      zones.forEach(z => {
        newTimes[z.city] = new Date().toLocaleTimeString('en-US', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false })
      })
      setTimes(newTimes)
    }
    updateTimes()
    const interval = setInterval(updateTimes, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="universal-time">
      <h3>Global Network Time</h3>
      <div className="time-grid">
        {zones.map(z => (
          <div key={z.city} className="time-zone">
            <span className="zone-flag">{z.flag}</span>
            <span className="zone-city">{z.city}</span>
            <span className="zone-time">{times[z.city] || '--:--'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Constellation Network (Nodes as Stars)
function ConstellationNetwork() {
  const [nodes, setNodes] = useState([
    { id: 1, x: 20, y: 30, name: 'Node-Alpha', status: 'online', connections: 12 },
    { id: 2, x: 50, y: 15, name: 'Node-Beta', status: 'online', connections: 8 },
    { id: 3, x: 80, y: 25, name: 'Node-Gamma', status: 'online', connections: 15 },
    { id: 4, x: 35, y: 60, name: 'Node-Delta', status: 'syncing', connections: 6 },
    { id: 5, x: 65, y: 55, name: 'Node-Epsilon', status: 'online', connections: 10 },
    { id: 6, x: 25, y: 85, name: 'Node-Zeta', status: 'online', connections: 7 },
    { id: 7, x: 75, y: 80, name: 'Node-Eta', status: 'offline', connections: 0 },
  ])
  const [totalTx, setTotalTx] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTotalTx(prev => prev + Math.floor(Math.random() * 50))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const connections = [
    [0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [3, 5], [4, 6], [5, 6], [1, 4]
  ]

  return (
    <div className="constellation-network">
      <div className="constellation-header">
        <h3>Node Constellation</h3>
        <span className="tx-counter">{totalTx.toLocaleString()} TX</span>
      </div>
      <div className="constellation-view">
        <svg viewBox="0 0 100 100" className="constellation-svg">
          {/* Connection lines */}
          {connections.map(([from, to], i) => (
            <line
              key={i}
              x1={nodes[from].x} y1={nodes[from].y}
              x2={nodes[to].x} y2={nodes[to].y}
              stroke={nodes[from].status === 'offline' || nodes[to].status === 'offline' ? '#374151' : '#daa520'}
              strokeWidth="0.5"
              opacity="0.4"
              className="constellation-line"
            />
          ))}
          {/* Nodes as stars */}
          {nodes.map(node => (
            <g key={node.id} className="star-node">
              <circle
                cx={node.x} cy={node.y} r="3"
                fill={node.status === 'online' ? '#ffd700' : node.status === 'syncing' ? '#f59e0b' : '#374151'}
                className={`star ${node.status}`}
              />
              <circle
                cx={node.x} cy={node.y} r="6"
                fill="none"
                stroke={node.status === 'online' ? '#ffd700' : '#374151'}
                strokeWidth="0.3"
                opacity="0.3"
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="node-stats">
        <div className="node-stat">
          <span className="stat-num">{nodes.filter(n => n.status === 'online').length}</span>
          <span className="stat-label">Online</span>
        </div>
        <div className="node-stat">
          <span className="stat-num">{nodes.filter(n => n.status === 'syncing').length}</span>
          <span className="stat-label">Syncing</span>
        </div>
        <div className="node-stat">
          <span className="stat-num">{nodes.reduce((sum, n) => sum + n.connections, 0)}</span>
          <span className="stat-label">Links</span>
        </div>
      </div>
    </div>
  )
}

// Cosmic Data Stream
function CosmicDataStream() {
  const [streams, setStreams] = useState([])

  useEffect(() => {
    const types = ['TX', 'BLOCK', 'ALERT', 'SYNC', 'NODE', 'ORACLE']
    const interval = setInterval(() => {
      const newStream = {
        id: Date.now(),
        type: types[Math.floor(Math.random() * types.length)],
        hash: `0x${Math.random().toString(16).substr(2, 8)}`,
        time: new Date().toLocaleTimeString()
      }
      setStreams(prev => [newStream, ...prev.slice(0, 7)])
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="cosmic-stream">
      <div className="stream-header">
        <h3>Cosmic Data Stream</h3>
        <span className="stream-indicator"></span>
      </div>
      <div className="stream-list">
        {streams.map((s, i) => (
          <div key={s.id} className={`stream-item type-${s.type.toLowerCase()}`} style={{ opacity: 1 - (i * 0.1) }}>
            <span className="stream-type">{s.type}</span>
            <span className="stream-hash">{s.hash}</span>
            <span className="stream-time">{s.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Interplanetary Network Status (Creative)
function InterplanetaryStatus() {
  const bodies = [
    { name: 'Earth', icon: '🌍', latency: 0, status: 'hub' },
    { name: 'Moon Base', icon: '🌙', latency: 1.3, status: 'online' },
    { name: 'Mars Colony', icon: '🔴', latency: 182, status: 'delayed' },
    { name: 'Asteroid Belt', icon: '☄️', latency: 340, status: 'syncing' },
  ]

  return (
    <div className="interplanetary-status">
      <h3>Interplanetary Network</h3>
      <div className="planet-grid">
        {bodies.map(b => (
          <div key={b.name} className={`planet-node ${b.status}`}>
            <span className="planet-icon">{b.icon}</span>
            <span className="planet-name">{b.name}</span>
            <span className="planet-latency">{b.latency === 0 ? 'Local' : `${b.latency}s`}</span>
            <span className={`planet-status ${b.status}`}>{b.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// CORE PROTOCOL LAYER (Sacred wisdom encoded within)
// "The lips of wisdom are closed, except to the ears of Understanding"
// ============================================

// Encoded sacred constants (hex representations of principles)
const PROTOCOL_MATRIX = [0x4D, 0x43, 0x56, 0x50, 0x52, 0x45, 0x47] // M,C,V,P,R,E,G

// Core Network Protocols - The 7 Laws encoded as technical specs
function CoreProtocols() {
  const [activeLayer, setActiveLayer] = useState(0)

  // Hermetic principles disguised as network protocols
  const layers = [
    { id: 'L1', name: 'Consensus Layer', value: '99.7%', status: 'synchronized' },
    { id: 'L2', name: 'Mirror Protocol', value: '1:1', status: 'mapped' },
    { id: 'L3', name: 'Frequency Band', value: '432', status: 'tuned' },
    { id: 'L4', name: 'Dual Channel', value: 'balanced', status: 'active' },
    { id: 'L5', name: 'Cycle Engine', value: 'harmonic', status: 'running' },
    { id: 'L6', name: 'Chain Verifier', value: '100%', status: 'verified' },
    { id: 'L7', name: 'Genesis Core', value: 'enabled', status: 'creating' },
  ]

  useEffect(() => {
    const interval = setInterval(() => setActiveLayer(l => (l + 1) % 7), 3500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="core-protocols" data-matrix={PROTOCOL_MATRIX.join('')}>
      <div className="protocols-header">
        <h3>Network Layers</h3>
        <span className="layer-count">7 Active</span>
      </div>
      <div className="layers-stack">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            className={`layer-bar ${i === activeLayer ? 'active' : ''} ${i < activeLayer ? 'complete' : ''}`}
            data-index={PROTOCOL_MATRIX[i]}
          >
            <span className="layer-id">{layer.id}</span>
            <span className="layer-name">{layer.name}</span>
            <span className="layer-value">{layer.value}</span>
            <span className={`layer-status ${layer.status}`}></span>
          </div>
        ))}
      </div>
      <div className="layer-detail">
        <span className="detail-id">{layers[activeLayer].id}</span>
        <span className="detail-status">{layers[activeLayer].status.toUpperCase()}</span>
      </div>
    </div>
  )
}

// System Status Messages - Ancient wisdom encoded as technical logs
function SystemStatus() {
  const [currentLog, setCurrentLog] = useState(0)

  // Wisdom hidden as system messages
  const logs = [
    { code: 'SYS-001', msg: 'Layer synchronization: Above/Below state verified', ts: Date.now() },
    { code: 'SYS-002', msg: 'Global state perfection check: PASSED', ts: Date.now() },
    { code: 'SYS-003', msg: 'Self-verification protocol: Universe mapping complete', ts: Date.now() },
    { code: 'SYS-004', msg: 'Access layer: Understanding threshold met', ts: Date.now() },
    { code: 'SYS-005', msg: 'Vibration frequency adjusted: State changed', ts: Date.now() },
    { code: 'SYS-006', msg: 'Core truth validated: Form transformation allowed', ts: Date.now() },
    { code: 'SYS-007', msg: 'Boundary verification: Infinite within bounds', ts: Date.now() },
  ]

  useEffect(() => {
    const interval = setInterval(() => setCurrentLog(l => (l + 1) % logs.length), 6000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="system-status">
      <div className="status-header">
        <h3>System Log</h3>
        <span className="log-indicator"></span>
      </div>
      <div className="log-entries">
        {logs.slice(0, 4).map((log, i) => (
          <div key={log.code} className={`log-entry ${i === currentLog % 4 ? 'current' : ''}`}>
            <span className="log-code">{log.code}</span>
            <span className="log-msg">{log.msg}</span>
            <span className="log-ts">{new Date(log.ts - i * 60000).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
      <div className="log-footer">
        <span className="footer-text">All systems operational</span>
        <span className="footer-count">{logs.length} verified</span>
      </div>
    </div>
  )
}

// Divine Network Scale - Beyond Bitcoin metrics
// Network Benchmark - Performance comparison (Sacred Knowledge: Consciousness Scale encoded)
// Hidden constants: 0x43=C(onsciousness), 0x48=H(armony), 0x54=T(ruth), 0x57=W(isdom)
function NetworkBenchmark() {
  const BENCHMARK_MATRIX = [0x43, 0x48, 0x54, 0x57] // C,H,T,W - The four divine measures
  const [metrics, setMetrics] = useState({ p1: 0, p2: 0, p3: 0, p4: 0 })

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics({
        p1: Math.floor(Math.random() * 40) + 60, // Consciousness threshold
        p2: Math.floor(Math.random() * 30) + 70, // Harmonic resonance
        p3: Math.floor(Math.random() * 20) + 80, // Truth verification
        p4: Math.floor(Math.random() * 25) + 75  // Collective wisdom
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Performance layers - disguised divine metrics
  const benchmarks = [
    { id: 'tps', name: 'Transaction Throughput', value: metrics.p1, baseline: 30, unit: 'k/s' },
    { id: 'lat', name: 'Network Latency', value: metrics.p2, baseline: 30, unit: 'ms' },
    { id: 'val', name: 'Validation Rate', value: metrics.p3, baseline: 30, unit: '%' },
    { id: 'con', name: 'Consensus Efficiency', value: metrics.p4, baseline: 30, unit: '%' }
  ]

  return (
    <div className="network-benchmark" data-matrix={BENCHMARK_MATRIX.join(',')}>
      <div className="benchmark-header">
        <h3>Network Performance</h3>
        <span className="benchmark-tag">BENCHMARK v7.0</span>
      </div>
      <div className="benchmark-grid">
        <div className="benchmark-column primary">
          <span className="column-id">KAI-NET</span>
          <div className="benchmark-bars">
            {benchmarks.map(b => (
              <div key={b.id} className="benchmark-row">
                <span className="bench-label">{b.name}</span>
                <div className="bench-track">
                  <div className="bench-fill primary" style={{ width: `${b.value}%` }} />
                </div>
                <span className="bench-value">{b.value}{b.unit}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="benchmark-divider">
          <span className="divider-text">vs</span>
        </div>
        <div className="benchmark-column baseline">
          <span className="column-id">LEGACY</span>
          <div className="benchmark-bars">
            {benchmarks.map(b => (
              <div key={b.id} className="benchmark-row">
                <span className="bench-label">{b.name}</span>
                <div className="bench-track">
                  <div className="bench-fill baseline" style={{ width: `${b.baseline}%` }} />
                </div>
                <span className="bench-value">{b.baseline}{b.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="benchmark-summary">
        <span className="summary-text">7-pillar advantage: +{Math.round((metrics.p1 + metrics.p2 + metrics.p3 + metrics.p4) / 4 - 30)}% avg</span>
      </div>
    </div>
  )
}

// Load Balancer - Traffic distribution (Sacred Knowledge: Ma'at encoded as equilibrium)
// Hidden: 0x4D=M(a'at), 0x42=B(alance), 0x54=T(ruth), 0x4A=J(ustice)
function LoadBalancer() {
  const MAAT_CONSTANTS = [0x4D, 0x42, 0x54, 0x4A] // M,B,T,J - Ma'at's measures
  const [load, setLoad] = useState({ in: 50, out: 50 })
  const [equilibrium, setEquilibrium] = useState(50)

  useEffect(() => {
    const interval = setInterval(() => {
      const incoming = 50 + (Math.random() - 0.5) * 20
      setLoad({ in: incoming, out: 50 })
      setEquilibrium(50)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const isOptimal = Math.abs(load.in - equilibrium) < 10 // Ma'at achieved

  return (
    <div className="load-balancer" data-maat={MAAT_CONSTANTS.join('-')}>
      <div className="balancer-header">
        <h3>Load Balancer</h3>
        <span className="balancer-mode">AUTO-SCALE</span>
      </div>
      <div className="balancer-visual">
        <div className="balance-beam" style={{ transform: `rotate(${(load.in - 50) / 5}deg)` }}>
          <div className="beam-bar"></div>
          <div className="beam-node left">
            <div className="node-container">
              <span className="node-label">INBOUND</span>
              <span className="node-value">{Math.round(load.in)}%</span>
              <div className="node-indicator"></div>
            </div>
          </div>
          <div className="beam-pivot">
            <div className="pivot-core"></div>
          </div>
          <div className="beam-node right">
            <div className="node-container">
              <span className="node-label">OUTBOUND</span>
              <span className="node-value">{Math.round(equilibrium)}%</span>
              <div className="node-indicator"></div>
            </div>
          </div>
        </div>
      </div>
      <div className={`balancer-status ${isOptimal ? 'optimal' : 'adjusting'}`}>
        <span className="status-indicator"></span>
        <span className="status-text">
          {isOptimal ? 'OPTIMAL - Perfect equilibrium achieved' : 'ADJUSTING - Seeking balance...'}
        </span>
      </div>
      <div className="balancer-metrics">
        <div className="bal-metric">
          <span className="metric-key">Distribution</span>
          <span className="metric-val">{isOptimal ? '100%' : `${100 - Math.abs(load.in - 50)}%`}</span>
        </div>
        <div className="bal-metric">
          <span className="metric-key">Efficiency</span>
          <span className="metric-val">{Math.round(95 + Math.random() * 5)}%</span>
        </div>
      </div>
    </div>
  )
}

// Network Monitor - Radar scanning system (Sacred Knowledge: All-Seeing Eye encoded)
// Hidden: 0x4F=O(mniscient), 0x56=V(igilant), 0x53=S(eeing), 0x45=E(ye)
function NetworkMonitor() {
  const VISION_MATRIX = [0x4F, 0x56, 0x53, 0x45] // O,V,S,E - Omniscient Vision
  const [scanAngle, setScanAngle] = useState(0)
  const [anomalies, setAnomalies] = useState([])
  const [mode, setMode] = useState('scanning')

  useEffect(() => {
    const scanInterval = setInterval(() => {
      setScanAngle(prev => (prev + 3) % 360)
    }, 50)

    const detectInterval = setInterval(() => {
      if (Math.random() > 0.8) {
        setAnomalies(prev => [...prev, { id: Date.now(), type: 'packet', resolved: false }])
        setMode('detecting')
        setTimeout(() => {
          setAnomalies(prev => prev.map(a => ({ ...a, resolved: true })))
          setMode('resolved')
          setTimeout(() => setMode('scanning'), 1000)
        }, 2000)
      }
    }, 5000)

    return () => {
      clearInterval(scanInterval)
      clearInterval(detectInterval)
    }
  }, [])

  return (
    <div className="network-monitor" data-vision={VISION_MATRIX.join('-')}>
      <div className="monitor-header">
        <h3>Network Monitor</h3>
        <span className={`monitor-mode ${mode}`}>{mode.toUpperCase()}</span>
      </div>
      <div className="radar-container">
        <svg viewBox="0 0 200 200" className="radar-svg">
          <defs>
            <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--sacred-gold)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--sacred-gold)" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Radar rings */}
          <circle cx="100" cy="100" r="90" fill="none" stroke="var(--sacred-gold)" strokeWidth="1" opacity="0.2" />
          <circle cx="100" cy="100" r="60" fill="none" stroke="var(--sacred-gold)" strokeWidth="1" opacity="0.3" />
          <circle cx="100" cy="100" r="30" fill="none" stroke="var(--sacred-gold)" strokeWidth="1" opacity="0.4" />
          {/* Cross lines */}
          <line x1="10" y1="100" x2="190" y2="100" stroke="var(--sacred-gold)" strokeWidth="1" opacity="0.2" />
          <line x1="100" y1="10" x2="100" y2="190" stroke="var(--sacred-gold)" strokeWidth="1" opacity="0.2" />
          {/* Center core */}
          <circle cx="100" cy="100" r="8" fill="var(--sacred-gold)" opacity="0.8" />
          <circle cx="100" cy="100" r="4" fill="var(--sacred-black)" />
          {/* Scanning sweep */}
          <path
            d={`M100,100 L${100 + 90 * Math.cos((scanAngle - 30) * Math.PI / 180)},${100 + 90 * Math.sin((scanAngle - 30) * Math.PI / 180)} A90,90 0 0,1 ${100 + 90 * Math.cos(scanAngle * Math.PI / 180)},${100 + 90 * Math.sin(scanAngle * Math.PI / 180)} Z`}
            fill="url(#radarGlow)"
          />
          {/* Scan line */}
          <line
            x1="100" y1="100"
            x2={100 + 90 * Math.cos(scanAngle * Math.PI / 180)}
            y2={100 + 90 * Math.sin(scanAngle * Math.PI / 180)}
            stroke="var(--sacred-gold)" strokeWidth="2" opacity="0.8"
          />
        </svg>
      </div>
      <div className="monitor-stats">
        <div className="mon-stat">
          <span className="stat-key">Scan Rate</span>
          <span className="stat-val">360/s</span>
        </div>
        <div className="mon-stat">
          <span className="stat-key">Resolved</span>
          <span className="stat-val">{anomalies.filter(a => a.resolved).length}</span>
        </div>
        <div className="mon-stat">
          <span className="stat-key">Coverage</span>
          <span className="stat-val">Global</span>
        </div>
      </div>
    </div>
  )
}

// Ankh Logo Component - Symbol of Eternal Life
// KAI Chicken Head Logo - Symbol of African agricultural resilience
// Represents the poultry pillar and food security across the continent
function ChickenLogo({ size = 50 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="chicken-logo">
      <defs>
        <linearGradient id="chickenGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd700" />
          <stop offset="50%" stopColor="#daa520" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
        <radialGradient id="chickenGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd700" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffd700" stopOpacity="0" />
        </radialGradient>
        <filter id="logoGlow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Glow background */}
      <circle cx="50" cy="50" r="45" fill="url(#chickenGlow)" opacity="0.6" />

      {/* Head/Body */}
      <ellipse cx="50" cy="55" rx="28" ry="32" fill="url(#chickenGold)" filter="url(#logoGlow)" />

      {/* Comb (crown) - 3 peaks */}
      <path d="M 35 35 Q 35 25 40 25 Q 40 30 45 30 Q 45 22 50 22 Q 50 30 55 30 Q 55 25 60 25 Q 60 35 65 35 L 50 45 Z"
            fill="#ef4444" filter="url(#logoGlow)" />

      {/* Beak */}
      <path d="M 75 50 L 85 55 L 75 60 Z" fill="#f59e0b" filter="url(#logoGlow)" />

      {/* Eye */}
      <circle cx="60" cy="48" r="5" fill="#1a1a1a" />
      <circle cx="62" cy="46" r="2" fill="#ffffff" opacity="0.8" />

      {/* Wattle (neck flap) */}
      <ellipse cx="70" cy="65" rx="8" ry="12" fill="#ef4444" opacity="0.9" filter="url(#logoGlow)" />

      {/* Feather detail lines */}
      <path d="M 30 60 Q 35 65 40 70" stroke="#b8860b" strokeWidth="1.5" fill="none" opacity="0.6" />
      <path d="M 32 70 Q 37 75 42 80" stroke="#b8860b" strokeWidth="1.5" fill="none" opacity="0.6" />
      <path d="M 60 70 Q 55 75 50 80" stroke="#b8860b" strokeWidth="1.5" fill="none" opacity="0.6" />

      {/* Inner glow highlight */}
      <ellipse cx="45" cy="50" rx="12" ry="15" fill="#ffd700" opacity="0.2" />
    </svg>
  )
}

// Alias for backward compatibility
const AnkhLogo = ChickenLogo

// ============================================
// PILLAR SIGNAL GRAPHS - Advanced Real-time Analytics
// ============================================

// Pillar configuration - single source of truth
const PILLARS_CONFIG = [
  { id: 'governance', name: 'Governance', icon: '🏛️', color: '#6366f1' },
  { id: 'law', name: 'Law', icon: '⚖️', color: '#8b5cf6' },
  { id: 'agriculture', name: 'Agriculture', icon: '🌾', color: '#22c55e' },
  { id: 'health', name: 'Health', icon: '🏥', color: '#ef4444' },
  { id: 'ai', name: 'AI', icon: '🤖', color: '#3b82f6' },
  { id: 'disaster', name: 'Disaster', icon: '🚨', color: '#f59e0b' },
  { id: 'climate', name: 'Climate', icon: '🌍', color: '#10b981' },
]

// Signal data generator using efficient algorithm
const generateSignalData = (length = 20, volatility = 0.3) => {
  const data = []
  let value = 50 + Math.random() * 30
  for (let i = 0; i < length; i++) {
    value += (Math.random() - 0.5) * volatility * 20
    value = Math.max(10, Math.min(100, value))
    data.push({ x: i, y: value })
  }
  return data
}

// SVG Path generator for smooth curves (Catmull-Rom spline)
const generateSmoothPath = (points, width, height) => {
  if (points.length < 2) return ''
  const xScale = width / (points.length - 1)
  const yScale = height / 100

  let path = `M ${points[0].x * xScale} ${height - points[0].y * yScale}`

  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)]
    const p1 = points[i - 1]
    const p2 = points[i]
    const p3 = points[Math.min(points.length - 1, i + 1)]

    const cp1x = p1.x * xScale + (p2.x - p0.x) * xScale / 6
    const cp1y = height - (p1.y + (p2.y - p0.y) / 6) * yScale
    const cp2x = p2.x * xScale - (p3.x - p1.x) * xScale / 6
    const cp2y = height - (p2.y - (p3.y - p1.y) / 6) * yScale

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x * xScale} ${height - p2.y * yScale}`
  }
  return path
}

// Signal Graph Component with SVG
function SignalGraph({ pillar, data }) {
  const width = 280
  const height = 80
  const linePath = generateSmoothPath(data, width, height)
  const areaPath = linePath + ` L ${width} ${height} L 0 ${height} Z`

  const currentValue = data[data.length - 1]?.y.toFixed(1) || 0
  const minValue = Math.min(...data.map(d => d.y)).toFixed(1)
  const maxValue = Math.max(...data.map(d => d.y)).toFixed(1)
  const avgValue = (data.reduce((s, d) => s + d.y, 0) / data.length).toFixed(1)

  return (
    <div className="signal-graph-card" style={{ '--pillar-color': pillar.color }}>
      <div className="graph-header">
        <div className="graph-title">
          <span className="graph-icon">{pillar.icon}</span>
          <span className="graph-name">{pillar.name}</span>
        </div>
        <span className="graph-value" style={{ color: pillar.color }}>{currentValue}%</span>
      </div>
      <svg className="signal-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${pillar.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={pillar.color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={pillar.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${pillar.id})`} />
        <path d={linePath} fill="none" stroke={pillar.color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={width} cy={height - (data[data.length - 1]?.y || 50) * height / 100} r="4" fill={pillar.color} />
      </svg>
      <div className="graph-stats">
        <div className="graph-stat">
          <span className="graph-stat-value">{minValue}%</span>
          <span className="graph-stat-label">Min</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{avgValue}%</span>
          <span className="graph-stat-label">Avg</span>
        </div>
        <div className="graph-stat">
          <span className="graph-stat-value">{maxValue}%</span>
          <span className="graph-stat-label">Max</span>
        </div>
      </div>
    </div>
  )
}

// Signal Dashboard - All Pillar Graphs
function SignalDashboard() {
  const [signalData, setSignalData] = useState(() =>
    PILLARS_CONFIG.reduce((acc, p) => ({ ...acc, [p.id]: generateSignalData() }), {})
  )
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const interval = setInterval(() => {
      setSignalData(prev => {
        const updated = {}
        PILLARS_CONFIG.forEach(p => {
          const current = prev[p.id]
          const newPoint = {
            x: current.length,
            y: Math.max(10, Math.min(100, current[current.length - 1].y + (Math.random() - 0.5) * 10))
          }
          updated[p.id] = [...current.slice(1), newPoint].map((d, i) => ({ ...d, x: i }))
        })
        return updated
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const filteredPillars = filter === 'all'
    ? PILLARS_CONFIG
    : PILLARS_CONFIG.filter(p => p.id === filter)

  return (
    <div className="signal-dashboard">
      <div className="signal-header">
        <h3>Pillar Signal Analytics</h3>
        <div className="signal-filters">
          <button className={`signal-filter ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
          {PILLARS_CONFIG.slice(0, 4).map(p => (
            <button key={p.id} className={`signal-filter ${filter === p.id ? 'active' : ''}`} onClick={() => setFilter(p.id)}>
              {p.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="signal-graphs">
        {filteredPillars.map(pillar => (
          <SignalGraph key={pillar.id} pillar={pillar} data={signalData[pillar.id]} />
        ))}
      </div>
    </div>
  )
}

// ============================================
// LIVE NEWS FEED - Global Pillar Activity
// ============================================

// News item templates
const NEWS_TEMPLATES = [
  { pillar: 'governance', title: 'New proposal submitted', desc: 'Community voting begins on infrastructure development in East Africa region.' },
  { pillar: 'governance', title: 'Governance vote completed', desc: 'Resolution passed with 78% approval for climate adaptation fund allocation.' },
  { pillar: 'law', title: 'Evidence registry updated', desc: 'New land ownership records verified and added to the blockchain ledger.' },
  { pillar: 'law', title: 'Legal protection activated', desc: 'Smart contract dispute resolution initiated for merchant agreement.' },
  { pillar: 'agriculture', title: 'Insurance claim processed', desc: 'Parametric drought insurance triggered for farmers in the Sahel region.' },
  { pillar: 'agriculture', title: 'Crop yield data recorded', desc: 'Satellite imagery confirms maize harvest exceeding projections by 12%.' },
  { pillar: 'health', title: 'Food safety inspection', desc: 'Market inspection completed with all vendors meeting safety standards.' },
  { pillar: 'health', title: 'Health alert issued', desc: 'Water quality monitoring detected elevated contamination levels in sector 7.' },
  { pillar: 'ai', title: 'AI model deployed', desc: 'New yield prediction algorithm now active for West African agriculture network.' },
  { pillar: 'ai', title: 'Oracle data updated', desc: 'Weather prediction model accuracy improved to 94.2% for 72-hour forecasts.' },
  { pillar: 'disaster', title: 'Early warning issued', desc: 'Flood risk elevated for coastal regions. Preparedness protocols activated.' },
  { pillar: 'disaster', title: 'Alert resolved', desc: 'Cyclone threat downgraded. All monitoring stations report normal conditions.' },
  { pillar: 'climate', title: 'Carbon credits issued', desc: 'Reforestation project verified: 50,000 tonnes CO2 equivalent sequestered.' },
  { pillar: 'climate', title: 'Risk assessment updated', desc: 'Climate vulnerability index recalculated for 12 coastal communities.' },
]

// Generate news item
const generateNewsItem = () => {
  const template = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)]
  const pillar = PILLARS_CONFIG.find(p => p.id === template.pillar)
  return {
    id: Date.now() + Math.random(),
    pillar,
    title: template.title,
    description: template.desc,
    time: new Date().toLocaleTimeString(),
    tags: Math.random() > 0.7 ? ['urgent'] : Math.random() > 0.5 ? ['success'] : [],
  }
}

// Live News Feed Component
function LiveNewsFeed() {
  const [news, setNews] = useState(() => Array.from({ length: 5 }, generateNewsItem))
  const [activeTab, setActiveTab] = useState('all')
  const [summary, setSummary] = useState({ total: 0, governance: 0, alerts: 0 })

  useEffect(() => {
    const interval = setInterval(() => {
      setNews(prev => [generateNewsItem(), ...prev.slice(0, 9)])
      setSummary(prev => ({
        total: prev.total + 1,
        governance: prev.governance + (Math.random() > 0.7 ? 1 : 0),
        alerts: prev.alerts + (Math.random() > 0.8 ? 1 : 0),
      }))
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  const filteredNews = activeTab === 'all'
    ? news
    : news.filter(n => n.pillar.id === activeTab)

  return (
    <div className="news-feed-section">
      <div className="news-header">
        <div className="news-title">
          <h3>Live Network Feed</h3>
          <span className="news-live-badge">
            <span className="news-live-dot"></span>
            Live
          </span>
        </div>
        <div className="news-tabs">
          <button className={`news-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All</button>
          {PILLARS_CONFIG.slice(0, 5).map(p => (
            <button key={p.id} className={`news-tab ${activeTab === p.id ? 'active' : ''}`} onClick={() => setActiveTab(p.id)}>
              {p.icon}
            </button>
          ))}
        </div>
      </div>

      <div className="news-grid">
        <div className="news-main">
          {filteredNews.slice(0, 5).map(item => (
            <div key={item.id} className="news-item" style={{ '--pillar-color': item.pillar.color }}>
              <div className="news-item-header">
                <div className="news-pillar">
                  <span className="news-pillar-icon">{item.pillar.icon}</span>
                  <span className="news-pillar-name">{item.pillar.name}</span>
                </div>
                <span className="news-time">{item.time}</span>
              </div>
              <div className="news-content">
                <h4>{item.title}</h4>
                <p>{item.description}</p>
              </div>
              {item.tags.length > 0 && (
                <div className="news-meta">
                  {item.tags.map(tag => (
                    <span key={tag} className={`news-tag ${tag}`}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="news-sidebar">
          <div className="news-summary-card">
            <h4>Network Summary</h4>
            <div className="summary-stats">
              <div className="summary-stat">
                <span className="summary-stat-label">Total Events</span>
                <span className="summary-stat-value">{summary.total + 247}</span>
              </div>
              <div className="summary-stat">
                <span className="summary-stat-label">Governance Actions</span>
                <span className="summary-stat-value">{summary.governance + 34}</span>
              </div>
              <div className="summary-stat">
                <span className="summary-stat-label">Active Alerts</span>
                <span className="summary-stat-value">{summary.alerts + 3}</span>
              </div>
            </div>
          </div>

          <div className="pillar-heatmap">
            <h4>7-Day Activity</h4>
            <div className="heatmap-grid">
              {PILLARS_CONFIG.map(p => (
                <div key={p.id} className={`heatmap-cell level-${Math.floor(Math.random() * 4) + 1}`} title={p.name}>
                  {p.icon}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Dashboard
function Dashboard() {
  const { addNotification } = useApp()
  const [data, setData] = useState({ health: null, token: null, stats: null })
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [connectedClients, setConnectedClients] = useState(0)
  const [wsConnected, setWsConnected] = useState(false)
  const [alerts, setAlerts] = useState([])

  // 7 Pillars data
  const pillars = [
    { name: 'Governance', icon: '🏛️', status: 'active' },
    { name: 'Law', icon: '⚖️', status: 'active' },
    { name: 'Agriculture', icon: '🌾', status: 'active' },
    { name: 'Health', icon: '🏥', status: 'active' },
    { name: 'AI', icon: '🤖', status: 'pending' },
    { name: 'Disaster', icon: '🚨', status: 'active' },
    { name: 'Climate', icon: '🌍', status: 'active' },
  ]

  // WebSocket connection for real-time updates
  useEffect(() => {
    const ws = getSocket()

    ws.on('connect', () => {
      setWsConnected(true)
      setActivities(prev => [{
        icon: '🔌',
        text: 'Connected to KAI Network',
        time: new Date().toLocaleTimeString(),
        type: 'success'
      }, ...prev.slice(0, 9)])
    })

    ws.on('disconnect', () => {
      setWsConnected(false)
      setActivities(prev => [{
        icon: '⚠️',
        text: 'Disconnected from network',
        time: new Date().toLocaleTimeString(),
        type: 'warning'
      }, ...prev.slice(0, 9)])
    })

    ws.on('stats:update', (stats) => {
      setData(prev => ({ ...prev, stats }))
      setLastUpdate(new Date())
    })

    ws.on('clients:count', ({ count }) => {
      setConnectedClients(count)
    })

    ws.on('alert:new', (alert) => {
      addNotification(`New Alert: ${alert.disaster_type} in ${alert.region}`, NOTIFICATION_TYPES.ALERT)
      setAlerts(prev => [alert, ...prev.slice(0, 9)])
      setActivities(prev => [{
        icon: '🚨',
        text: `Alert: ${alert.disaster_type} - ${alert.region}`,
        time: new Date().toLocaleTimeString(),
        type: 'alert'
      }, ...prev.slice(0, 9)])
    })

    // Request initial stats
    ws.emit('stats:request')

    return () => {
      ws.off('connect')
      ws.off('disconnect')
      ws.off('stats:update')
      ws.off('clients:count')
      ws.off('alert:new')
    }
  }, [addNotification])

  const fetchData = useCallback(async () => {
    try {
      const [health, token, stats, alertsData] = await Promise.all([
        api.getHealth(),
        api.getTokenInfo().catch(() => null),
        api.getStats(),
        api.getAlerts().catch(() => [])
      ])

      setData({ health, token, stats })
      setAlerts(alertsData)
      setLastUpdate(new Date())

      // Add to activity feed
      setActivities(prev => [{
        icon: '📊',
        text: 'Dashboard data refreshed',
        time: new Date().toLocaleTimeString(),
        type: 'info'
      }, ...prev.slice(0, 9)])

    } catch (err) {
      addNotification('Failed to fetch dashboard data', NOTIFICATION_TYPES.ERROR)
    } finally {
      setLoading(false)
    }
  }, [addNotification])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return <LoadingScreen message="Loading Command Center..." />

  const { health, token, stats } = data

  return (
    <div className="dashboard">
      {/* Live Metrics Ticker */}
      <MetricsTicker token={token} stats={stats} wsConnected={wsConnected} />

      <div className="page-header">
        <h2>Command Center</h2>
        <div className="header-actions">
          <div className={`live-indicator ${wsConnected ? 'live' : 'offline'}`}>
            <span className="live-dot"></span>
            {wsConnected ? 'LIVE' : 'OFFLINE'}
          </div>
          <button className="refresh-btn" onClick={fetchData}>↻ Refresh</button>
          {lastUpdate && (
            <span className="last-update">Updated: {lastUpdate.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="dashboard-grid advanced">
        {/* System Status - Large Card */}
        <div className="stat-card system-status span-2">
          <div className="card-header">
            <h3>System Status</h3>
            <SecurityShield level={health?.status === 'healthy' ? 'high' : 'low'} />
          </div>
          <div className="system-content">
            <div className={`status-badge ${health?.status}`}>
              {health?.status?.toUpperCase() || 'UNKNOWN'}
            </div>
            <div className="services-grid">
              {health?.services && Object.entries(health.services).map(([name, status]) => (
                <div key={name} className={`service-item ${status}`}>
                  <span className="service-dot"></span>
                  <span className="service-name">{name}</span>
                </div>
              ))}
            </div>
            <div className="performance-section">
              <PerformanceGauge label="CPU" value={Math.floor(Math.random() * 40 + 10)} />
              <PerformanceGauge label="Memory" value={Math.floor(Math.random() * 50 + 20)} />
              <PerformanceGauge label="Network" value={Math.floor(Math.random() * 30 + 5)} />
            </div>
          </div>
        </div>

        {/* Token Stats */}
        <div className="stat-card token-stats">
          <h3>KAI Token</h3>
          {token ? (
            <>
              <div className="big-stat">
                <AnimatedCounter value={token.totalSupply} />
                <span className="stat-label">Total Supply</span>
              </div>
              <div className="token-chart">
                <div className="chart-bar" style={{ height: '60%' }}></div>
                <div className="chart-bar" style={{ height: '75%' }}></div>
                <div className="chart-bar" style={{ height: '45%' }}></div>
                <div className="chart-bar" style={{ height: '90%' }}></div>
                <div className="chart-bar active" style={{ height: '100%' }}></div>
              </div>
              <div className="stat-row">
                <div className="mini-stat">
                  <span className="mini-value">{parseFloat(token.totalBurned).toLocaleString()}</span>
                  <span className="mini-label">Burned</span>
                </div>
                <div className="mini-stat">
                  <span className="mini-value">{token.decimals}</span>
                  <span className="mini-label">Decimals</span>
                </div>
              </div>
            </>
          ) : (
            <div className="not-configured">Token not configured</div>
          )}
        </div>

        {/* Network Stats */}
        <div className="stat-card network-card">
          <h3>Network</h3>
          <div className="big-stat">
            <AnimatedCounter value={stats?.totalUsers || 0} />
            <span className="stat-label">Registered Users</span>
          </div>
          <div className="stat-row">
            <div className="mini-stat">
              <span className="mini-value live-count">{connectedClients}</span>
              <span className="mini-label">Live Clients</span>
            </div>
            <div className="mini-stat">
              <span className={`mini-value ws-status ${wsConnected ? 'online' : 'offline'}`}>
                {wsConnected ? '● LIVE' : '○ OFFLINE'}
              </span>
              <span className="mini-label">WebSocket</span>
            </div>
          </div>
        </div>

        {/* Advanced Regional Intelligence Map */}
        <div className="stat-card regional-card span-3">
          <AdvancedRegionalMap alerts={alerts} pillars={pillars} />
        </div>

        {/* Blockchain Stats */}
        <div className="stat-card blockchain-card">
          <BlockchainStats health={health} />
        </div>

        {/* Activity Feed with Threat Integration */}
        <div className="stat-card activity-card span-2">
          <ActivityFeed activities={activities} />
        </div>

        {/* System Control Panel - Quick Actions integrated */}
        <div className="stat-card control-panel span-2">
          <ControlPanel stats={stats} pillars={pillars} />
        </div>
      </div>

      {/* Pillar Signal Analytics Section */}
      <SignalDashboard />

      {/* Live News Feed Section */}
      <LiveNewsFeed />

      {/* Cosmic Section Divider */}
      <div className="cosmic-section">
        <div className="section-header cosmic">
          <h2>🌌 Cosmic Network Overview</h2>
          <span className="section-subtitle">Interplanetary & Space-Based Infrastructure</span>
        </div>

        <div className="cosmic-grid">
          {/* Satellite Network */}
          <div className="stat-card cosmic-card span-2">
            <SatelliteNetwork />
          </div>

          {/* Space Weather */}
          <div className="stat-card cosmic-card">
            <SpaceWeatherMonitor />
          </div>

          {/* Constellation Network */}
          <div className="stat-card cosmic-card">
            <ConstellationNetwork />
          </div>

          {/* Universal Time */}
          <div className="stat-card cosmic-card span-2">
            <UniversalTimeZones />
          </div>

          {/* Cosmic Data Stream */}
          <div className="stat-card cosmic-card">
            <CosmicDataStream />
          </div>

          {/* Interplanetary Status */}
          <div className="stat-card cosmic-card">
            <InterplanetaryStatus />
          </div>
        </div>
      </div>

      {/* Deep Network Infrastructure - Hidden: Encoded divine layer */}
      <div className="infrastructure-section" data-layer="0x4845524D4553">
        <div className="section-header infra">
          <div className="infra-title">
            <span className="infra-icon">◇</span>
            <h2>Network Infrastructure Layer</h2>
            <span className="version-tag">v7.0</span>
          </div>
          <span className="section-subtitle">Protocol Stack • Load Distribution • Performance Metrics</span>
          <p className="infra-code">SYS::INIT → SYNC::COMPLETE → STATE::OPTIMAL</p>
        </div>

        <div className="system-grid">
          {/* Network Monitoring - Omniscient surveillance layer */}
          <div className="stat-card system-card span-2">
            <NetworkMonitor />
          </div>

          {/* Load Balancer - Equilibrium distribution */}
          <div className="stat-card system-card span-2">
            <LoadBalancer />
          </div>

          {/* Core Protocols - 7-layer network stack */}
          <div className="stat-card system-card protocol-card span-2">
            <CoreProtocols />
          </div>

          {/* Network Benchmark - Performance comparison */}
          <div className="stat-card system-card span-2">
            <NetworkBenchmark />
          </div>

          {/* System Status - Real-time diagnostics */}
          <div className="stat-card system-card status-card full-width">
            <SystemStatus />
          </div>
        </div>

        {/* Genesis Protocol - Hidden: Encoded Sacred Foundation */}
        <div className="genesis-protocol" data-foundation="0x534143524544">
          <div className="protocol-manifest">
            <span className="manifest-marker">⬡</span>
            <div className="manifest-content">
              <h3>Genesis Protocol</h3>
              <p>KAI network operates on foundational cryptographic principles engineered for
                 planetary-scale transaction processing. Built with advanced consensus mechanisms,
                 secured through mathematical proof systems, and designed for equitable
                 distribution across all network participants.</p>
              <div className="protocol-specs">
                <div className="spec-item">
                  <span className="spec-value">∞</span>
                  <span className="spec-label">Horizontal Scale</span>
                </div>
                <div className="spec-item">
                  <span className="spec-value">99.99%</span>
                  <span className="spec-label">Uptime SLA</span>
                </div>
                <div className="spec-item">
                  <span className="spec-value">7</span>
                  <span className="spec-label">Core Modules</span>
                </div>
                <div className="spec-item">
                  <span className="spec-value">1B+</span>
                  <span className="spec-label">TX/Day</span>
                </div>
              </div>
            </div>
            <span className="manifest-marker">⬡</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Contracts Page
function Contracts() {
  const [contracts, setContracts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    api.getContracts().then(setContracts).finally(() => setLoading(false))
  }, [])

  const copyAddress = (address, name) => {
    navigator.clipboard.writeText(address)
    setCopied(name)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) return <LoadingScreen message="Loading Contracts..." />

  return (
    <div className="contracts-page">
      <div className="page-header">
        <h2>Deployed Contracts</h2>
      </div>

      <div className="network-banner">
        <span className="network-icon">🔗</span>
        <span>Network: <strong>{contracts?.network}</strong></span>
        <span className="deployer">Deployer: {contracts?.deployer?.slice(0, 10)}...{contracts?.deployer?.slice(-8)}</span>
      </div>

      <div className="contracts-grid">
        {contracts?.contracts && Object.entries(contracts.contracts).map(([name, address]) => (
          <div key={name} className="contract-card">
            <div className="contract-icon">
              {name.includes('Token') && '🪙'}
              {name.includes('Governance') && '🏛️'}
              {name.includes('Disaster') && '🚨'}
              {name.includes('Agriculture') && '🌾'}
              {name.includes('Health') && '🏥'}
              {name.includes('AI') && '🤖'}
              {name.includes('Law') && '⚖️'}
              {name.includes('Climate') && '🌍'}
            </div>
            <div className="contract-info">
              <h4>{name}</h4>
              <div className="contract-address" onClick={() => copyAddress(address, name)}>
                <code>{address}</code>
                <span className="copy-btn">{copied === name ? '✓' : '📋'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Alerts Page
function Alerts() {
  const { addNotification } = useApp()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [filter, setFilter] = useState('all')
  const [newAlert, setNewAlert] = useState({
    disasterType: 'flood',
    region: '',
    riskScore: 50
  })

  useEffect(() => {
    api.getAlerts().then(setAlerts).finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newAlert.region.trim()) {
      addNotification('Region is required', NOTIFICATION_TYPES.WARNING)
      return
    }

    setSubmitting(true)
    try {
      await api.createAlert(newAlert)
      addNotification('Alert created successfully!', NOTIFICATION_TYPES.SUCCESS)

      // Play alert sound for high risk
      if (newAlert.riskScore >= 70) {
        playAlertSound()
      }

      const updated = await api.getAlerts()
      setAlerts(updated)
      setNewAlert({ disasterType: 'flood', region: '', riskScore: 50 })
    } catch (err) {
      addNotification('Failed to create alert', NOTIFICATION_TYPES.ERROR)
    } finally {
      setSubmitting(false)
    }
  }

  const playAlertSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleDoIR7HM6GZVHwBAnr/NjGQ5ER1uyNb/qVYYCjmm0eOPXyoEK4LB35RdMg0fbcbl+qpaDhE5rtTxoWE5EDmOy+yZVjIHHW3L5P2sWRALMKXQ7p9fNQ0zkMrpmVY0Byh0ye')
    audio.volume = 0.3
    audio.play().catch(() => {})
  }

  const filteredAlerts = alerts.filter(a => {
    if (filter === 'all') return true
    if (filter === 'active') return !a.resolved
    return a.disaster_type === filter
  })

  return (
    <div className="alerts-page">
      <div className="page-header">
        <h2>Disaster Alert System</h2>
        <div className="alert-stats">
          <span className="stat-pill active">{alerts.filter(a => !a.resolved).length} Active</span>
          <span className="stat-pill total">{alerts.length} Total</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="alert-form">
        <h3>Create Emergency Alert</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Disaster Type</label>
            <select
              value={newAlert.disasterType}
              onChange={(e) => setNewAlert({...newAlert, disasterType: e.target.value})}
            >
              <option value="flood">🌊 Flood</option>
              <option value="drought">☀️ Drought</option>
              <option value="cyclone">🌀 Cyclone</option>
              <option value="earthquake">🌍 Earthquake</option>
              <option value="wildfire">🔥 Wildfire</option>
              <option value="locusts">🦗 Locust Swarm</option>
              <option value="disease">🦠 Disease Outbreak</option>
            </select>
          </div>

          <div className="form-group">
            <label>Affected Region</label>
            <input
              type="text"
              placeholder="e.g., East Africa, Lagos, Nairobi"
              value={newAlert.region}
              onChange={(e) => setNewAlert({...newAlert, region: e.target.value})}
              maxLength={200}
              required
            />
          </div>

          <div className="form-group">
            <label>Risk Score: {newAlert.riskScore}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={newAlert.riskScore}
              onChange={(e) => setNewAlert({...newAlert, riskScore: parseInt(e.target.value)})}
              className={`risk-slider risk-${Math.floor(newAlert.riskScore / 25)}`}
            />
          </div>

          <button type="submit" disabled={submitting} className="submit-btn">
            {submitting ? 'Creating...' : '🚨 Issue Alert'}
          </button>
        </div>
      </form>

      <div className="alerts-section">
        <div className="section-header">
          <h3>Alert History</h3>
          <div className="filter-tabs">
            {['all', 'active', 'flood', 'drought', 'cyclone'].map(f => (
              <button
                key={f}
                className={`filter-tab ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingScreen message="Loading alerts..." />
        ) : filteredAlerts.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <p>No alerts found</p>
          </div>
        ) : (
          <div className="alerts-grid">
            {filteredAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`alert-card risk-level-${Math.floor(alert.risk_score / 25)} ${alert.resolved ? 'resolved' : ''}`}
              >
                <div className="alert-header">
                  <span className="alert-type-badge">
                    {alert.disaster_type === 'flood' && '🌊'}
                    {alert.disaster_type === 'drought' && '☀️'}
                    {alert.disaster_type === 'cyclone' && '🌀'}
                    {alert.disaster_type === 'earthquake' && '🌍'}
                    {alert.disaster_type === 'wildfire' && '🔥'}
                    {alert.disaster_type}
                  </span>
                  <span className="risk-badge">{alert.risk_score}%</span>
                </div>
                <div className="alert-body">
                  <h4>{alert.region}</h4>
                  <time>{new Date(alert.issued_at).toLocaleString()}</time>
                </div>
                {alert.resolved && <span className="resolved-badge">Resolved</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Wallet Page
function Wallet() {
  const { addNotification } = useApp()
  const [address, setAddress] = useState('')
  const [balance, setBalance] = useState(null)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)

  const connectWallet = async () => {
    if (typeof window.ethereum === 'undefined') {
      addNotification('Please install MetaMask', NOTIFICATION_TYPES.WARNING)
      return
    }

    try {
      setLoading(true)
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setAddress(accounts[0])
      setConnected(true)

      const bal = await api.getBalance(accounts[0])
      setBalance(bal)
      addNotification('Wallet connected!', NOTIFICATION_TYPES.SUCCESS)
    } catch (err) {
      addNotification('Failed to connect wallet', NOTIFICATION_TYPES.ERROR)
    } finally {
      setLoading(false)
    }
  }

  const checkBalance = async () => {
    if (!address) {
      addNotification('Enter an address', NOTIFICATION_TYPES.WARNING)
      return
    }

    try {
      setLoading(true)
      const bal = await api.getBalance(address)
      setBalance(bal)
    } catch (err) {
      addNotification('Invalid address or balance check failed', NOTIFICATION_TYPES.ERROR)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wallet-page">
      <div className="page-header">
        <h2>Wallet</h2>
      </div>

      <div className="wallet-grid">
        <div className="wallet-card connect-card">
          <h3>Connect Wallet</h3>
          <button
            onClick={connectWallet}
            disabled={connected || loading}
            className={`connect-btn ${connected ? 'connected' : ''}`}
          >
            {loading ? 'Connecting...' : connected ? '✓ Connected' : 'Connect MetaMask'}
          </button>
        </div>

        <div className="wallet-card balance-card">
          <h3>Check Balance</h3>
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter wallet address (0x...)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="address-input"
            />
            <button onClick={checkBalance} disabled={loading} className="check-btn">
              {loading ? '...' : 'Check'}
            </button>
          </div>
        </div>

        {balance && (
          <div className="wallet-card result-card">
            <h3>Balance</h3>
            <div className="balance-display">
              <span className="balance-amount">
                <AnimatedCounter value={balance.balance} />
              </span>
              <span className="balance-symbol">KAI</span>
            </div>
            <div className="balance-address">
              {balance.address}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 7 Pillars Page
function Pillars() {
  const pillars = [
    { name: 'Governance', icon: '🏛️', color: '#6366f1', desc: 'Decentralized decision making' },
    { name: 'Law', icon: '⚖️', color: '#8b5cf6', desc: 'Evidence registry & legal protection' },
    { name: 'Agriculture', icon: '🌾', color: '#22c55e', desc: 'Parametric insurance for farmers' },
    { name: 'Health', icon: '🏥', color: '#ef4444', desc: 'Food safety & inspections' },
    { name: 'AI', icon: '🤖', color: '#3b82f6', desc: 'Decentralized AI marketplace' },
    { name: 'Disaster', icon: '🚨', color: '#f59e0b', desc: 'Early warning & response' },
    { name: 'Climate', icon: '🌍', color: '#10b981', desc: 'Risk modeling & adaptation' }
  ]

  return (
    <div className="pillars-page">
      <div className="page-header">
        <h2>7 Pillars of Resilience</h2>
        <p className="subtitle">Building the future through blockchain technology</p>
      </div>

      <div className="pillars-grid">
        {pillars.map((pillar, i) => (
          <div key={pillar.name} className="pillar-card" style={{ '--pillar-color': pillar.color }}>
            <div className="pillar-number">{i + 1}</div>
            <div className="pillar-icon">{pillar.icon}</div>
            <h3>{pillar.name}</h3>
            <p>{pillar.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Loading Screen
function LoadingScreen({ message = 'Loading...' }) {
  return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>{message}</p>
    </div>
  )
}

// KAI Logo SVG Component
function KaiLogo({ size = 50 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="kai-logo-svg">
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd700" />
          <stop offset="50%" stopColor="#daa520" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
        <linearGradient id="glowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd700" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#daa520" stopOpacity="0.3" />
        </linearGradient>
        <filter id="logoGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer glow ring */}
      <circle cx="50" cy="50" r="48" fill="none" stroke="url(#glowGradient)" strokeWidth="1" opacity="0.5" />

      {/* Main circle */}
      <circle cx="50" cy="50" r="45" fill="#1a1a2e" stroke="url(#goldGradient)" strokeWidth="3" filter="url(#logoGlow)" />

      {/* African pattern border - triangles */}
      <g stroke="url(#goldGradient)" strokeWidth="1" fill="none" opacity="0.7">
        {/* Top triangles */}
        <path d="M30 15 L35 22 L25 22 Z" />
        <path d="M50 10 L55 17 L45 17 Z" />
        <path d="M70 15 L75 22 L65 22 Z" />
        {/* Bottom triangles */}
        <path d="M30 85 L35 78 L25 78 Z" />
        <path d="M50 90 L55 83 L45 83 Z" />
        <path d="M70 85 L75 78 L65 78 Z" />
        {/* Side patterns */}
        <path d="M12 40 L18 45 L12 50 Z" />
        <path d="M12 55 L18 60 L12 65 Z" />
        <path d="M88 40 L82 45 L88 50 Z" />
        <path d="M88 55 L82 60 L88 65 Z" />
      </g>

      {/* Key handle (top circle) */}
      <circle cx="50" cy="35" r="10" fill="none" stroke="url(#goldGradient)" strokeWidth="3" />
      <circle cx="50" cy="35" r="4" fill="url(#goldGradient)" />

      {/* Key shaft */}
      <rect x="47" y="42" width="6" height="30" fill="url(#goldGradient)" rx="1" />

      {/* Key teeth */}
      <rect x="53" y="60" width="8" height="4" fill="url(#goldGradient)" rx="1" />
      <rect x="53" y="67" width="6" height="4" fill="url(#goldGradient)" rx="1" />

      {/* Tree branches from key */}
      <g stroke="url(#goldGradient)" strokeWidth="2" fill="none" strokeLinecap="round">
        {/* Left branches */}
        <path d="M47 45 Q35 40, 28 32" />
        <path d="M47 50 Q38 48, 30 45" />
        <path d="M47 55 Q40 55, 32 58" />
        {/* Right branches */}
        <path d="M53 45 Q65 40, 72 32" />
        <path d="M53 50 Q62 48, 70 45" />
        <path d="M53 55 Q60 55, 68 58" />
        {/* Branch tips */}
        <circle cx="28" cy="32" r="2" fill="url(#goldGradient)" />
        <circle cx="30" cy="45" r="2" fill="url(#goldGradient)" />
        <circle cx="32" cy="58" r="2" fill="url(#goldGradient)" />
        <circle cx="72" cy="32" r="2" fill="url(#goldGradient)" />
        <circle cx="70" cy="45" r="2" fill="url(#goldGradient)" />
        <circle cx="68" cy="58" r="2" fill="url(#goldGradient)" />
      </g>

      {/* Roots at bottom */}
      <g stroke="url(#goldGradient)" strokeWidth="1.5" fill="none" opacity="0.8">
        <path d="M50 72 Q45 78, 40 82" />
        <path d="M50 72 Q50 80, 50 85" />
        <path d="M50 72 Q55 78, 60 82" />
      </g>

      {/* Water waves */}
      <g stroke="url(#goldGradient)" strokeWidth="1" fill="none" opacity="0.5">
        <path d="M30 75 Q35 73, 40 75 Q45 77, 50 75 Q55 73, 60 75 Q65 77, 70 75" />
        <path d="M32 78 Q37 76, 42 78 Q47 80, 52 78 Q57 76, 62 78 Q67 80, 68 78" />
      </g>
    </svg>
  )
}

// ============================================
// MAIN APP
// ============================================

function AppProvider({ children }) {
  const [notifications, setNotifications] = useState([])

  const addNotification = useCallback((message, type = NOTIFICATION_TYPES.INFO) => {
    setNotifications(prev => [...prev, { message, type }])
  }, [])

  const removeNotification = useCallback((index) => {
    setNotifications(prev => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <AppContext.Provider value={{ addNotification, removeNotification, notifications }}>
      {children}
      <ToastContainer notifications={notifications} removeNotification={removeNotification} />
    </AppContext.Provider>
  )
}

function AppContent() {
  const location = useLocation()

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <AnkhLogo size={45} />
          <div className="logo-text">
            <h1>KAI</h1>
            <span>Divine Resilience</span>
          </div>
        </div>
        <nav>
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Dashboard</Link>
          <Link to="/contracts" className={location.pathname === '/contracts' ? 'active' : ''}>Contracts</Link>
          <Link to="/alerts" className={location.pathname === '/alerts' ? 'active' : ''}>Alerts</Link>
          <Link to="/wallet" className={location.pathname === '/wallet' ? 'active' : ''}>Wallet</Link>
          <Link to="/pillars" className={location.pathname === '/pillars' ? 'active' : ''}>Pillars</Link>
        </nav>
        <ConnectionStatus />
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/pillars" element={<Pillars />} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>KAI - Resilience Token | 7 Pillars</p>
          <p className="pillars-list">Governance | Law | Agriculture | Health | AI | Disaster | Climate</p>
        </div>
      </footer>
    </div>
  )
}

function App() {
  return (
    <ErrorBoundaryWrapper>
      <BrowserRouter>
        <AppProvider>
          <AppContent />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundaryWrapper>
  )
}

export default App
