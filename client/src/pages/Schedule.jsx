import React from 'react'
const API = (path) => (import.meta.env.VITE_SERVER_URL || 'http://localhost:4000') + path

export default function Schedule({ navigate }) {
  const [title, setTitle] = React.useState('Planned Sync')
  const [password, setPassword] = React.useState('')
  const [date, setDate] = React.useState('')
  const [time, setTime] = React.useState('')
  const [list, setList] = React.useState([])

  const createScheduled = async () => {
    if (!date || !time) return
    const scheduledFor = new Date(`${date}T${time}:00`)
    const res = await fetch(API('/api/meetings/create'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ title, password, scheduledFor })
    }).then(r => r.json())
    if (res.ok) {
      await load()
      alert('Scheduled! Link: ' + window.location.origin + '/room/' + res.meetingId)
    }
  }

  const load = async () => {
    const res = await fetch(API('/api/meetings/upcoming')).then(r => r.json())
    if (res.ok) setList(res.meetings)
  }

  React.useEffect(()=>{ load() }, [])

  return (
    <div className="row">
      <div className="grow card">
        <h3>Schedule a Meeting</h3>
        <div className="row">
          <input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
          <input placeholder="(Optional) Password" value={password} onChange={e=>setPassword(e.target.value)} />
        </div>
        <div className="row" style={{marginTop: 8}}>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
          <input type="time" value={time} onChange={e=>setTime(e.target.value)} />
        </div>
        <div className="row" style={{marginTop: 8}}>
          <button className="btn" onClick={createScheduled}>Schedule</button>
        </div>
      </div>

      <div className="card" style={{minWidth: 380}}>
        <h3>My Upcoming Meetings</h3>
        {!list.length && <p className="badge">No upcoming meetings</p>}
        {list.map(m => (
          <div key={m.meetingId} className="row" style={{alignItems:'center', marginBottom: 8}}>
            <div className="grow">
              <div><b>{m.title}</b></div>
              <div className="badge">{m.scheduledFor ? new Date(m.scheduledFor).toLocaleString() : 'Instant'}</div>
            </div>
            <a className="btn" href={`/room/${m.meetingId}`}>Open</a>
          </div>
        ))}
      </div>
    </div>
  )
}
