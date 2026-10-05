// 应用 Logo（与 resources/logo.svg 同源）：风格对齐 Awesome-Resume（紫渐变 + 白卡片 + 徽章）
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-label="Awesome-Notes">
      <defs>
        <linearGradient id="an-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#an-logo-bg)" />
      <rect x="126" y="112" width="260" height="288" rx="34" fill="#5B21B6" opacity="0.35" />
      <rect x="118" y="102" width="260" height="288" rx="34" fill="#FFFFFF" />
      <circle cx="168" cy="152" r="21" fill="#7C3AED" />
      <rect x="202" y="141" width="106" height="20" rx="10" fill="#C4B5FD" />
      <rect x="154" y="196" width="188" height="16" rx="8" fill="#DDD6FE" />
      <rect x="154" y="232" width="188" height="16" rx="8" fill="#DDD6FE" />
      <rect x="150" y="270" width="196" height="26" rx="13" fill="#FBBF24" />
      <rect x="154" y="322" width="150" height="16" rx="8" fill="#DDD6FE" />
      <rect x="154" y="356" width="106" height="16" rx="8" fill="#DDD6FE" />
      <circle cx="352" cy="360" r="52" fill="#FFFFFF" />
      <circle cx="352" cy="360" r="52" fill="none" stroke="#EDE9FE" strokeWidth="4" />
      <g transform="translate(352 360)">
        <path d="M -14 -20 L 6 -20 A 8 8 0 0 1 14 -12 L 14 6 A 8 8 0 0 1 6 14 L -6 14 A 8 8 0 0 1 -14 6 Z" fill="#7C3AED" />
        <polygon points="-7,8 7,8 0,22" fill="#7C3AED" />
        <circle cx="0" cy="2" r="3" fill="#FFFFFF" />
      </g>
    </svg>
  )
}
