import { useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron.process.versions)

  return (
    <ul className="absolute bottom-[30px] left-1/2 -translate-x-1/2 py-[15px] font-mono inline-flex overflow-hidden items-center rounded-[22px] bg-[#202127] backdrop-blur-[24px] max-[620px]:hidden">
      <li className="border-r border-[#515c67] px-5 text-sm leading-[14px] opacity-80 last:border-none">
        Electron v{versions.electron}
      </li>
      <li className="border-r border-[#515c67] px-5 text-sm leading-[14px] opacity-80 last:border-none">
        Chromium v{versions.chrome}
      </li>
      <li className="border-r border-[#515c67] px-5 text-sm leading-[14px] opacity-80 last:border-none">
        Node v{versions.node}
      </li>
    </ul>
  )
}

export default Versions

