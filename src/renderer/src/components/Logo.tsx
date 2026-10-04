// 应用 Logo（与 resources/logo.svg 同源）：文档 + 批注高亮 + 钢笔
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Awesome-Notes">
      <defs>
        <linearGradient id="an-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B94FF" />
          <stop offset="0.55" stopColor="#2E6BF0" />
          <stop offset="1" stopColor="#1C4FD8" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="116" fill="url(#an-logo-bg)" />
      <rect x="140" y="98" width="236" height="324" rx="30" fill="#0F2A6E" opacity="0.35" />
      <rect x="132" y="88" width="236" height="324" rx="30" fill="#FFFFFF" />
      <rect x="168" y="140" width="118" height="24" rx="12" fill="#8FA3CF" />
      <rect x="164" y="194" width="176" height="36" rx="18" fill="#FFC53D" />
      <rect x="168" y="262" width="126" height="22" rx="11" fill="#D5DEF2" />
      <rect x="168" y="314" width="126" height="22" rx="11" fill="#D5DEF2" />
      <rect x="168" y="366" width="92" height="22" rx="11" fill="#D5DEF2" />
      <g transform="translate(362 340) rotate(45)">
        <rect x="-21" y="-100" width="42" height="168" rx="20" fill="#1B3B8F" />
        <path d="M -21 -80 a 20 20 0 0 1 20 -20 h 2 a 20 20 0 0 1 20 20 v 36 h -42 z" fill="#142E6E" />
        <polygon points="-15,66 15,66 0,104" fill="#FFFFFF" />
        <circle cx="0" cy="86" r="5" fill="#1B3B8F" />
      </g>
    </svg>
  )
}
