import React from 'react'

export default function Controls({ state, actions }) {
  const { micOn, camOn, screenOn, isAdmin, permissions } = state
  const { toggleMic, toggleCam, toggleScreen, grantPerm, approveJoin } = actions

  return (
    <div className="card">
      <h3>Controls</h3>
      <div className="controls">
        <button className="btn secondary" onClick={toggleMic}>{micOn ? 'Mute Mic' : 'Unmute Mic'}</button>
        <button className="btn secondary" onClick={toggleCam}>{camOn ? 'Turn Camera Off' : 'Turn Camera On'}</button>
        <button className="btn secondary" onClick={toggleScreen}>{screenOn ? 'Stop Share' : 'Share Screen'}</button>
      </div>
      <p className="badge" style={{marginTop:8}}>
        Permissions: mic {permissions.canUnmute ? '✅' : '❌'} | video {permissions.canVideo ? '✅' : '❌'} | share {permissions.canShareScreen ? '✅' : '❌'}
      </p>

      {isAdmin && (
        <div style={{marginTop: 12}}>
          <h4>Admin</h4>
          <div className="row" style={{marginBottom: 10}}>
            <button className="btn secondary" onClick={() => grantPerm({ canUnmute: true })}>Grant Mic</button>
            <button className="btn secondary" onClick={() => grantPerm({ canVideo: true })}>Grant Video</button>
            <button className="btn secondary" onClick={() => grantPerm({ canShareScreen: true })}>Grant Screen</button>
          </div>
          <div style={{marginTop: 10}}>
            <h4>Waiting Room</h4>
            <WaitingRoom approveJoin={approveJoin} />
          </div>
        </div>
      )}
    </div>
  )
}

// simple broadcaster for waiting-room updates
const listeners = new Set();
export function pushWaiting(list) { listeners.forEach(cb => cb(list)) }

function WaitingRoom({ approveJoin }) {
  const [list, setList] = React.useState([])
  React.useEffect(() => {
    const cb = (l) => setList(l)
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, [])
  if (!list.length) return <p className="badge">No one waiting</p>
  return (
    <div>
      {list.map(p => (
        <div key={p.socketId} className="row" style={{alignItems: 'center', marginBottom: 6}}>
          <div className="grow">{p.displayName} <span className="badge">{p.socketId.slice(0,6)}</span></div>
          <button className="btn" onClick={() => approveJoin(p.socketId)}>Approve</button>
        </div>
      ))}
    </div>
  )
}
