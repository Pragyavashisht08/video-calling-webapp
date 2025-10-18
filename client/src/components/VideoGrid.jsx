import React from 'react'

export default function VideoGrid({ localRef, peers }) {
  return (
    <div className="row">
      <div className="grow card">
        <p className="badge">You</p>
        <video ref={localRef} autoPlay playsInline muted />
      </div>
      {Array.from(peers.entries()).map(([id, ref]) => (
        <div className="grow card" key={id}>
          <p className="badge">{id.slice(0,6)}</p>
          <video ref={ref} autoPlay playsInline />
        </div>
      ))}
    </div>
  )
}
