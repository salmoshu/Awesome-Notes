// 应用 Logo（与 resources/logo.svg 同源）：树桩年轮 —— 年轮即项目的提交历史
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Timber">
      <defs>
        <linearGradient id="timber-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C2B22" />
          <stop offset="1" stopColor="#0E1712" />
        </linearGradient>
        <radialGradient id="timber-logo-core" cx="0.47" cy="0.52" r="0.62">
          <stop offset="0" stopColor="#E9C08A" />
          <stop offset="0.55" stopColor="#D9A76A" />
          <stop offset="1" stopColor="#B9834C" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#timber-logo-bg)" />
      <g transform="translate(256 262) scale(1 0.965)">
        <circle r="206" fill="#4A2F1B" />
        <circle r="206" fill="none" stroke="#5C3B22" strokeWidth="6" />
        <circle r="188" fill="#E5CEA6" />
        <circle r="172" fill="url(#timber-logo-core)" />
        <g fill="none" strokeLinecap="round">
          <circle r="150" stroke="#A9713B" strokeWidth="5" opacity="0.85" />
          <circle r="138" stroke="#C98F52" strokeWidth="2.6" opacity="0.8" />
          <circle r="121" stroke="#A9713B" strokeWidth="4.4" opacity="0.85" />
          <circle r="109" stroke="#C98F52" strokeWidth="2.4" opacity="0.8" />
          <circle r="93" stroke="#A96B37" strokeWidth="4" opacity="0.85" />
          <circle r="81" stroke="#C98F52" strokeWidth="2.2" opacity="0.8" />
          <circle r="66" stroke="#A96633" strokeWidth="3.6" opacity="0.9" />
          <circle r="54" stroke="#C9894C" strokeWidth="2" opacity="0.8" />
          <circle r="40" stroke="#A96633" strokeWidth="3.2" opacity="0.9" />
          <circle r="29" stroke="#C9894C" strokeWidth="1.8" opacity="0.85" />
          <circle r="17" stroke="#A96633" strokeWidth="2.8" opacity="0.95" />
        </g>
        <circle r="7" fill="#8A5227" />
        <path d="M 40 -168 L 30 -108 L 36 -62" fill="none" stroke="#7C4820" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        <path d="M 132 118 L 86 76 L 52 58" fill="none" stroke="#7C4820" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
        <ellipse cx="-96" cy="-88" rx="20" ry="14" fill="#9C5E2E" transform="rotate(-24 -96 -88)" />
        <ellipse cx="-96" cy="-88" rx="11" ry="7" fill="#7C4820" transform="rotate(-24 -96 -88)" />
      </g>
      <ellipse cx="256" cy="150" rx="150" ry="46" fill="#FFFFFF" opacity="0.06" />
    </svg>
  )
}
