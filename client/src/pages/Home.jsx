import React, { useState, useEffect } from 'react';
import {
  Video, Calendar, Plus, LogIn, Clock, Users, Moon, Sun,
  Trash2, ExternalLink, Shield, Lock, UserCheck, Copy, Check,
  Sparkles, Zap, Globe, MessageSquare
} from 'lucide-react';
import './Home.css';

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
const api = (p) => `${API_BASE}${p}`;

const Home = () => {
  // ✨ moved inside the component
  const meetingsRef = React.useRef(null);

  const [meetingId, setMeetingId] = useState('');
  const [userName, setUserName] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showMeetings, setShowMeetings] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    date: '',
    time: '',
    requiresApproval: true,
    password: '',
  });

  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [stats, setStats] = useState({ totalMeetings: 0, upcomingMeetings: 0 });

  // post-create flow (unchanged)
  const [createdMeeting, setCreatedMeeting] = useState(null); // { id, url }
  const [showStartModal, setShowStartModal] = useState(false);
  const [permState, setPermState] = useState({ cam: false, mic: false, testing: false, error: '' });

  // ---------------------------
  // Init
  // ---------------------------
  useEffect(() => {
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);

    const savedName = (localStorage.getItem('userName') || '').trim();
    if (savedName) {
      setUserName(savedName);
      setIsSignedIn(true);
    }

    fetchScheduledMeetings();
    loadStats();
  }, []);

  // when "My Meetings" panel opens, scroll it into view
  useEffect(() => {
    if (showMeetings) {
      // wait for DOM paint
      setTimeout(() => {
        meetingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [showMeetings]);

  // also scroll after meetings load while the panel is open
  useEffect(() => {
    if (showMeetings) {
      meetingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scheduledMeetings, showMeetings]);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode);
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const loadStats = () => {
    const total = parseInt(localStorage.getItem('totalMeetingsCreated') || '0', 10);
    setStats({ totalMeetings: total, upcomingMeetings: scheduledMeetings.length });
  };

  const fetchScheduledMeetings = async () => {
    try {
      const res = await fetch(api('/api/meetings/upcoming'));
      const data = await res.json();
      if (data?.ok) {
        const list = (data.meetings || []).map((m) => ({
          _id: m._id,
          title: m.title || 'Untitled Meeting',
          meetingId: m.meetingId,
          date: m.scheduledFor ? new Date(m.scheduledFor).toLocaleDateString() : '—',
          time: m.scheduledFor
            ? new Date(m.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—',
          password: m.password || '',
          requiresApproval: m.requiresApproval !== false,
          createdBy: m.createdBy || 'Unknown',
        }));
        setScheduledMeetings(list);
        setStats((prev) => ({ ...prev, upcomingMeetings: list.length }));
      }
    } catch (e) {
      console.error('Error fetching meetings:', e);
    }
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  };

  const parseMeetingIdOrLink = (value) => {
    const v = (value || '').trim();
    if (!v) return '';
    try {
      const u = new URL(v);
      // expect /room/:id
      const parts = u.pathname.split('/');
      return parts[1] === 'room' ? parts[2] : v;
    } catch {
      return v; // not a URL, assume ID
    }
  };

  const getTimeUntilMeeting = (date, time) => {
    const meetingDate = new Date(`${date} ${time}`);
    const now = new Date();
    const diff = meetingDate - now;

    if (diff < 0) return 'Past';
    if (diff < 3600000) return 'Starting soon';
    if (diff < 86400000) return 'Today';
    if (diff < 172800000) return 'Tomorrow';

    const days = Math.floor(diff / 86400000);
    return `In ${days} day${days > 1 ? 's' : ''}`;
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showNotification('Link copied!', 'success');
    } catch {
      showNotification('Copy failed. Please copy manually.', 'error');
    }
  };

  const testPermissions = async () => {
    setPermState((p) => ({ ...p, testing: true, error: '' }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermState({ cam: true, mic: true, testing: false, error: '' });
      showNotification('Camera & Microphone are accessible', 'success');
    } catch (err) {
      setPermState({ cam: false, mic: false, testing: false, error: err?.name || 'Permission denied' });
      showNotification('Please allow camera & mic to continue', 'error');
    }
  };

  const enterAsHost = () => {
    if (!createdMeeting) return;
    window.location.href = createdMeeting.url;
  };

  // ---------------------------
  // Actions
  // ---------------------------
  const requireSignedInName = () => {
    const n = (localStorage.getItem('userName') || userName || '').trim();
    if (!n) {
      showNotification('Please sign in first', 'error');
      setShowSignIn(true);
      return null;
    }
    localStorage.setItem('userName', n);
    setIsSignedIn(true);
    setUserName(n);
    return n;
  };

  const handleCreateMeeting = async () => {
    const n = requireSignedInName();
    if (!n) return;

    setLoading(true);
    try {
      const res = await fetch(api('/api/meetings/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': n, // required by server
        },
        body: JSON.stringify({
          title: `${n}'s Meeting`,
          requiresApproval: false,
        }),
      }).then((r) => r.json());

      if (!res?.ok) throw new Error(res?.error || 'Failed to create meeting');

      const total = parseInt(localStorage.getItem('totalMeetingsCreated') || '0', 10) + 1;
      localStorage.setItem('totalMeetingsCreated', total);

      showNotification('Meeting created successfully!', 'success');

      // Show share/permission modal instead of immediate redirect
      const url = `${window.location.origin}/room/${res.meetingId}?name=${encodeURIComponent(n)}&admin=true`;
      setCreatedMeeting({ id: res.meetingId, url });
      setShowStartModal(true);
    } catch (e) {
      console.error(e);
      showNotification(e.message || 'Could not create meeting. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinMeeting = () => {
    const id = parseMeetingIdOrLink(meetingId);
    const n = (userName || '').trim();

    if (!id || !n) {
      showNotification('Please enter both meeting ID and your name', 'error');
      return;
    }
    localStorage.setItem('userName', n);
    window.location.href = `/room/${id}?name=${encodeURIComponent(n)}`;
  };

  const handleScheduleMeeting = async () => {
    const n = requireSignedInName();
    if (!n) return;

    if (!scheduleForm.title || !scheduleForm.date || !scheduleForm.time) {
      showNotification('Please fill all required fields', 'error');
      return;
    }

    setLoading(true);
    const scheduledFor = new Date(`${scheduleForm.date}T${scheduleForm.time}:00`);

    if (scheduledFor < new Date()) {
      showNotification('Please select a future date and time', 'error');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(api('/api/meetings/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': n, // required by server
        },
        body: JSON.stringify({
          title: scheduleForm.title,
          scheduledFor,
          requiresApproval: !!scheduleForm.requiresApproval,
          password: scheduleForm.password || '',
        }),
      }).then((r) => r.json());

      if (res?.ok) {
        showNotification('Meeting scheduled successfully!', 'success');
        setShowScheduleModal(false);
        setScheduleForm({ title: '', date: '', time: '', requiresApproval: true, password: '' });
        fetchScheduledMeetings();
      } else {
        throw new Error(res?.error || 'Failed to schedule');
      }
    } catch (e) {
      console.error('Error scheduling meeting:', e);
      showNotification('Could not schedule meeting. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMeeting = async (id) => {
    if (!id) return;
    if (!window.confirm('Are you sure you want to delete this meeting?')) return;

    try {
      const n = requireSignedInName();
      if (!n) return;

      await fetch(api(`/api/meetings/${id}`), {
        method: 'DELETE',
        headers: { 'x-user-name': n },
      });
      showNotification('Meeting deleted successfully', 'success');
      fetchScheduledMeetings();
    } catch (e) {
      console.error('Error deleting meeting:', e);
      showNotification('Could not delete meeting', 'error');
    }
  };

  const joinScheduledMeeting = (meeting) => {
    const n = (userName || '').trim();
    if (!n) {
      showNotification('Please enter your name first', 'error');
      return;
    }
    localStorage.setItem('userName', n);
    const params = new URLSearchParams({
      name: n,
      password: meeting.password || '',
      requiresApproval: meeting.requiresApproval ? 'true' : 'false',
    });
    window.location.href = `/room/${meeting.meetingId}?${params.toString()}`;
  };

  const copyMeetingLink = (id) => {
    const link = `${window.location.origin}/room/${id}`;
    navigator.clipboard.writeText(link);
    setCopied(id);
    showNotification('Meeting link copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  // ---------------------------
  // UI
  // ---------------------------
  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      {/* Top Navigation Bar */}
      <nav className="navbar">
        <div className="navbar-content">
          <div className="navbar-brand">
            <div className="logo-wrapper">
              <Video size={24} className="logo-icon" />
            </div>
            <span className="brand-name">VideoMeet</span>
            <span className="badge">WebRTC</span>
          </div>

          <div className="navbar-links">
            <button
              className="nav-link"
              onClick={() => setShowMeetings((v) => !v)}
            >
              <Calendar size={18} />
              <span>My Meetings</span>
              {scheduledMeetings.length > 0 && (
                <span className="badge-count">{scheduledMeetings.length}</span>
              )}
            </button>

            <button className="nav-link" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              <span>{darkMode ? 'Light' : 'Dark'}</span>
            </button>

            <button className="btn btn-primary btn-sm" onClick={() => setShowSignIn(true)}>
              <Users size={16} />
              <span>{isSignedIn ? `Signed in: ${userName}` : 'Sign In'}</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="hero-section">
        <div className="hero-content">
          <div className="hero-left">
            <div className="hero-badge">
              <Sparkles size={14} />
              <span>Powered by WebRTC</span>
            </div>

            <h1 className="hero-title">Video calls and meetings for everyone</h1>

            <p className="hero-description">
              Connect, collaborate, and celebrate from anywhere with VideoMeet. Features admin controls, waiting rooms,
              screen sharing, and more.
            </p>

            {/* Stats */}
            <div className="stats-row">
              <div className="stat-item">
                <Zap size={16} />
                <span>{stats.totalMeetings} meetings created</span>
              </div>
              <div className="stat-item">
                <Globe size={16} />
                <span>100% WebRTC native</span>
              </div>
            </div>

            {/* Name Input */}
            <div className="input-group">
              <label className="input-label">
                <Users size={16} />
                Your Name
              </label>
              <input
                type="text"
                className="input input-lg"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name to get started"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateMeeting()}
              />
            </div>

            {/* Action Buttons */}
            <div className="button-group">
              <button
                className="btn btn-primary btn-lg"
                onClick={handleCreateMeeting}
                disabled={loading}
                title={isSignedIn ? '' : 'Sign in to create a meeting'}
              >
                <Plus size={20} />
                <span>{loading ? 'Creating...' : 'New Meeting'}</span>
              </button>

              <button className="btn btn-secondary btn-lg" onClick={() => setShowJoinModal(true)}>
                <LogIn size={20} />
                <span>Join Meeting</span>
              </button>

              <button
                className="btn btn-outline btn-lg"
                onClick={() => (isSignedIn ? setShowScheduleModal(true) : setShowSignIn(true))}
                title={isSignedIn ? '' : 'Sign in to schedule a meeting'}
              >
                <Calendar size={20} />
                <span>Schedule</span>
              </button>
            </div>

            {/* Features List */}
            <div className="features-list">
              <div className="feature-item">
                <Shield size={16} className="feature-icon" />
                <span>Admin Controls</span>
              </div>
              <div className="feature-item">
                <Lock size={16} className="feature-icon" />
                <span>Password Protected</span>
              </div>
              <div className="feature-item">
                <MessageSquare size={16} className="feature-icon" />
                <span>Real-time Chat</span>
              </div>
            </div>
          </div>

          {/* Hero Right - Illustration */}
          <div className="hero-right">
            <div className="demo-card">
              <div className="demo-header">
                <div className="demo-dots">
                  <span className="dot red"></span>
                  <span className="dot yellow"></span>
                  <span className="dot green"></span>
                </div>
                <span className="demo-title">Live Meeting</span>
              </div>

              <div className="demo-video">
                <div className="video-grid">
                  <div className="video-placeholder">
                    <Video size={32} className="video-icon" />
                    <span>You</span>
                  </div>
                  <div className="video-placeholder">
                    <Users size={32} className="video-icon" />
                    <span>Guest</span>
                  </div>
                </div>
              </div>

              <div className="demo-controls">
                <button className="control-btn active"><Mic size={16} /></button>
                <button className="control-btn active"><Video size={16} /></button>
                <button className="control-btn"><Monitor size={16} /></button>
                <button className="control-btn danger"><PhoneOff size={16} /></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* My Meetings Section (moved below hero) */}
      {showMeetings && (
        <section ref={meetingsRef} className="meetings-section animate-slide-down">
          <div className="section-header">
            <div>
              <h2 className="section-title">
                <Calendar size={24} />
                Upcoming Meetings
              </h2>
              <p className="section-subtitle">
                {scheduledMeetings.length} scheduled meeting{scheduledMeetings.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => (isSignedIn ? setShowScheduleModal(true) : setShowSignIn(true))}
              title={isSignedIn ? '' : 'Sign in to schedule a meeting'}
            >
              <Plus size={16} />
              <span>Schedule New</span>
            </button>
          </div>

          {scheduledMeetings.length === 0 ? (
            <div className="empty-state">
              <Calendar size={48} className="empty-icon" />
              <p className="empty-title">No scheduled meetings yet</p>
              <p className="empty-subtitle">Create your first meeting to get started</p>
              <button
                className="btn btn-primary"
                onClick={() => (isSignedIn ? setShowScheduleModal(true) : setShowSignIn(true))}
              >
                <Plus size={16} />
                <span>Schedule Meeting</span>
              </button>
            </div>
          ) : (
            <div className="meetings-grid">
              {scheduledMeetings.map((m) => (
                <div key={m._id} className="meeting-card">
                  <div className="meeting-header">
                    <div className="meeting-title-row">
                      <h3 className="meeting-title">{m.title}</h3>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => handleDeleteMeeting(m.meetingId)}
                        title="Delete meeting"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="meeting-time-badge">{getTimeUntilMeeting(m.date, m.time)}</div>
                  </div>

                  <div className="meeting-details">
                    <div className="detail-item">
                      <Calendar size={14} />
                      <span>{m.date}</span>
                    </div>
                    <div className="detail-item">
                      <Clock size={14} />
                      <span>{m.time}</span>
                    </div>
                    <div className="detail-item">
                      <Users size={14} />
                      <span>Created by {m.createdBy}</span>
                    </div>
                  </div>

                  <div className="meeting-features">
                    {m.password && (
                      <span className="feature-badge">
                        <Lock size={12} />
                        Password Protected
                      </span>
                    )}
                    {m.requiresApproval && (
                      <span className="feature-badge">
                        <UserCheck size={12} />
                        Approval Required
                      </span>
                    )}
                  </div>

                  <div className="meeting-id">
                    <span className="meeting-id-label">Meeting ID:</span>
                    <code className="meeting-id-code">{m.meetingId}</code>
                    <button className="btn-icon" onClick={() => copyMeetingLink(m.meetingId)} title="Copy meeting link">
                      {copied === m.meetingId ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>

                  <button className="btn btn-primary btn-block" onClick={() => joinScheduledMeeting(m)}>
                    <ExternalLink size={16} />
                    <span>Join Meeting</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Features Grid */}
      <section className="features-section">
        <div className="section-header centered">
          <h2 className="section-title">Everything you need for productive meetings</h2>
          <p className="section-subtitle">Professional video conferencing with enterprise-grade features</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-wrapper blue">
              <Video size={24} />
            </div>
            <h3 className="feature-title">HD Video & Audio</h3>
            <p className="feature-description">
              Crystal clear 1080p video and studio-quality audio with echo cancellation
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrapper purple">
              <Shield size={24} />
            </div>
            <h3 className="feature-title">Admin Controls</h3>
            <p className="feature-description">
              Manage participants with approval system, mute controls, and permissions
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrapper green">
              <Calendar size={24} />
            </div>
            <h3 className="feature-title">Schedule Meetings</h3>
            <p className="feature-description">
              Plan ahead with scheduled meetings, reminders, and calendar integration
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrapper orange">
              <Lock size={24} />
            </div>
            <h3 className="feature-title">Security First</h3>
            <p className="feature-description">
              Password protection, waiting rooms, and end-to-end encryption
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrapper red">
              <Monitor size={24} />
            </div>
            <h3 className="feature-title">Screen Sharing</h3>
            <p className="feature-description">
              Share your screen, presentations, or specific application windows
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-wrapper teal">
              <MessageSquare size={24} />
            </div>
            <h3 className="feature-title">Live Chat</h3>
            <p className="feature-description">
              Real-time messaging with file sharing and emoji reactions
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <Video size={20} />
            <span>VideoMeet</span>
          </div>
          <p className="footer-text">Built with WebRTC • No third-party services • 100% Open Source</p>
          <div className="footer-links">
            <a href="https://webrtc.org/" target="_blank" rel="noopener noreferrer">
              WebRTC Docs
            </a>
            <span>•</span>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <span>•</span>
            <a href="#privacy">Privacy Policy</a>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {showJoinModal && (
        <Modal title="Join Meeting" onClose={() => setShowJoinModal(false)}>
          <div className="modal-content">
            <div className="input-group">
              <label className="input-label">Meeting ID or Link</label>
              <input
                type="text"
                className="input"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
                placeholder="Enter meeting ID (e.g., abc123def) or paste link"
                onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
                autoFocus
              />
              <p className="input-hint">You can paste a full meeting link or just the ID.</p>
            </div>

            <div className="input-group">
              <label className="input-label">
                <Users size={16} />
                Your Name
              </label>
              <input
                type="text"
                className="input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your display name"
                onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowJoinModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleJoinMeeting}>
                <LogIn size={16} />
                <span>Join Meeting</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showScheduleModal && (
        <Modal title="Schedule Meeting" onClose={() => setShowScheduleModal(false)}>
          <div className="modal-content">
            <div className="input-group">
              <label className="input-label">Meeting Title</label>
              <input
                type="text"
                className="input"
                value={scheduleForm.title}
                onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                placeholder="e.g., Team Standup, Client Demo"
                autoFocus
              />
            </div>

            <div className="input-row">
              <div className="input-group">
                <label className="input-label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={scheduleForm.date}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              <div className="input-group">
                <label className="input-label">Time</label>
                <input
                  type="time"
                  className="input"
                  value={scheduleForm.time}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">
                Password (Optional)
                <span className="label-hint">Leave empty for no password</span>
              </label>
              <input
                type="password"
                className="input"
                value={scheduleForm.password}
                onChange={(e) => setScheduleForm({ ...scheduleForm, password: e.target.value })}
                placeholder="Enter password"
              />
            </div>

            <div className="checkbox-group">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={scheduleForm.requiresApproval}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, requiresApproval: e.target.checked })}
                />
                <span className="checkbox-label">
                  <UserCheck size={16} />
                  Require admin approval to join
                </span>
              </label>
              <p className="checkbox-hint">Participants will wait in a waiting room until approved</p>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleScheduleMeeting} disabled={loading}>
                <Calendar size={16} />
                <span>{loading ? 'Scheduling...' : 'Schedule Meeting'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showSignIn && (
        <Modal title="Sign In" onClose={() => setShowSignIn(false)}>
          <div className="modal-content">
            <div className="input-group">
              <label className="input-label">
                <Users size={16} />
                Your Name
              </label>
              <input
                type="text"
                className="input"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g., Alex Johnson"
                autoFocus
              />
              <p className="input-hint">Your name will be visible in meetings and saved locally.</p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSignIn(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const n = (userName || '').trim();
                  if (!n) return showNotification('Please enter your name', 'error');
                  localStorage.setItem('userName', n);
                  setIsSignedIn(true);
                  showNotification(`Signed in as ${n}`, 'success');
                  setShowSignIn(false);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Start Meeting Modal (after creating a new meeting) */}
      {showStartModal && createdMeeting && (
        <Modal title="Your meeting is ready" onClose={() => { setShowStartModal(false); setCreatedMeeting(null); }}>
          <div className="modal-content">
            {/* Meeting link */}
            <div className="input-group">
              <label className="input-label">Share this link</label>
              <div className="input-with-button">
                <input
                  className="input"
                  type="text"
                  readOnly
                  value={createdMeeting.url}
                  onFocus={(e) => e.target.select()}
                />
                <button className="btn btn-secondary" onClick={() => copyText(createdMeeting.url)}>
                  Copy
                </button>
              </div>
              <p className="input-hint">Send this link to participants to join.</p>
            </div>

            {/* Permission check */}
            <div className="card soft">
              <div className="card-row">
                <span>Camera</span>
                <span className={permState.cam ? 'ok' : 'warn'}>{permState.cam ? 'OK' : 'Not granted'}</span>
              </div>
              <div className="card-row">
                <span>Microphone</span>
                <span className={permState.mic ? 'OK' : 'warn'}>{permState.mic ? 'OK' : 'Not granted'}</span>
              </div>
              {permState.error && <p className="error-text">{permState.error}</p>}
              <button
                className="btn btn-outline"
                onClick={testPermissions}
                disabled={permState.testing}
                title="Ask browser for camera & microphone access"
              >
                {permState.testing ? 'Checking…' : 'Test camera & microphone'}
              </button>
            </div>

            {/* Enter button */}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowStartModal(false); setCreatedMeeting(null); }}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={enterAsHost}
              >
                Enter as Host
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// Modal Component
function Modal({ title, children, onClose }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Inline fallbacks for missing icons used in demo block
const { Mic, Monitor, PhoneOff } = {
  Mic: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  Monitor: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  PhoneOff: ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  ),
};

export default Home;
