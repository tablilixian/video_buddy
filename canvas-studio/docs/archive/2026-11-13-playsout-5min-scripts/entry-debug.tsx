// @ts-nocheck
import React, { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { StudioComposition } from '../../../src/remotion/components/Root.js'
import manifest from '/Users/wl/Desktop/job/git/playsout/playsoutapi/ops-dashboard/build-5min/manifest.json'

const handle = delayRender('probe')

const Probe = () => {
  const [txt, setTxt] = useState('probing...')
  useEffect(() => {
    const t = setTimeout(() => {
      const all = [...document.querySelectorAll('*')]
      const hit = all.filter((d) => (d.textContent || '').trim() === '561 / 569 天有数据' || (d.textContent || '').includes('561 / 569'))
      const lines = hit.map((d) => {
        const r = d.getBoundingClientRect()
        const cs = getComputedStyle(d)
        return `<${d.tagName}> ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op=${cs.opacity} c=${cs.color} fs=${cs.fontSize} vis=${cs.visibility} disp=${cs.display}`
      })
      setTxt((lines.length ? lines.slice(0, 4).join(' | ') : 'NOT FOUND n=' + all.length))
      continueRender(handle)
    }, 1000)
    return () => clearTimeout(t)
  }, [])
  return (
    <>
      <StudioComposition manifest={manifest} />
      <div style={{ position: 'fixed', left: 8, top: 8, right: 8, color: '#0f0', font: '14px monospace', zIndex: 9999, background: '#000', padding: 6 }}>{txt}</div>
    </>
  )
}

const Root = () => (
  <Composition id="studio-composition" component={Probe} durationInFrames={9000} fps={30} width={1920} height={1080} defaultProps={{}} />
)
registerRoot(Root)
